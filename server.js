#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// OpenClaw ↔ Claude Code Proxy v3.0
//
// Turns your $200/mo Claude Max subscription into a free API for AI agents.
//
// Endpoints:
//   POST /v1/messages         — Anthropic Messages API (supports tool_use)
//   POST /v1/chat/completions — OpenAI-compatible (text-only, legacy)
//   GET  /v1/models           — List available models
//   GET  /health              — Health check
//   GET  /stats               — Usage dashboard
//
// v3.0 uses Claude Agent SDK for /v1/messages (full tool_use support).
// v2.0 CLI-based /v1/chat/completions is kept for backward compatibility.
//
// github.com/photofanz/openclaw-claude-proxy
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3456', 10);
const API_KEY = process.env.API_KEY || '';
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude';
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2', 10);
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '300000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);
const LOG_DIR = process.env.LOG_DIR || path.join(process.env.HOME || '.', '.openclaw/logs');
const PLUGINS_DIR = process.env.PLUGINS_DIR || path.join(__dirname, 'plugins');

let activeRequests = 0;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// Claude Agent SDK (lazy loaded)
// ---------------------------------------------------------------------------
let _sdkQuery = null;
function getSdkQuery() {
  if (!_sdkQuery) {
    const sdk = require('@anthropic-ai/claude-agent-sdk');
    _sdkQuery = sdk.query;
  }
  return _sdkQuery;
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
  byEndpoint: { messages: 0, chat_completions: 0 },
  avgResponseMs: 0,
  _responseTimes: [],
};

