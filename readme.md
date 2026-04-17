# Hermes Agent ↔ Claude Code Proxy v4.0

> 把 Claude Max 訂閱（$200/月）變成免費 API，讓 OpenClaw / Hermes 等 AI agent 直接呼叫。

**Persistent Session 架構，大幅降低 token 消耗。**

```
Agents / OpenClaw / Hermes       Proxy (localhost:3456)            Claude Max
  │                                │                                │
  ├─ POST /v1/chat/completions ──►│── SDK persistent session ─────►│ Opus/Sonnet/Haiku
  │  (OpenAI-compatible)          │   (session 重用，prompt cache)  │
  └─ GET /health, /stats ────────►│                                │
```

---

## v4.0 重大變更

| 項目 | v3.0 | v4.0 |
|------|------|------|
| 後端 | `claude --print`（每次新 session） | SDK persistent session（重用 session） |
| Token 消耗 | 高（每次載入 ~8K CLI system prompt） | 低（system prompt 只載入一次，靠 cache） |
| 端點 | `/v1/messages` + `/v1/chat/completions` | 統一 `/v1/chat/completions` |
| API 格式 | Anthropic + OpenAI | 統一 OpenAI-compatible |
| Extra usage 問題 | 大 system prompt 容易觸發 | 解決（persistent session 不重複載入） |

---

## 功能特色

| 功能 | 說明 |
|------|------|
| Persistent Session | 每個 model 維護長期 session，system prompt 只載入一次 |
| OpenAI-compatible API | `/v1/chat/completions` — 相容所有 OpenAI 客戶端 |
| 多模型路由 | Opus 4.6 / Sonnet 4.6 / Haiku 4.5，透過 `model` 參數切換 |
| Session 自動重建 | session 異常時自動清除並重建 |
| 請求序列化 | 同一 model 的請求自動排隊，避免並行衝突 |
| Plugin 系統 | pre/post 處理 hooks，放 `.js` 到 `plugins/` 即生效 |
| 用量統計 | `GET /stats` — 請求數、token 估算、活躍 session |
| 自動重試 | 失敗時自動重試（`MAX_RETRIES`） |
| Streaming | 支援 simulated SSE streaming |

---

## 前置需求

| 項目 | 說明 | 檢查方式 |
|------|------|----------|
| macOS | 10.15+ | — |
| Node.js | 18+ | `node --version` |
| Claude Code CLI | 已安裝並登入 | `claude --version` |
| Claude Max 訂閱 | $200/月，需有效 | CLI 登入後自動使用 OAuth |

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
git clone https://github.com/photofanz/openclaw-claude-proxy-v2.git openclaw-claude-proxy
cd openclaw-claude-proxy
bash install.sh
```

### 方法二：手動安裝

```bash
git clone https://github.com/photofanz/openclaw-claude-proxy-v2.git openclaw-claude-proxy
cd openclaw-claude-proxy
npm install
cp .env.example .env
# 編輯 .env
node server.js
```

---

## 設定說明（.env）

```env
PORT=3456                    # Proxy 埠號
API_KEY=                     # 認證金鑰（留空 = 不需認證，適合本機使用）
MAX_CONCURRENT=2             # 最大並行請求數（建議 2）
REQUEST_TIMEOUT=300000       # 請求逾時（毫秒，預設 5 分鐘）
MAX_RETRIES=1                # 失敗自動重試次數
PLUGINS_DIR=./plugins        # Plugin 目錄
```

> **注意：** v4.0 不再需要 `CLAUDE_CLI_PATH`，改用 Agent SDK 直接呼叫。

---

## API 端點

### POST `/v1/chat/completions` — OpenAI-compatible（主要端點）

透過 persistent session 呼叫 Claude，支援 streaming。

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

回應格式：
```json
{
  "id": "chatcmpl-abc123...",
  "object": "chat.completion",
  "model": "claude-sonnet-4-6",
  "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello! ..."}, "finish_reason": "stop"}],
  "usage": {"prompt_tokens": 12, "completion_tokens": 35, "total_tokens": 47}
}
```

Streaming（SSE）：
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-6", "stream": true, "messages": [{"role": "user", "content": "Hello!"}]}'
```

### GET `/v1/models` — 列出可用模型

```bash
curl http://localhost:3456/v1/models
```

### GET `/health` — 健康檢查（不需認證）

```bash
curl http://localhost:3456/health
```

回應包含活躍 session 資訊：
```json
{
  "status": "ok",
  "version": "4.0.0",
  "active_sessions": ["sonnet"],
  "active_requests": 0
}
```

### GET `/stats` — 用量統計

```bash
curl http://localhost:3456/stats
```

---

## 多模型路由

```bash
# Opus 4.6 — 複雜推理，最強
"model": "claude-opus-4-6"

# Sonnet 4.6 — 快速，品質好（推薦）
"model": "claude-sonnet-4-6"

# Haiku 4.5 — 最快，輕量任務
"model": "claude-haiku-4-5"
```

每個 model 維護獨立的 persistent session。首次請求會建立 session，後續請求重用。

---

