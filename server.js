#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// OpenClaw ↔ Claude Code Proxy v4.0
//
// 使用 Claude Agent SDK persistent session，大幅降低 token 消耗。
// 每個 model 維護一個長期 session，system prompt 只載入一次。
//
// Endpoints:
//   POST /v1/chat/completions  — OpenAI-compatible
//   GET  /v1/models            — 可用模型列表
//   GET  /health               — 健康檢查
//   GET  /stats                — 使用統計
//
// 原始版本: github.com/51AutoPilot/openclaw-claude-proxy
// 增強版本: github.com/ppcvote/openclaw-claude-proxy
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3456', 10);
const API_KEY = process.env.API_KEY || '';
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2', 10);
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '300000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);
const PLUGINS_DIR = process.env.PLUGINS_DIR || path.join(__dirname, 'plugins');

let activeRequests = 0;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// Claude Agent SDK — persistent session 管理
// ---------------------------------------------------------------------------
let _sdk = null;
function getSDK() {
  if (!_sdk) _sdk = require('@anthropic-ai/claude-agent-sdk');
  return _sdk;
}

// 每個 model 一個 persistent session，避免重複載入 system prompt
const sessions = {};        // model -> SDKSession
const sessionQueues = {};   // model -> Promise chain (序列化請求)

async function sendToSession(model, userMessage) {
  const sdkModel = resolveModel(model);

  // 確保同一 model 的請求序列執行（session 不支援並行 send）
  if (!sessionQueues[sdkModel]) {
    sessionQueues[sdkModel] = Promise.resolve();
  }

  const resultPromise = new Promise((resolve, reject) => {
    sessionQueues[sdkModel] = sessionQueues[sdkModel].then(async () => {
      try {
        // Lazy 建立 session
        if (!sessions[sdkModel]) {
          const { unstable_v2_createSession } = getSDK();
          sessions[sdkModel] = unstable_v2_createSession({ model: sdkModel });
          console.log(`  [session] Created persistent session for model=${sdkModel}`);
        }

        const session = sessions[sdkModel];
        await session.send(userMessage);

        let resultText = '';
        for await (const msg of session.stream()) {
          if (msg.type === 'result') {
            resultText = msg.result || '';
            break;
          }
        }
        resolve(resultText);
      } catch (err) {
        // Session 壞了，清除重建
        console.error(`  [session] Error for model=${sdkModel}: ${err.message}`);
        try { sessions[sdkModel]?.close(); } catch (_) {}
        delete sessions[sdkModel];
        reject(err);
      }
    });
  });

  return resultPromise;
}

// ---------------------------------------------------------------------------
// Request Stats
// ---------------------------------------------------------------------------
const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalTokensEstimated: 0,
  errors: 0,
  byModel: {},
  byHour: {},
  avgResponseMs: 0,
  _responseTimes: [],
};

function trackRequest(model, promptLen, responseLen, durationMs, error = false) {
  stats.totalRequests++;
  stats.totalTokensEstimated += Math.ceil((promptLen + responseLen) / 4);
  if (error) stats.errors++;

  const m = model || 'default';
  if (!stats.byModel[m]) stats.byModel[m] = { count: 0, tokens: 0 };
  stats.byModel[m].count++;
  stats.byModel[m].tokens += Math.ceil((promptLen + responseLen) / 4);

  const hour = new Date().getHours();
  stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;

  stats._responseTimes.push(durationMs);
  if (stats._responseTimes.length > 100) stats._responseTimes.shift();
  stats.avgResponseMs = Math.round(
    stats._responseTimes.reduce((a, b) => a + b, 0) / stats._responseTimes.length
  );
}

// ---------------------------------------------------------------------------
// Plugin System
// ---------------------------------------------------------------------------
const plugins = [];

function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return;
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const plugin = require(path.join(PLUGINS_DIR, file));
      if (plugin.name && (plugin.preProcess || plugin.postProcess)) {
        plugins.push(plugin);
        console.log(`  Plugin loaded: ${plugin.name} (${file})`);
      }
    } catch (e) {
      console.error(`  Plugin failed to load: ${file} — ${e.message}`);
    }
  }
}

async function runPrePlugins(messages, model) {
  let result = { messages, model };
  for (const p of plugins) {
    if (p.preProcess) {
      try { result = await p.preProcess(result.messages, result.model) || result; } catch (_) {}
    }
  }
  return result;
}

async function runPostPlugins(result, model) {
  let text = result;
  for (const p of plugins) {
    if (p.postProcess) {
      try { text = await p.postProcess(text, model) || text; } catch (_) {}
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '10mb' }));

function auth(req, res, next) {
  if (!API_KEY) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token !== API_KEY) {
    return res.status(401).json({ error: { message: 'Invalid API key', type: 'auth_error' } });
  }
  next();
}

// ---------------------------------------------------------------------------
// Model mapping
// ---------------------------------------------------------------------------
function resolveModel(model) {
  if (!model) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet';
}