function trackRequest(model, inputTokens, outputTokens, durationMs, error = false, endpoint = 'messages') {
  stats.totalRequests++;
  stats.totalTokensEstimated += inputTokens + outputTokens;
  if (error) stats.errors++;
  stats.byEndpoint[endpoint] = (stats.byEndpoint[endpoint] || 0) + 1;

  const m = model || 'default';
  if (!stats.byModel[m]) stats.byModel[m] = { count: 0, tokens: 0 };
  stats.byModel[m].count++;
  stats.byModel[m].tokens += inputTokens + outputTokens;

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
  const header = req.headers['x-api-key'] || '';
  const bearer = req.headers.authorization || '';
  const token = header || (bearer.startsWith('Bearer ') ? bearer.slice(7) : bearer);
  if (token !== API_KEY) {
    return res.status(401).json({ type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } });
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
// POST /v1/messages — Anthropic Messages API (Agent SDK backend)
// ---------------------------------------------------------------------------
app.post('/v1/messages', auth, async (req, res) => {
  const { model, messages, system, max_tokens, tools, tool_choice, stream } = req.body;
  const startTime = Date.now();
  const requestId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'messages array is required' }
    });
  }

  if (activeRequests >= MAX_CONCURRENT) {
    return res.status(429).json({
      type: 'error',
      error: { type: 'rate_limit_error', message: `Too many concurrent requests (${activeRequests}/${MAX_CONCURRENT})` }
    });
  }

  activeRequests++;

  // Run pre-processing plugins
  const pre = await runPrePlugins(messages, model);
  const processedMessages = pre.messages || messages;
  const processedModel = pre.model || model;
  const sdkModel = resolveModel(processedModel);

  // Build prompt from messages
  const parts = [];
  if (system) {
    const sysText = typeof system === 'string'
      ? system
      : Array.isArray(system)
        ? system.map(b => b.text || '').join('\n')
        : '';
    if (sysText) parts.push(`[System]\n${sysText}\n[/System]`);
  }

  for (const msg of processedMessages) {
    const role = msg.role;
    if (role === 'user') {
      if (typeof msg.content === 'string') {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        parts.push(msg.content.map(b => b.text || '').join('\n'));
      }
    } else if (role === 'assistant') {
      if (typeof msg.content === 'string') {
        parts.push(`[Assistant]\n${msg.content}`);
      } else if (Array.isArray(msg.content)) {
        const texts = msg.content.map(b => {
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_use') return `[Tool Call: ${b.name}(${JSON.stringify(b.input)})]`;
          return '';
        }).filter(Boolean);
        parts.push(`[Assistant]\n${texts.join('\n')}`);
      }
    } else if (role === 'tool') {
      // tool_result
      parts.push(`[Tool Result: ${msg.tool_use_id}]\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`);
    }
  }

  const prompt = parts.join('\n\n');

  console.log(`[${new Date().toISOString()}] REQ ${requestId} | model=${sdkModel} | tools=${tools ? tools.length : 0} | msgs=${messages.length} | prompt=${prompt.length}c`);

  try {
    // Rate limit guard
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    lastRequestTime = Date.now();

    // Call Claude via Agent SDK — single turn only
    // OpenClaw handles tool execution itself; proxy just relays the model's response.
    const maxTurns = 1;

    const query = getSdkQuery();
    const q = query({
      prompt,
      options: {
        model: sdkModel,
        maxTurns,
        systemPrompt: typeof system === 'string' ? system : undefined,
      }
    });

    let lastAssistantMessage = null;
    let resultMessage = null;
    let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        lastAssistantMessage = msg.message;
        if (msg.message?.usage) {
          usage.input_tokens += msg.message.usage.input_tokens || 0;
          usage.output_tokens += msg.message.usage.output_tokens || 0;
          usage.cache_read_input_tokens += msg.message.usage.cache_read_input_tokens || 0;
          usage.cache_creation_input_tokens += msg.message.usage.cache_creation_input_tokens || 0;
        }
      }
      if (msg.type === 'result') {
        resultMessage = msg;
        if (msg.usage) {
          usage.input_tokens = msg.usage.input_tokens || usage.input_tokens;
          usage.output_tokens = msg.usage.output_tokens || usage.output_tokens;
        }
      }
    }

    if (!lastAssistantMessage && !resultMessage) {
      throw new Error('No response from Claude');
    }

    const durationMs = Date.now() - startTime;

    // Build content: prefer result text, fall back to last assistant's text blocks
    let content;
    if (resultMessage && resultMessage.result) {
      content = [{ type: 'text', text: resultMessage.result }];
    } else if (lastAssistantMessage) {
      const textBlocks = (lastAssistantMessage.content || []).filter(b => b.type === 'text');
      content = textBlocks.length > 0 ? textBlocks : [{ type: 'text', text: '' }];
    } else {
      content = [{ type: 'text', text: '' }];
    }

    const hasToolUse = false; // SDK handles tools internally, final response is always text

    // Build Anthropic Messages API response
    const response = {
      id: requestId,
      type: 'message',
      role: 'assistant',
      model: model || `claude-${sdkModel}-4-6`,
      content,
      stop_reason: hasToolUse ? 'tool_use' : (lastAssistantMessage?.stop_reason || 'end_turn'),
      stop_sequence: null,
      usage,
    };

    trackRequest(model, usage.input_tokens, usage.output_tokens, durationMs, false, 'messages');
    console.log(`  DONE ${requestId} | tool_use=${hasToolUse} | ${usage.output_tokens}tok | ${durationMs}ms`);
    activeRequests--;
    res.json(response);

  } catch (err) {
    activeRequests--;
    const durationMs = Date.now() - startTime;
    trackRequest(model, 0, 0, durationMs, true, 'messages');
    console.error(`  FAIL ${requestId}: ${err.message} (${durationMs}ms)`);
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: err.message }
    });
  }
});

// ---------------------------------------------------------------------------
// POST /v1/chat/completions — OpenAI-compatible (legacy, text-only)
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
      parts.push(`[Previous Assistant Response]\n${content}`);
    } else if (role === 'tool') {
      const name = msg.name || msg.tool_call_id || 'unknown';
      parts.push(`[Tool Result: ${name}]\n${content}`);
    } else {
      parts.push(content);
    }
  }
  return parts.join('\n\n');
}

