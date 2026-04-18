# Hermes Agent + Claude Proxy v5.0 遠端部署指南

> 目標：透過 SSH 在新的 Mac Mini 上安裝 Hermes Agent + Claude Proxy v5.0
> v5.0 採 stateless 架構（每請求獨立、無污染），內建 WebSearch/Bash 等工具支援
> 同時相容 OpenClaw（建議另 fork 一份獨立 proxy 跑不同 port）
> 工具：Claude Code 的 `openclaw-install` 技能 + 手動微調

---

## 事前準備（在你的 MacBook 上完成）

### 需要準備的資訊

| 項目 | 說明 | 怎麼取得 |
|------|------|----------|
| Mac Mini SSH 連線 | `user@IP` 或 Tailscale IP | 確認能 `ssh user@IP` |
| Claude Max 帳號密碼 | 登入用 | 你自己的帳號 |
| Telegram Bot Token | Bot 認證 | @BotFather → /newbot |
| Telegram User ID | 白名單用 | @userinfobot → 發訊息取得數字 ID |
| 客戶的 Telegram User ID | 讓客戶也能用 | 同上，讓客戶操作 |

### 確認檔案就緒

```bash
# 打包檔
ls -lh ~/hermes-claude-proxy-v5.0-deploy.tar.gz

# 或直接用 GitHub
# https://github.com/photofanz/openclaw-claude-proxy-v4
```

---

## Phase 1：Mac Mini 基礎環境（SSH 進去手動做）

```bash
# 1-1. 確認 SSH 能連
ssh user@<MAC_MINI_IP>

# 1-2. 安裝 Homebrew（如果沒有）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# ⚠️ 裝完後按照提示把 brew 加到 PATH

# 1-3. 安裝 Node.js
brew install node
node --version  # 確認 18+

# 1-4. 安裝 Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude --version

# 1-5. Claude CLI 認證（⚠️ 需要瀏覽器）
claude auth login
# → 會顯示一個 URL，在 Mac Mini 的瀏覽器打開登入
# → 或者用 SSH tunnel: ssh -L 8080:localhost:8080 user@IP，在本機瀏覽器開
# → 登入你的 Claude Max 帳號

# 1-6. 驗證認證
claude auth status
echo "hello" | claude --print
```

**⚠️ 注意：Step 1-5 是最耗時的步驟，需要有螢幕/VNC 或 SSH tunnel**

---

## Phase 2：安裝 OpenClaw（用 openclaw-install 技能）

回到你的 MacBook，在 Claude Code 中執行：

```
/openclaw-install
```

告訴技能：
- 安裝方式：**遠端 SSH**
- 目標機器：`user@<MAC_MINI_IP>`
- 通道：**Telegram**
- Bot Token：（貼上）
- User ID：（貼上）
- Model provider：先選任意一個（等等會改成 claude-proxy）

技能會自動完成：
- ✅ npm install -g openclaw
- ✅ 設定 Telegram channel
- ✅ 建立 LaunchAgent
- ✅ 啟動 Gateway

---

## Phase 3：安裝 hermes-claude-proxy-v5（SSH 進去）

```bash
# 3-1. 傳檔案到 Mac Mini
scp ~/hermes-claude-proxy-v5.0-deploy.tar.gz user@<MAC_MINI_IP>:~/

# 3-2. SSH 進去
ssh user@<MAC_MINI_IP>

# 3-3. 解壓安裝
mkdir -p ~/hermes-claude-proxy && cd ~/hermes-claude-proxy
tar xzf ~/hermes-claude-proxy-v5.0-deploy.tar.gz
bash install.sh

# install.sh 會自動：
# ✅ 檢查 Node.js、Claude CLI、認證
# ✅ npm install（含 Agent SDK）
# ✅ 產生 .env（含 STATELESS_MODE=1 預設）
# ✅ 測試 Agent SDK
# ✅ 建立 LaunchAgent com.hermes.claude-proxy（開機自動啟動）
# ✅ 健康檢查（mode: stateless）

# 3-4. 如有設定 API_KEY，記下；否則本機預設無 auth
```

---

## Phase 4：設定 Hermes Agent / OpenClaw 使用 Proxy

> 以下同時提供 Hermes Agent 和 OpenClaw 的設定方式。Hermes 是主要開發對象，OpenClaw 為相容選項。