// ---------------------------------------------------------------------------
// 訊息轉換：OpenAI messages → 單一 prompt 文字
// ---------------------------------------------------------------------------
function messagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const parts = [];
  for (const msg of messages) {
    const role = msg.role || 'user';
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map(c => c.text || '').join('\n')
        : String(msg.content || '');
    if (role === 'system') {
      parts.push(`[System Instructions]\n${content}\n[End System Instructions]`);
    } else if (role === 'assistant') {
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        const tcDesc = msg.tool_calls.map(tc => {
          let args = tc.function?.arguments || '{}';
          try { args = JSON.stringify(JSON.parse(args), null, 2); } catch (_) {}
          return `<tool_call>\n{"name": "${tc.function?.name}", "arguments": ${args}}\n</tool_call>`;
        }).join('\n');
        parts.push(`[Previous Assistant Response]\n${content || ''}${tcDesc ? '\n' + tcDesc : ''}`);
      } else {
        parts.push(`[Previous Assistant Response]\n${content}`);
      }
    } else if (role === 'tool') {
      const name = msg.name || msg.tool_call_id || 'unknown';
      parts.push(`[Tool Result: ${name}]\n${content}`);
    } else {
      parts.push(content);
    }
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions
// ---------------------------------------------------------------------------
app.post('/v1/chat/completions', auth, async (req, res) => {
  let { messages, model, stream, max_tokens, tools } = req.body;
  const startTime = Date.now();

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'messages array is required', type: 'invalid_request_error' }
    });
  }

  if (activeRequests >= MAX_CONCURRENT) {
    return res.status(429).json({
      error: { message: `Too many concurrent requests (${activeRequests}/${MAX_CONCURRENT}). Retry later.`, type: 'rate_limit_error' }
    });
  }

  activeRequests++;
  const requestId = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  // Pre-processing plugins
  const pluginResult = await runPrePlugins(messages, model);
  messages = pluginResult.messages || messages;
  model = pluginResult.model || model;

  // 將所有 messages 轉成一個 prompt（包含 system）
  const prompt = messagesToPrompt(messages);

  console.log(`[${new Date().toISOString()}] REQ ${requestId} | model=${model || 'sonnet'} | stream=${!!stream} | msgs=${messages.length} | prompt=${prompt.length}c`);

  try {
    // Rate limit guard
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    lastRequestTime = Date.now();

    // 透過 persistent session 送出請求
    let result = '';
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await sendToSession(model, prompt);
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          console.log(`  Retry ${attempt + 1}/${MAX_RETRIES}: ${err.message}`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    if (!result && lastError) throw lastError;

    // Post-processing plugins
    result = await runPostPlugins(result, model);

    const durationMs = Date.now() - startTime;
    trackRequest(model, prompt.length, result.length, durationMs);

    // Streaming response (simulated SSE)
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Request-Id', requestId);

      const chunk = {
        id: requestId, object: 'chat.completion.chunk', created,
        model: model || 'claude-sonnet-4-6',
        choices: [{ index: 0, delta: { role: 'assistant', content: result }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ id: requestId, object: 'chat.completion.chunk', created, model: model || 'claude-sonnet-4-6', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      activeRequests--;
      console.log(`  DONE ${requestId} (stream) | ${result.length}c | ${durationMs}ms`);
      return;
    }

    activeRequests--;
    const response = {
      id: requestId, object: 'chat.completion', created,
      model: model || 'claude-sonnet-4-6',
      choices: [{ index: 0, message: { role: 'assistant', content: result }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: Math.ceil(result.length / 4),
        total_tokens: Math.ceil((prompt.length + result.length) / 4),
      },
    };
    console.log(`  DONE ${requestId} | ${result.length}c | ${durationMs}ms`);
    res.json(response);

  } catch (err) {
    activeRequests--;
    const durationMs = Date.now() - startTime;
    trackRequest(model, prompt.length, 0, durationMs, true);
    console.error(`  FAIL ${requestId}: ${err.message} (${durationMs}ms)`);
    res.status(500).json({ error: { message: err.message, type: 'server_error' } });
  }
});

// ---------------------------------------------------------------------------
// GET /v1/models
// ---------------------------------------------------------------------------
app.get('/v1/models', auth, (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'claude-opus-4-6', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-6', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-haiku-4-5', object: 'model', created: 1700000000, owned_by: 'anthropic' },
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
    active_requests: activeRequests,
    max_concurrent: MAX_CONCURRENT,
    active_sessions: Object.keys(sessions),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ---------------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------------
app.get('/stats', auth, (req, res) => {
  res.json({
    ...stats,
    _responseTimes: undefined,
    uptime_hours: Math.round(process.uptime() / 3600 * 10) / 10,
    active_requests: activeRequests,
    active_sessions: Object.keys(sessions),
    estimated_cost_saved: `$${(stats.totalTokensEstimated * 0.000015).toFixed(2)} (vs API pricing)`,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
loadPlugins();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║  OpenClaw ↔ Claude Code Proxy v4.0                ║
║  Persistent Session Edition                       ║
╠════════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(42)}║
║  Auth: ${(API_KEY ? 'Enabled' : 'Disabled (set API_KEY)').padEnd(42)}║
║  Concurrent: ${String(MAX_CONCURRENT).padEnd(36)}║
║  Retries: ${String(MAX_RETRIES).padEnd(39)}║
║  Plugins: ${String(plugins.length).padEnd(39)}║
╠════════════════════════════════════════════════════╣
║  POST /v1/chat/completions                        ║
║  GET  /v1/models                                  ║
║  GET  /health                                     ║
║  GET  /stats                                      ║
╚════════════════════════════════════════════════════╝
  `);
});