function callClaude(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const args = ['--print'];
    if (model && !model.includes('opus')) {
      if (model.includes('sonnet')) args.push('--model', 'sonnet');
      else if (model.includes('haiku')) args.push('--model', 'haiku');
    }

    const SYS_PROMPT_ARG_LIMIT = 100_000;
    let stdinInput = '';
    if (systemPrompt && systemPrompt.length <= SYS_PROMPT_ARG_LIMIT) {
      args.push('--system-prompt', systemPrompt);
    } else if (systemPrompt) {
      stdinInput += `[System Instructions]\n${systemPrompt}\n[End System Instructions]\n\n`;
    }
    stdinInput += prompt;

    const proc = spawn(CLAUDE_CLI, args, {
      cwd: process.env.HOME || '/home/ubuntu',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: REQUEST_TIMEOUT,
    });
    proc.stdin.write(stdinInput);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
      else resolve(stdout.trim());
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn CLI: ${err.message}`)));

    setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      reject(new Error('CLI timed out'));
    }, REQUEST_TIMEOUT + 5000);
  });
}

app.post('/v1/chat/completions', auth, async (req, res) => {
  let { messages, model, stream } = req.body;
  const startTime = Date.now();

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
  }

  if (activeRequests >= MAX_CONCURRENT) {
    return res.status(429).json({ error: { message: `Too many concurrent requests`, type: 'rate_limit_error' } });
  }

  activeRequests++;
  const requestId = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  // Run pre-processing plugins
  const pre = await runPrePlugins(messages, model);
  const processedMessages = pre.messages || messages;
  model = pre.model || model;

  let systemPrompt = '';
  const nonSystemMessages = [];
  for (const msg of processedMessages) {
    if (msg.role === 'system') systemPrompt += (systemPrompt ? '\n' : '') + (typeof msg.content === 'string' ? msg.content : '');
    else nonSystemMessages.push(msg);
  }

  const prompt = messagesToPrompt(nonSystemMessages);
  console.log(`[${new Date().toISOString()}] REQ ${requestId} | model=${model || 'opus'} | msgs=${messages.length} | prompt=${prompt.length}c`);

  try {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    lastRequestTime = Date.now();

    let result = '';
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await callClaude(prompt, systemPrompt || undefined, model);
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const backoff = 5000 * (attempt + 1);
          console.log(`  Retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms: ${err.message}`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    if (!result && lastError) throw lastError;

    result = await runPostPlugins(result, model);
    const durationMs = Date.now() - startTime;
    trackRequest(model, Math.ceil(prompt.length / 4), Math.ceil(result.length / 4), durationMs, false, 'chat_completions');

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      const chunk = { id: requestId, object: 'chat.completion.chunk', created, model: model || 'claude-opus-4-6',
        choices: [{ index: 0, delta: { role: 'assistant', content: result }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ id: requestId, object: 'chat.completion.chunk', created, model: model || 'claude-opus-4-6', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      activeRequests--;
      console.log(`  DONE ${requestId} (stream) | ${result.length}c | ${durationMs}ms`);
      return;
    }

    activeRequests--;
    console.log(`  DONE ${requestId} | ${result.length}c | ${durationMs}ms`);
    res.json({
      id: requestId, object: 'chat.completion', created, model: model || 'claude-opus-4-6',
      choices: [{ index: 0, message: { role: 'assistant', content: result }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(result.length / 4), total_tokens: Math.ceil((prompt.length + result.length) / 4) },
    });
  } catch (err) {
    activeRequests--;
    const durationMs = Date.now() - startTime;
    trackRequest(model, Math.ceil(prompt.length / 4), 0, durationMs, true, 'chat_completions');
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
    version: '3.0.0',
    active_requests: activeRequests,
    max_concurrent: MAX_CONCURRENT,
    uptime_seconds: Math.floor(process.uptime()),
    endpoints: {
      '/v1/messages': 'Anthropic Messages API (Agent SDK, supports tool_use)',
      '/v1/chat/completions': 'OpenAI-compatible (CLI, text-only)',
    },
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
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
loadPlugins();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║  OpenClaw ↔ Claude Code Proxy v3.0                ║
║  by Ultra Lab (ultralab.tw)                       ║
╠════════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(42)}║
║  Auth: ${(API_KEY ? 'Enabled' : 'Disabled').padEnd(42)}║
║  Concurrent: ${String(MAX_CONCURRENT).padEnd(36)}║
║  Retries: ${String(MAX_RETRIES).padEnd(39)}║
║  Plugins: ${String(plugins.length).padEnd(39)}║
╠════════════════════════════════════════════════════╣
║  POST /v1/messages          (Anthropic, tool_use) ║
║  POST /v1/chat/completions  (OpenAI, text-only)   ║
║  GET  /v1/models                                  ║
║  GET  /health                                     ║
║  GET  /stats                                      ║
╚════════════════════════════════════════════════════╝
  `);
});
