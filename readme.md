# OpenClaw ↔ Claude Code Proxy v3.0

> 把 Claude Max 訂閱（$200/月）變成免費 API，讓 OpenClaw 等 AI agent 直接呼叫。

**一個 Proxy，全系列模型，零 API 費用。**

```
Agents / OpenClaw               Proxy (localhost:3456)            Claude Max
  │                                │                                │
  ├─ POST /v1/messages ──────────►│── Agent SDK query() ──────────►│ Opus/Sonnet/Haiku
  │  (Anthropic Messages API)     │                                │
  ├─ POST /v1/chat/completions ──►│── claude --print (CLI) ───────►│ Opus/Sonnet/Haiku
  │  (OpenAI-compatible, legacy)  │                                │
  └─ GET /health, /stats ────────►│                                │
```

---

## 功能特色

| 功能 | 說明 |
|------|------|
| Anthropic Messages API | `/v1/messages` — Agent SDK 後端，支援 tool_use |
| OpenAI-compatible API | `/v1/chat/completions` — CLI 後端，純文字，向下相容 |
| 多模型路由 | Opus 4.6 / Sonnet 4.6 / Haiku 4.5，透過 `model` 參數切換 |
| Plugin 系統 | pre/post 處理 hooks，放 `.js` 到 `plugins/` 即生效 |
| 用量統計 | `GET /stats` — 請求數、token 估算、平均回應時間 |
| 自動重試 | CLI 端點失敗時自動重試（`MAX_RETRIES`） |
| 內建 3 個 Plugin | 語言強化、內容過濾、成本追蹤 |

---

## 前置需求

| 項目 | 說明 | 檢查方式 |
|------|------|----------|
| macOS | 10.15+ | — |
| Node.js | 18+ | `node --version` |
| Claude Code CLI | 已安裝並登入 | `claude --version` && `claude auth status` |
| Claude Max 訂閱 | $200/月，需有效 | Claude CLI 登入後自動使用 |

```bash
# 安裝 Node.js（如果沒有）
brew install node

# 安裝 Claude Code CLI（如果沒有）
npm install -g @anthropic-ai/claude-code

# 登入 Claude（會開瀏覽器）
claude auth login

# 驗證
echo "hello" | claude --print
```

---

## 快速安裝

### 方法一：一鍵安裝（推薦）

```bash
git clone https://github.com/photofanz/openclaw-claude-proxy-v2.git
cd openclaw-claude-proxy-v2
bash install.sh
```

腳本會自動完成：
1. 檢查 Node.js、Claude CLI、認證狀態
2. 安裝 npm 依賴（含 Agent SDK）
3. 生成 `.env`（含隨機 API Key）
4. 驗證 Agent SDK 能呼叫 Claude
5. 建立 macOS LaunchAgent（開機自動啟動）
6. 啟動 proxy 並確認 health OK

安裝完成後會顯示你的 **API Key** 和 **OpenClaw 設定範例**。

### 方法二：手動安裝

```bash
git clone https://github.com/photofanz/openclaw-claude-proxy-v2.git
cd openclaw-claude-proxy-v2

# 安裝依賴
npm install

# 建立設定
cp .env.example .env
# 編輯 .env，至少設定 API_KEY

# 啟動
node server.js
```

---

## 設定說明（.env）

```env
PORT=3456                    # Proxy 埠號
API_KEY=sk-openclaw-xxxxx    # 認證金鑰（install.sh 自動產生）
CLAUDE_CLI_PATH=claude       # Claude CLI 路徑
MAX_CONCURRENT=2             # 最大並行請求數（建議 2）
REQUEST_TIMEOUT=300000       # 請求逾時（毫秒，預設 5 分鐘）
MAX_RETRIES=1                # CLI 失敗自動重試次數
PLUGINS_DIR=./plugins        # Plugin 目錄
```

---

## API 端點

### POST `/v1/messages` — Anthropic Messages API（主要端點）

使用 Claude Agent SDK 後端，支援 tool_use。

```bash
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

回應格式：
```json
{
  "id": "msg_abc123...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [{"type": "text", "text": "Hello! ..."}],
  "stop_reason": "end_turn",
  "usage": {"input_tokens": 12, "output_tokens": 35}
}
```

### POST `/v1/chat/completions` — OpenAI-compatible（Legacy）

使用 Claude CLI (`claude --print`) 後端，純文字回應。支援 streaming（simulated SSE）。

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### GET `/v1/models` — 列出可用模型

```bash
curl http://localhost:3456/v1/models -H "x-api-key: YOUR_API_KEY"
```

### GET `/health` — 健康檢查（不需認證）

```bash
curl http://localhost:3456/health
```

### GET `/stats` — 用量統計

```bash
curl http://localhost:3456/stats -H "x-api-key: YOUR_API_KEY"
```

回應範例：
```json
{
  "totalRequests": 142,
  "totalTokensEstimated": 85000,
  "errors": 2,
  "avgResponseMs": 7200,
  "byModel": {"claude-opus-4-6": {"count": 130, "tokens": 80000}},
  "byEndpoint": {"messages": 100, "chat_completions": 42}
}
```

---

## 多模型路由

```bash
# Opus 4.6 — 複雜推理，最強（預設）
"model": "claude-opus-4-6"

# Sonnet 4.6 — 快速，品質好
"model": "claude-sonnet-4-6"

