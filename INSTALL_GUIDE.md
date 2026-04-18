# Hermes Agent Claude Proxy v5.0 — 安裝指南

> 把 Claude Max 訂閱（$200/月）變成免費 API，供 Hermes Agent 使用（同時相容 OpenClaw）。
> v5.0 採 stateless 架構，每個請求獨立執行、不累積歷史、不跨 client 污染，
> 靠 Anthropic 原生 prompt caching 控制成本，內建工具支援（WebSearch、Bash 等）。
> 適用環境：macOS（launchd 自動啟動）

---

## 前置需求

| 項目 | 說明 | 檢查方式 |
|------|------|----------|
| macOS | 10.15+ | — |
| Node.js | 18 以上 | `node --version` |
| Claude Code CLI | 已安裝並登入 | `claude --version` && `claude auth status` |
| Claude Max 訂閱 | 需要有效訂閱 | `claude auth status --json` 顯示 `subscriptionType: "max"` |

### 安裝前置

```bash
# 安裝 Node.js（如果沒有）
brew install node

# 安裝 Claude Code CLI（如果沒有）
npm install -g @anthropic-ai/claude-code

# 登入 Claude（會開瀏覽器）
claude auth login
```

---

## Step 1：下載專案

```bash
cd ~
git clone https://github.com/photofanz/openclaw-claude-proxy-v4.git hermes-claude-proxy
cd hermes-claude-proxy
```

> 若你同時要服務 OpenClaw，建議再 fork 一份獨立 proxy（例如 `openclaw-claude-proxy/`），
> 跑在不同 port（例如 3457）。v5 雖然已靠 stateless 排除跨 client 污染，但獨立 process
> 仍是最乾淨的隔離方案（獨立 log、獨立 stats、獨立 API_KEY）。

---

## Step 2：執行安裝腳本

```bash
bash install.sh
```

腳本會自動完成：
1. ✅ 檢查 Node.js、Claude CLI、登入狀態
2. ✅ 安裝 npm 依賴（含 Agent SDK）
3. ✅ 生成 `.env`（含 `STATELESS_MODE=1` 預設開啟）
4. ✅ 驗證 Agent SDK 能呼叫 Claude
5. ✅ 建立 LaunchAgent `com.hermes.claude-proxy`（開機自動啟動）
6. ✅ 啟動 proxy 並確認 health OK（`mode: stateless`）

安裝完成後，螢幕會顯示：
- **API Key**（若有設定）— 記下來，下一步要用
- **Hermes / OpenClaw provider 設定**（JSON / YAML）— 複製備用

---

## Step 3：驗證 Proxy

```bash
# Health check
curl -s http://localhost:3456/health | python3 -m json.tool

# 測試回應
curl -s --max-time 30 -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Say OK"}]
  }' | python3 -m json.tool

# 測試 WebSearch 工具
curl -s --max-time 60 -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "搜尋今天的新聞頭條"}]
  }' | python3 -m json.tool
```

應該在 10 秒內回應 OpenAI 格式的 JSON。

---

## Step 4：設定 Hermes Agent

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

## Step 5：設定 OpenClaw（選配，如果有安裝 OpenClaw）

> 本 proxy 同時相容 OpenClaw，使用 `openai-completions` 模式連接同一個端點。

編輯 `~/.openclaw/openclaw.json`，在 `models.providers` 區塊加入：

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

> **注意：** v4.0 起使用 OpenAI `/v1/chat/completions` 端點，OpenClaw 側的 `api` 值必須填 `openai-completions`（OpenClaw schema 的命名，並非 `openai-chat`），且不需要 API Key。

設定 primary model：

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

## Step 6：確認端對端

從 Telegram 發一則訊息給 Hermes bot（或 OpenClaw bot），確認有回應。

---

## 日常管理

### 查看狀態

```bash
# Proxy health
curl -s http://localhost:3456/health | python3 -m json.tool

# 用量統計
curl -s http://localhost:3456/stats -H "x-api-key: 你的API_KEY" | python3 -m json.tool

# 日誌
tail -f ~/.hermes/logs/claude-proxy.log
```

### 重啟 Proxy

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
```

### 停止 Proxy

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
```

### 更新 Proxy

```bash
cd ~/hermes-claude-proxy
git pull
npm install
# 重啟
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist
```

---

## Endpoints

| Method | Path | 說明 |
|--------|------|------|
| POST | `/v1/chat/completions` | OpenAI-compatible（stateless per request） |
| GET | `/v1/models` | 列出可用模型 |
| GET | `/health` | 健康檢查（含運行模式 `mode`） |
| GET | `/stats` | 用量統計 |

---

## 內建工具

v5.0 每次 stateless query 預設開放以下工具：

| 工具 | 說明 |
|------|------|
| `WebSearch` | 網路搜尋 |
| `WebFetch` | 擷取網頁內容 |
| `Bash(*)` | 執行所有 shell 指令 |
| `Read` | 讀取檔案 |
| `Write` | 寫入檔案 |
| `Edit` | 編輯檔案 |
| `Grep` | 搜尋檔案內容 |
| `Glob` | 搜尋檔案路徑 |

---

## 故障排除

| 症狀 | 原因 | 解法 |
|------|------|------|
| `health` 無回應 | Proxy 沒在跑 | `launchctl load ~/Library/LaunchAgents/com.hermes.claude-proxy.plist` |
| 每次請求冷啟動 2-3 秒 | stateless 每次重啟 subprocess（符合預期） | 依賴 prompt caching 降低成本，非 bug |
| `extra usage` / 429 usage limit | Claude 帳號額度用盡 | 到 https://claude.ai/settings/usage 儲值或等週期重置 |
| WebSearch/工具被擋 | 工具權限未開 | 確認 server.js 的 `allowedTools` 清單，重啟 proxy |
| SDK 呼叫失敗 | Claude CLI 未登入 | 執行 `claude auth login` 重新登入 |

---

## 架構說明

```
Hermes Gateway（或其他 client）
  │
  ▼
Proxy (localhost:3456)
  │
  └─ POST /v1/chat/completions
       └→ SDK stateless query (per request)
            └→ Claude Max OAuth (自動認證)
                 └→ Anthropic API（含 prompt caching）
                      └→ 內建工具：WebSearch, Bash, Read/Write...
```

- **Stateless 架構** 每個請求開新 query、用完即釋放，server 端無任何對話狀態
- **Prompt caching** 靠 Anthropic 原生 5 分鐘 TTL 快取，system prompt 重複使用時成本降至 10%
- **OAuth 認證** 使用 Claude Code CLI 的登入狀態，不需要 Anthropic API Key
- **內建工具** WebSearch、Bash、Read/Write 等，在 `allowedTools` 中設定
- **cost 設為 0** 因為走的是 Claude Max 訂閱，不計 API 費用
- **雙平台相容** Hermes Agent（`chat_completions`）和 OpenClaw（`openai-completions`）皆可直接連接；如要完全隔離建議各自 fork 獨立 proxy