## Plugin 系統

放 `.js` 到 `plugins/` 目錄，proxy 啟動時自動載入。

```javascript
module.exports = {
  name: 'my-plugin',
  description: 'What it does',
  preProcess(messages, model) { return { messages, model }; },
  postProcess(text, model) { return text; }
};
```

### 內建 Plugin

| Plugin | 類型 | 說明 |
|--------|------|------|
| `language-enforcer.js` | pre | 偵測中文訊息，自動加入繁體中文回應指示 |
| `content-filter.js` | post | 過濾回應中的 API key、token 等敏感資料 |
| `cost-tracker.js` | post | 追蹤每日省下的 API 費用 |

---

## 連接 OpenClaw

編輯 `~/.openclaw/openclaw.json`，在 `models.providers` 加入：

```json
"claude-proxy": {
  "baseUrl": "http://localhost:3456/v1",
  "apiKey": "",
  "api": "openai-chat",
  "models": [
    {
      "id": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6 (proxy)",
      "reasoning": true,
      "input": ["text", "image"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 200000,
      "maxTokens": 16384
    },
    {
      "id": "claude-opus-4-6",
      "name": "Claude Opus 4.6 (proxy)",
      "reasoning": true,
      "input": ["text", "image"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 200000,
      "maxTokens": 16384
    },
    {
      "id": "claude-haiku-4-5",
      "name": "Claude Haiku 4.5 (proxy)",
      "reasoning": false,
      "input": ["text", "image"],
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
      "contextWindow": 200000,
      "maxTokens": 8192
    }
  ]
}
```

設定預設模型：

```json
"agents": {
  "defaults": {
    "model": {
      "primary": "claude-proxy/claude-sonnet-4-6"
    }
  }
}
```

## 連接 Hermes

編輯 `~/.hermes/config.yaml`：

```yaml
model:
  default: claude-sonnet-4-6
  provider: claude-proxy
  base_url: http://localhost:3456/v1

custom_providers:
- name: claude-proxy
  base_url: http://localhost:3456/v1
  api_key: ''
  api_mode: chat_completions
  model: claude-opus-4-6
- name: claude-proxy
  base_url: http://localhost:3456/v1
  api_key: ''
  api_mode: chat_completions
  model: claude-sonnet-4-6
- name: claude-proxy
  base_url: http://localhost:3456/v1
  api_key: ''
  api_mode: chat_completions
  model: claude-haiku-4-5
```

---

## 架構

```
┌──────────────────────────────────────────────────────────────┐
│  Agent Fleet (OpenClaw / Hermes / LangChain / custom)         │
│                                                                │
│  Agent 1 ──┐                                                  │
│  Agent 2 ──┼── HTTP Request ──┐                               │
│  Agent 3 ──┘                  │                               │
│                                ▼                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Claude Code Proxy v4.0 (localhost:3456)              │     │
│  │                                                       │     │
│  │  Plugins:  [pre]  → language-enforcer                 │     │
│  │            [post] → content-filter, cost-tracker       │     │
│  │                                                       │     │
│  │  ┌──────────────────────────────────────────┐         │     │
│  │  │ /v1/chat/completions (OpenAI-compatible) │         │     │
│  │  │ SDK persistent session (per model)       │         │     │
│  │  │ Session 重用 + prompt cache              │         │     │
│  │  └────────────────────┬─────────────────────┘         │     │
│  │                       │                                │     │
│  │  Queue: MAX_CONCURRENT=2, rate limit, auto-retry       │     │
│  │  Stats: GET /stats, GET /health                        │     │
│  └───────────────────────┼────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
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
launchctl unload ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
launchctl load ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist

# 停止 Proxy
launchctl unload ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
```

---

## 故障排除

| 症狀 | 原因 | 解法 |
|------|------|------|
| `health` 無回應 | Proxy 沒在跑 | `launchctl load ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist` |
| 回應很慢（>30 秒） | 大 prompt 或 Claude 限速 | 正常現象；確認 `MAX_CONCURRENT=2` |
| `extra usage` 錯誤 | Claude 帳號月額度用盡 | 等月初重置或購買額度 |
| Session 建立失敗 | Claude CLI 未登入 | 執行 `claude auth login` 重新登入 |
| 頻繁 session 重建 | 網路不穩 | 檢查 log，確認 OAuth 有效 |

---

## 從 v3.0 升級

```bash
cd ~/openclaw-claude-proxy
git pull
npm install

# 更新 .env：移除 CLAUDE_CLI_PATH（不再需要）
# 更新 OpenClaw config：api 從 "anthropic-messages" 改為 "openai-chat"
# 更新 Hermes config：api_mode 從 "anthropic_messages" 改為 "chat_completions"

# 重啟
launchctl unload ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
launchctl load ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
```

---

## Credits

- Original: [51AutoPilot/openclaw-claude-proxy](https://github.com/51AutoPilot/openclaw-claude-proxy)
- Enhanced by: [Ultra Lab](https://ultralab.tw) — AI product company, Taiwan
- Built with: [OpenClaw](https://github.com/openclaw) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
