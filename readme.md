# Hermes Agent ↔ Claude Code Proxy v5.0

> 把 Claude Max 訂閱（$200/月）變成免費 API，供 Hermes Agent 及其他 AI agent 使用。
> 同時相容 OpenClaw。

**Stateless 架構，每請求獨立無污染，靠 prompt caching 控制成本，內建 WebSearch 等工具。**

```
Hermes / OpenClaw / 其他 Agent    Proxy (localhost:3456)            Claude Max
  │                                │                                │
  ├─ POST /v1/chat/completions ──►│── SDK stateless query ────────►│ Opus/Sonnet/Haiku
  │  (OpenAI-compatible)          │   (每次獨立 + prompt caching)   │
  └─ GET /health, /stats ────────►│                                │
```

> **多 client 同時接入？** 建議每個 client 各跑一個獨立的 proxy fork（例如 Hermes 3456、
> OpenClaw 3457），完全避免跨服務互相干擾。v5 本身已靠 stateless 排除大部分風險，但
> 獨立 process 是最乾淨的隔離方案。

---

## 相容性

| 平台 | 狀態 | API 模式 | 設定檔 |
|------|------|----------|--------|
| **Hermes Agent** | 主要開發對象，完整測試 | `chat_completions` | `~/.hermes/config.yaml` |
| **OpenClaw** | 完全相容 | `openai-completions` | `~/.openclaw/openclaw.json` |
| **其他 OpenAI-compatible 客戶端** | 相容 | 標準 OpenAI 格式 | 依客戶端而定 |

本專案使用標準的 OpenAI `/v1/chat/completions` 格式，任何支援 OpenAI API 的客戶端都可以直接連接。

---

## v5.0 重大變更

| 項目 | v4.0 | v5.0 |
|------|------|------|
| 後端 | SDK persistent session（重用 session） | SDK stateless query（每次獨立、用完即釋放） |
| 跨 client 污染 | **有**（多 client 共用 session 會互相干擾、洩漏對話歷史） | **無**（每次請求隔離，無共享狀態） |
| 歷史累積 | session 內累積 O(N²) token 膨脹，長跑會爆 context | 歷史由 client 控制，O(N) 線性、可預測 |
| OpenAI API 語義 | 違反（stateless 呼叫被塞進 stateful session） | 符合（真正 stateless） |
| Token 成本 | session 節省 system prompt 首次載入 | 靠 Anthropic prompt caching（5 min TTL、90% 折扣）補償 |
| `/new` 重置行為 | 無效（proxy 端仍保留歷史） | **自動生效**（bot 端清歷史＝乾淨重啟） |
| 回溯相容 | — | `STATELESS_MODE=0` 可切回舊 session 模式 |

### v4.0 → v5.0 的動機

v4 的 persistent session 節省了 system prompt 重複載入，代價是**跨 client/跨請求的 session 污染**：多個 bot（Hermes + OpenClaw）共用同 model 時會看到彼此的對話歷史；單 client 多輪時 session 會累積冗餘歷史（O(N²)），加速耗盡 Claude Max 額度。v5 的 stateless 架構徹底解決這兩個問題，Anthropic 原生的 prompt caching 替代了 v4 的自製 session 快取。

---

## v4.0 重大變更（歷史）

| 項目 | v3.0 | v4.0 |
|------|------|------|
| 後端 | `claude --print`（每次新 session） | SDK persistent session（重用 session） |
| Token 消耗 | 高（每次載入 ~8K CLI system prompt） | 低（system prompt 只載入一次，靠 cache） |
| 端點 | `/v1/messages` + `/v1/chat/completions` | 統一 `/v1/chat/completions` |
| API 格式 | Anthropic + OpenAI | 統一 OpenAI-compatible |
| Extra usage 問題 | 大 system prompt 容易觸發 | 部分緩解（session 不重複載入，但有污染副作用） |
| 工具支援 | 無（純文字回覆） | 內建 WebSearch、Bash、Read/Write 等工具 |

---

## 功能特色