```bash
# 4-1a. 設定 OpenClaw claude-proxy provider（v4.0 起使用 openai-completions 格式，不需要 API Key）
openclaw config set 'models.providers.claude-proxy' --json '{
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
}'

# 4-1b. 設定 Hermes Agent（編輯 ~/.hermes/config.yaml）
# model:
#   default: claude-sonnet-4-6
#   provider: claude-proxy
#   base_url: http://localhost:3456/v1
#
# custom_providers:
# - name: claude-proxy
#   base_url: http://localhost:3456/v1
#   api_key: ''
#   api_mode: chat_completions
#   model: claude-opus-4-7
# - name: claude-proxy
#   base_url: http://localhost:3456/v1
#   api_key: ''
#   api_mode: chat_completions
#   model: claude-sonnet-4-6
# - name: claude-proxy
#   base_url: http://localhost:3456/v1
#   api_key: ''
#   api_mode: chat_completions
#   model: claude-haiku-4-5

# 4-2. 設定 OpenClaw primary model
openclaw config set agents.defaults.model.primary "claude-proxy/claude-sonnet-4-6"

# 4-3. 設定 fallback（可選）
openclaw config set agents.defaults.model.fallbacks --json '["claude-proxy/claude-opus-4-7", "claude-proxy/claude-haiku-4-5"]'
```

---

## Phase 5：已知問題修復

### 5-1. IPv6 問題（如果網路沒有 IPv6）

```bash
# 測試：如果這個指令超過 5 秒沒回應，就需要修
curl -s --max-time 5 https://api.telegram.org

# 修法 1：OpenClaw config
openclaw config set channels.telegram.network.autoSelectFamily false
openclaw config set channels.telegram.timeoutSeconds 60

# 修法 2：LaunchAgent 加 NODE_OPTIONS
# 編輯 ~/Library/LaunchAgents/ai.openclaw.gateway.plist
# 在 EnvironmentVariables dict 裡加：
#   <key>NODE_OPTIONS</key>
#   <string>--dns-result-order=ipv4first</string>
```

### 5-2. Sandbox 權限（OpenClaw 2026.3.22+）

```bash
# 開啟完整工具權限
openclaw config set tools.profile full

# 允許高權限工具
openclaw config set tools.sandbox.tools.alsoAllow --json '["agent-browser", "browser", "web_fetch", "web_search", "system.run", "exec", "apply_patch", "canvas", "image_generate"]'
```

---

## Phase 6：驗證

```bash
# 6-1. Proxy 健康檢查
curl -s http://localhost:3456/health | python3 -m json.tool

# 6-2. Proxy API 測試
curl -s -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Say OK"}]}'

# 6-3. OpenClaw Gateway 狀態
openclaw gateway status

# 6-4. Telegram 測試
# → 打開 Telegram，發訊息給 Bot，確認有回應
# → 傳一張圖片，確認能讀圖
# → 輸入 /status 看狀態資訊
```

---

## 快速故障排除

| 症狀 | 檢查 | 解法 |
|------|------|------|
| Proxy health 無回應 | `lsof -i :3456` | 重啟：`launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist && sleep 2 && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hermes.claude-proxy.plist` |
| Bot 不回應 | `openclaw gateway status` | `openclaw gateway stop && openclaw gateway start` |
| 回應說不能讀圖 | 檢查 model config 的 input | 確認有 `["text", "image"]` |
| WebSearch/工具被擋 | session 沒有工具權限 | 確認 server.js 的 `allowedTools` 設定，重啟 proxy |
| Claude CLI 未認證 | `claude auth status` | `claude auth login` 重新登入 |
| `extra usage` 錯誤 | Claude 帳號月額度用盡 | 等月初重置或購買額度 |
| Telegram 連不上 | IPv6 問題 | 見 Phase 5-1 |

---

## 完成後的服務架構

```
Telegram User
  │
  ▼
Telegram Bot API
  │
  ▼
Hermes Gateway                    ← LaunchAgent: ai.hermes.gateway
  │  (或 OpenClaw Gateway          ← LaunchAgent: ai.openclaw.gateway)
  │
  ▼
Claude Proxy v5.0 (port 3456)    ← LaunchAgent: com.hermes.claude-proxy
  │  Persistent session + 工具支援
  │
  ▼
Claude Max Subscription (OAuth)
  Opus 4.7 · Sonnet 4.6 · Haiku 4.5
```

所有 LaunchAgent 開機自動啟動。Hermes 和 OpenClaw 可同時連接同一個 proxy。