# Haiku 4.5 — 最快，輕量任務
"model": "claude-haiku-4-5"
```

---

## Plugin 系統

放 `.js` 到 `plugins/` 目錄，proxy 啟動時自動載入。

```javascript
module.exports = {
  name: 'my-plugin',
  description: 'What it does',

  // 送出前處理（修改 messages 或 model）
  preProcess(messages, model) {
    return { messages, model };
  },

  // 收到回應後處理（修改回應文字）
  postProcess(text, model) {
    return text;
  }
};
```

### 內建 Plugin

| Plugin | 類型 | 說明 |
|--------|------|------|
| `language-enforcer.js` | pre | 偵測中文訊息，自動加入繁體中文回應指示 |
| `content-filter.js` | post | 過濾回應中的 API key、token、密碼等敏感資料 |
| `cost-tracker.js` | post | 追蹤每日省下的 API 費用，寫入 `~/.openclaw/logs/proxy-cost-savings.json` |

---

## 連接 OpenClaw

### 使用 Anthropic Messages API（推薦）

編輯 `~/.openclaw/openclaw.json`，在 `models.providers` 加入：

```json
"anthropic-claude": {
  "baseUrl": "http://localhost:3456/v1",
  "apiKey": "YOUR_API_KEY",
  "api": "anthropic-messages",
  "models": [
    {
      "id": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6 (proxy)",
      "reasoning": false,
      "input": ["text"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "claude-haiku-4-5",
      "name": "Claude Haiku 4.5 (proxy)",
      "reasoning": false,
      "input": ["text"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    {
      "id": "claude-opus-4-6",
      "name": "Claude Opus 4.6 (proxy)",
      "reasoning": true,
      "input": ["text"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 200000,
      "maxTokens": 16384
    }
  ]
}
```

設定預設模型：

```json
"agents": {
  "defaults": {
    "model": {
      "primary": "anthropic-claude/claude-sonnet-4-6"
    }
  }
}
```

### 使用 OpenAI-compatible API（Legacy）

```json
"claude-proxy": {
  "baseUrl": "http://localhost:3456/v1",
  "apiKey": "YOUR_API_KEY",
  "api": "openai-completions",
  "models": [
    {"id": "claude-opus-4-6", "name": "Claude Opus 4.6 (proxy)"}
  ]
}
```

---

## 架構

```
┌──────────────────────────────────────────────────────────────┐
│  Agent Fleet (OpenClaw / LangChain / custom)                  │
│                                                                │
│  Agent 1 ──┐                                                  │
│  Agent 2 ──┼── HTTP Request ──┐                               │
│  Agent 3 ──┘                  │                               │
│                                ▼                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Claude Code Proxy v3.0 (localhost:3456)              │     │
│  │                                                       │     │
│  │  Plugins:  [pre]  → language-enforcer                 │     │
│  │            [post] → content-filter, cost-tracker       │     │
│  │                                                       │     │
│  │  ┌─────────────────┬──────────────────────┐           │     │
│  │  │ /v1/messages    │ /v1/chat/completions │           │     │
│  │  │ Agent SDK       │ CLI (claude --print) │           │     │
│  │  │ 支援 tool_use   │ 純文字，支援 stream  │           │     │
│  │  └────────┬────────┴──────────┬───────────┘           │     │
│  │           │                   │                        │     │
│  │  Queue: MAX_CONCURRENT=2, rate limit, auto-retry       │     │
│  │  Stats: GET /stats, GET /health                        │     │
│  └───────────┼───────────────────┼────────────────────────┘     │
│              │                   │                               │
│              ▼                   ▼                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Claude Max Subscription (OAuth)                      │     │
│  │  Opus 4.6 · Sonnet 4.6 · Haiku 4.5                  │     │
│  └──────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

---

## 費用比較

| | Anthropic API | Claude Max + Proxy |
|---|---|---|
| Opus 4.6 | $15/M input, $75/M output | $200/月吃到飽 |
| 10 萬 tokens/天 | ~$225/月 | $200/月 |
| 50 萬 tokens/天 | ~$1,125/月 | $200/月 |
| 損益平衡 | ~8.9 萬 tokens/天 | 超過就是賺 |

---

## 日常管理

```bash
# 健康檢查
curl -s http://localhost:3456/health | python3 -m json.tool

# 查看日誌
tail -f ~/.openclaw/logs/claude-proxy.log

# 重啟 Proxy
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist

# 停止 Proxy
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist

# 更新
cd ~/openclaw-claude-proxy-v2
git pull && npm install
# 然後重啟（同上）
```

---

## 故障排除

| 症狀 | 原因 | 解法 |
|------|------|------|
| `health` 無回應 | Proxy 沒在跑 | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist` |
| `401 authentication_error` | API Key 不對 | 確認 OpenClaw config 的 `apiKey` 與 proxy `.env` 的 `API_KEY` 一致 |
| 回應很慢（>30 秒） | 大 prompt 或 Claude 限速 | 正常現象；確認 `MAX_CONCURRENT=2` |
| `No response from Claude` | Claude CLI 未登入 | 執行 `claude auth login` 重新登入 |
| 頻繁 `exit code 1` | Claude Max rate limit | 降低 `MAX_CONCURRENT` 為 1 |

---

## Credits

- Original: [51AutoPilot/openclaw-claude-proxy](https://github.com/51AutoPilot/openclaw-claude-proxy)
- Enhanced by: [Ultra Lab](https://ultralab.tw) — AI product company, Taiwan
- Built with: [OpenClaw](https://github.com/openclaw) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
