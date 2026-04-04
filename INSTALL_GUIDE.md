# OpenClaw Claude Proxy v3.0 — 安裝指南

> 把 Claude Max 訂閱（$200/月）變成免費 API，供 OpenClaw 等 AI agent 使用。
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
git clone https://github.com/photofanz/openclaw-claude-proxy-v2.git
cd openclaw-claude-proxy
```

---

## Step 2：執行安裝腳本

```bash
bash install.sh
```

腳本會自動完成：
1. ✅ 檢查 Node.js、Claude CLI、登入狀態
2. ✅ 安裝 npm 依賴（含 Agent SDK）
3. ✅ 生成 `.env`（含隨機 API Key）
4. ✅ 驗證 Agent SDK 能呼叫 Claude
5. ✅ 建立 LaunchAgent（開機自動啟動）
6. ✅ 啟動 proxy 並確認 health OK

安裝完成後，螢幕會顯示：
- **API Key**（`sk-openclaw-...`）— 記下來，下一步要用
- **OpenClaw provider 設定**（JSON）— 複製備用

---

## Step 3：驗證 Proxy

```bash
# Health check
curl -s http://localhost:3456/health | python3 -m json.tool

# 測試回應
curl -s --max-time 30 -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: 你的API_KEY" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 50,
    "messages": [{"role": "user", "content": "Say OK"}]
  }' | python3 -m json.tool
```

應該在 10 秒內回應 `{"type": "message", "content": [{"type": "text", "text": "OK"}]}`。

---

## Step 4：設定 OpenClaw（如果有安裝 OpenClaw）

編輯 `~/.openclaw/openclaw.json`，在 `models.providers` 區塊加入：

```json
"anthropic-claude": {
  "baseUrl": "http://localhost:3456/v1",
  "apiKey": "你的API_KEY（install.sh 產生的 sk-openclaw-...）",
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

設定 primary model：

```json
"agents": {
  "defaults": {
    "model": {
      "primary": "anthropic-claude/claude-sonnet-4-6"
    }
  }
}
```

重啟 OpenClaw Gateway：

```bash
openclaw gateway stop
openclaw gateway start
```

---

## Step 5：確認端對端

從 Telegram / Discord / Slack 發一則訊息給 OpenClaw bot，確認有回應。

或用 CLI 測試：

```bash
openclaw agent --message "Hello" --to telegram:你的CHAT_ID
```

---

## 日常管理

### 查看狀態

```bash
# Proxy health
curl -s http://localhost:3456/health | python3 -m json.tool

# 用量統計
curl -s http://localhost:3456/stats -H "x-api-key: 你的API_KEY" | python3 -m json.tool

# 日誌
tail -f ~/.openclaw/logs/claude-proxy.log
```

### 重啟 Proxy

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
```

### 停止 Proxy

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
```

### 更新 Proxy

```bash
cd ~/openclaw-claude-proxy
git pull
npm install
# 重啟
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist
```

---

## Endpoints

| Method | Path | 說明 |
|--------|------|------|
| POST | `/v1/messages` | Anthropic Messages API（Agent SDK backend，主要端點） |
| POST | `/v1/chat/completions` | OpenAI-compatible（CLI backend，純文字，legacy） |
| GET | `/v1/models` | 列出可用模型 |
| GET | `/health` | 健康檢查 |
| GET | `/stats` | 用量統計（需 API Key） |

---

## 故障排除

| 症狀 | 原因 | 解法 |
|------|------|------|
| `health` 無回應 | Proxy 沒在跑 | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.claude-proxy.plist` |
| `401 authentication_error` | API Key 不對 | 確認 OpenClaw config 的 `apiKey` 與 proxy `.env` 的 `API_KEY` 一致 |
| 回應很慢（>30 秒） | 大 prompt 或 Claude 限速 | 正常現象；確認 `MAX_CONCURRENT=2` |
| `No response from Claude` | Claude CLI 未登入 | 執行 `claude auth login` 重新登入 |
| 頻繁 `exit code 1` | Claude Max rate limit | 降低 `MAX_CONCURRENT` 為 1，增加間隔 |
| `error_max_turns` | `maxTurns` 設太大 | 確認 server.js 裡 `maxTurns: 1` |

---

## 架構說明

```
OpenClaw Gateway
  │
  ▼
Proxy (localhost:3456)
  │
  ├─ POST /v1/messages
  │    └→ Claude Agent SDK query()
  │         └→ Claude Max OAuth (自動認證)
  │              └→ Anthropic API
  │
  └─ POST /v1/chat/completions (legacy)
       └→ claude --print (CLI subprocess)
```

- **Agent SDK** 使用 Claude Code CLI 的 OAuth session，不需要 Anthropic API Key
- **Proxy API Key**（`sk-openclaw-...`）是 proxy 自己的認證，防止未授權存取
- **cost 設為 0** 因為走的是 Claude Max 訂閱，不計 API 費用