| 功能 | 說明 |
|------|------|
| Stateless 架構 | 每個請求開新 query、用完即釋放，無跨請求狀態、無跨 client 污染 |
| Prompt Caching | 靠 Anthropic 原生 5 分鐘 TTL 快取，system prompt 反覆使用時成本降至 10% |
| 內建工具支援 | WebSearch、WebFetch、Bash、Read、Write、Edit、Grep、Glob |
| OpenAI-compatible API | `/v1/chat/completions` — 相容 Hermes、OpenClaw 及所有 OpenAI 客戶端 |
| 多模型路由 | Opus 4.7 / Sonnet 4.6 / Haiku 4.5，透過 `model` 參數切換 |
| `STATELESS_MODE` 開關 | 環境變數 `=1`（預設）走 stateless；`=0` 退回舊 persistent session |
| 並行處理 | 最多 `MAX_CONCURRENT` 個請求同時執行（無 session 序列化限制） |
| Plugin 系統 | pre/post 處理 hooks，放 `.js` 到 `plugins/` 即生效 |
| 用量統計 | `GET /stats` — 請求數、token 估算、運行模式 |
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
git clone https://github.com/photofanz/openclaw-claude-proxy-v4.git hermes-claude-proxy
cd hermes-claude-proxy
bash install.sh
```

### 方法二：手動安裝

```bash
git clone https://github.com/photofanz/openclaw-claude-proxy-v4.git hermes-claude-proxy
cd hermes-claude-proxy
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
STATELESS_MODE=1             # 1=stateless（v5 預設、無污染）；0=legacy persistent session
```

> **注意：** v4.0 起不再需要 `CLAUDE_CLI_PATH`，改用 Agent SDK 直接呼叫。
> **v5 改動：** `STATELESS_MODE=1` 為預設。除非你有特殊理由需要舊 session 行為（例如想保留 server 端對話記憶），否則保持預設即可。

---

## API 端點

### POST `/v1/chat/completions` — OpenAI-compatible（主要端點）

每個請求以 stateless query 呼叫 Claude，支援 streaming。

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

回應包含運行模式：
```json
{
  "status": "ok",
  "version": "5.0.0",
  "mode": "stateless",
  "active_sessions": "stateless",
  "active_requests": 0,
  "max_concurrent": 2,
  "uptime_seconds": 123
}
```

### GET `/stats` — 用量統計

```bash
curl http://localhost:3456/stats
```

---

## 多模型路由

```bash
# Opus 4.7 — 複雜推理，最強
"model": "claude-opus-4-7"

# Sonnet 4.6 — 快速，品質好（推薦）
"model": "claude-sonnet-4-6"

# Haiku 4.5 — 最快，輕量任務
"model": "claude-haiku-4-5"
```

每個請求走獨立的 stateless query，model 只透過參數指定、無 server 端 session 綁定。

---

## 內建工具

每次 stateless query 預設開放以下 Claude Code 工具：

| 工具 | 說明 |
|------|------|
| `WebSearch` | 網路搜尋（即時資訊） |
| `WebFetch` | 擷取網頁內容 |
| `Bash(*)` | 執行所有 shell 指令 |
| `Read` | 讀取檔案 |
| `Write` | 寫入檔案 |
| `Edit` | 編輯檔案 |
| `Grep` | 搜尋檔案內容 |
| `Glob` | 搜尋檔案路徑 |

> 工具在 `server.js` 的 `allowedTools` 中設定。如需新增或移除工具，修改該陣列後重啟 proxy。

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

## 連接 Hermes Agent

Hermes Agent 是本專案的主要開發對象，使用 `chat_completions` 模式。

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
  model: claude-opus-4-7
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

重啟 Hermes Gateway：

```bash
launchctl unload ~/Library/LaunchAgents/ai.hermes.gateway.plist
launchctl load ~/Library/LaunchAgents/ai.hermes.gateway.plist
```

---

## 連接 OpenClaw

本專案同時相容 OpenClaw。OpenClaw 在 config 中須將 `api` 欄位設為 `openai-completions`（OpenClaw schema 的合法值，指向相同的 `/v1/chat/completions` 端點）。

編輯 `~/.openclaw/openclaw.json`，在 `models.providers` 加入：

```json
"claude-proxy": {
  "baseUrl": "http://localhost:3456/v1",
  "apiKey": "",
  "api": "openai-completions",
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
      "id": "claude-opus-4-7",
      "name": "Claude Opus 4.7 (proxy)",
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

重啟 OpenClaw Gateway：

```bash
launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

---

## 架構

```
┌──────────────────────────────────────────────────────────────┐
│  Hermes Agent / OpenClaw / 其他 OpenAI-compatible 客戶端      │
│                                                                │
│  Hermes ───┐                                                  │
│  OpenClaw ─┼── HTTP Request ──┐                               │
│  Custom ───┘                  │                               │
│                                ▼                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Claude Code Proxy v5.0 (localhost:3456)              │     │
│  │                                                       │     │
│  │  Plugins:  [pre]  → language-enforcer                 │     │
│  │            [post] → content-filter, cost-tracker       │     │
│  │                                                       │     │
│  │  ┌──────────────────────────────────────────┐         │     │
│  │  │ /v1/chat/completions (OpenAI-compatible) │         │     │
│  │  │ SDK stateless query (per request)        │         │     │
│  │  │ Anthropic prompt caching (5 min TTL)     │         │     │
│  │  │ 工具：WebSearch, Bash, Read/Write...     │         │     │
│  │  └────────────────────┬─────────────────────┘         │     │
│  │                       │                                │     │
│  │  Concurrency: MAX_CONCURRENT=2, rate limit, auto-retry │     │
│  │  Stats: GET /stats, GET /health                        │     │
│  └───────────────────────┼────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  Claude Max Subscription (OAuth)                      │     │
│  │  Opus 4.7 · Sonnet 4.6 · Haiku 4.5                  │     │
│  └──────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

---

## 費用比較

| | Anthropic API | Claude Max + Proxy |
|---|---|---|
| Opus 4.7 | $15/M input, $75/M output | $200/月吃到飽 |
| 10 萬 tokens/天 | ~$225/月 | $200/月 |
| 50 萬 tokens/天 | ~$1,125/月 | $200/月 |
| 損益平衡 | ~8.9 萬 tokens/天 | 超過就是賺 |

---

## 日常管理

```bash
# 健康檢查
curl -s http://localhost:3456/health | python3 -m json.tool

# 查看日誌
tail -f ~/.hermes/logs/claude-proxy.log

# 重啟 Proxy
launchctl unload ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
launchctl load ~/Library/LaunchAgents/com.hermes.claude-proxy.plist

# 停止 Proxy
launchctl unload ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
```

---

## 故障排除

| 症狀 | 原因 | 解法 |
|------|------|------|
| `health` 無回應 | Proxy 沒在跑 | `launchctl load ~/Library/LaunchAgents/com.hermes.claude-proxy.plist` |
| 每次請求冷啟動 2-3 秒 | stateless 模式每次重啟 subprocess（符合預期） | 依賴 prompt caching 降低成本，非 bug |
| `extra usage` / 429 usage limit | Claude 帳號額度用盡 | 到 https://claude.ai/settings/usage 儲值或等週期重置 |
| WebSearch/工具被擋 | 工具權限未開 | 確認 server.js 的 `allowedTools` 清單，重啟 proxy |
| SDK 呼叫失敗 | Claude CLI 未登入 | 執行 `claude auth login` 重新登入 |
| 需要跨輪對話記憶 | stateless 預期不保留歷史 | client 端（bot）自行維護 `messages[]`；若真的需要 server 記憶可 `STATELESS_MODE=0` 切回 session |

---

## 從 v4.0 升級

```bash
cd ~/hermes-claude-proxy
git pull
npm install

# v5 改動：
# 1. .env 新增 STATELESS_MODE=1（預設啟用，推薦保留）
# 2. launchd plist 在 EnvironmentVariables 新增 STATELESS_MODE=1
# 3. 若本機同時跑多個 client（Hermes + OpenClaw），建議各自 fork 一份獨立 proxy
#    並使用不同 port，徹底隔離

# 重啟
launchctl unload ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
launchctl load ~/Library/LaunchAgents/com.hermes.claude-proxy.plist

# 驗證已切到 stateless
curl -s http://localhost:3456/health | python3 -m json.tool
# 期望看到 "mode": "stateless"
```

## 從 v3.0 升級

```bash
cd ~/hermes-claude-proxy
git pull
npm install

# 更新 .env：移除 CLAUDE_CLI_PATH（不再需要）、新增 STATELESS_MODE=1
# 更新 Hermes config：api_mode 從 "anthropic_messages" 改為 "chat_completions"
# 更新 OpenClaw config：api 從 "anthropic-messages" 改為 "openai-completions"

# 重啟
launchctl unload ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
launchctl load ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
```

---

## Credits

- Original: [51AutoPilot/openclaw-claude-proxy](https://github.com/51AutoPilot/openclaw-claude-proxy)
- Enhanced by: [Ultra Lab](https://ultralab.tw) — AI product company, Taiwan
- Built with: [Hermes Agent](https://github.com/hermes-ai) + [OpenClaw](https://github.com/openclaw) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
