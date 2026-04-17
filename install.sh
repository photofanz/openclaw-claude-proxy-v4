#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Hermes / Claude Code Proxy v4.0 — One-Click Installer (macOS)
#
# Prerequisites:
#   - Node.js 18+ (brew install node)
#   - Claude Code CLI logged in (claude auth status)
#   - Claude Max subscription active
#
# Usage:
#   git clone https://github.com/photofanz/openclaw-claude-proxy-v4.git openclaw-claude-proxy
#   cd openclaw-claude-proxy
#   bash install.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo '╔════════════════════════════════════════════════════╗'
echo '║  Hermes / Claude Code Proxy v4.0 Installer        ║'
echo '╚════════════════════════════════════════════════════╝'
echo -e "${NC}"

# ─── Step 1: Check prerequisites ──────────────────────────────
echo -e "${CYAN}[1/7] Checking prerequisites...${NC}"

if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js not found. Install with: brew install node${NC}"
    exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${RED}✗ Node.js 18+ required (found: $(node -v))${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

CLAUDE_CLI=""
if command -v claude &>/dev/null; then
    CLAUDE_CLI="claude"
elif [ -f "$HOME/.local/bin/claude" ]; then
    CLAUDE_CLI="$HOME/.local/bin/claude"
fi

if [ -z "$CLAUDE_CLI" ]; then
    echo -e "${RED}✗ Claude Code CLI not found${NC}"
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Claude CLI: $CLAUDE_CLI ($($CLAUDE_CLI --version 2>/dev/null))"

AUTH=$($CLAUDE_CLI auth status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('loggedIn','false'))" 2>/dev/null || echo "false")
if [ "$AUTH" != "True" ] && [ "$AUTH" != "true" ]; then
    echo -e "${RED}✗ Claude CLI not logged in${NC}"
    echo "  Run: claude auth login"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Claude CLI authenticated"

# ─── Step 2: Install dependencies ─────────────────────────────
echo -e "${CYAN}[2/7] Installing dependencies...${NC}"
npm install --production 2>&1 | tail -3
echo -e "  ${GREEN}✓${NC} npm packages installed"

# ─── Step 3: Configure .env ───────────────────────────────────
echo -e "${CYAN}[3/7] Configuring .env...${NC}"

# v4 default: no auth for local loopback use.
# Set API_KEY=... in .env manually if you want request auth (e.g. remote exposure).
if [ ! -f .env ]; then
    cat > .env <<ENVEOF
PORT=3456
API_KEY=
MAX_CONCURRENT=2
REQUEST_TIMEOUT=300000
MAX_RETRIES=1
PLUGINS_DIR=./plugins
ENVEOF
    echo -e "  ${GREEN}✓${NC} .env created (no auth by default; set API_KEY in .env for auth)"
else
    echo -e "  ${YELLOW}→${NC} .env already exists, skipping"
fi
API_KEY=$(grep "^API_KEY=" .env | cut -d= -f2 | tr -d '"' | tr -d "'")

# ─── Step 4: Verify Agent SDK ─────────────────────────────────
echo -e "${CYAN}[4/7] Verifying Agent SDK...${NC}"

SDK_TEST=$(node -e "
const { query } = require('@anthropic-ai/claude-agent-sdk');
async function t() {
  const q = query({ prompt: 'Say OK' });
  for await (const m of q) {
    if (m.type === 'assistant') { console.log('OK'); break; }
  }
}
t().catch(e => console.log('FAIL:' + e.message));
" 2>&1 | head -1)

if [ "$SDK_TEST" = "OK" ]; then
    echo -e "  ${GREEN}✓${NC} Agent SDK working"
else
    echo -e "${RED}✗ Agent SDK test failed: ${SDK_TEST}${NC}"
    echo "  Check Claude CLI auth: claude auth status"
    exit 1
fi

# ─── Step 5: Create LaunchAgent ───────────────────────────────
echo -e "${CYAN}[5/7] Creating LaunchAgent...${NC}"

PLIST_FILE="$HOME/Library/LaunchAgents/com.openclaw.claude-proxy.plist"
LOG_DIR="$HOME/.openclaw/logs"
mkdir -p "$LOG_DIR"

cat > "$PLIST_FILE" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.claude-proxy</string>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>${SCRIPT_DIR}/server.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>3456</string>
        <key>API_KEY</key>
        <string>${API_KEY}</string>
        <key>MAX_CONCURRENT</key>
        <string>2</string>
        <key>MAX_RETRIES</key>
        <string>1</string>
        <key>PATH</key>
        <string>${HOME}/.local/bin:${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/claude-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/claude-proxy-error.log</string>
</dict>
</plist>
PLISTEOF

echo -e "  ${GREEN}✓${NC} LaunchAgent: ${PLIST_FILE}"

# ─── Step 6: Start service ────────────────────────────────────
echo -e "${CYAN}[6/7] Starting service...${NC}"

# Unload if already loaded
launchctl bootout "gui/$(id -u)" "$PLIST_FILE" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE" 2>/dev/null || true
sleep 4

HEALTH=$(curl -s --max-time 10 http://localhost:3456/health 2>/dev/null)
if echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('status')=='ok' else 1)" 2>/dev/null; then
    VERSION=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
    echo -e "  ${GREEN}✓${NC} Proxy running (v${VERSION}) on port 3456"
else
    echo -e "${RED}✗ Health check failed. Check logs:${NC}"
    echo "  tail -20 ${LOG_DIR}/claude-proxy-error.log"
    exit 1
fi

# ─── Step 7: Print summary ────────────────────────────────────
echo -e "${CYAN}[7/7] Done!${NC}"
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Proxy v4.0 is running!                           ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  Endpoints (OpenAI-compatible, unified):          ║${NC}"
echo -e "${GREEN}║    POST http://localhost:3456/v1/chat/completions ║${NC}"
echo -e "${GREEN}║    GET  http://localhost:3456/v1/models           ║${NC}"
echo -e "${GREEN}║    GET  http://localhost:3456/health              ║${NC}"
echo -e "${GREEN}║    GET  http://localhost:3456/stats               ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
if [ -n "$API_KEY" ]; then
echo -e "${GREEN}║  API Key: ${API_KEY:0:30}...                       ║${NC}"
else
echo -e "${GREEN}║  API Key: (none — local loopback, no auth)        ║${NC}"
fi
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  Logs:                                            ║${NC}"
echo -e "${GREEN}║    ${LOG_DIR}/claude-proxy.log         ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Next: Configure your client to use this proxy${NC}"
echo ""
echo "  ── OpenClaw ────────────────────────────────────"
echo "  Add to ~/.openclaw/openclaw.json → models.providers:"
echo ""
echo '  "claude-proxy": {'
echo '    "baseUrl": "http://localhost:3456/v1",'
echo "    \"apiKey\": \"${API_KEY}\","
echo '    "api": "openai-completions",'
echo '    "models": ['
echo '      {"id": "claude-opus-4-7", "name": "Claude Opus 4.7 (proxy)", "reasoning": true, "input": ["text","image"], "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "contextWindow": 200000, "maxTokens": 16384},'
echo '      {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (proxy)", "reasoning": true, "input": ["text","image"], "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "contextWindow": 200000, "maxTokens": 16384},'
echo '      {"id": "claude-haiku-4-5", "name": "Claude Haiku 4.5 (proxy)", "reasoning": false, "input": ["text","image"], "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "contextWindow": 200000, "maxTokens": 8192}'
echo '    ]'
echo '  }'
echo ""
echo "  Then set primary model:"
echo "    openclaw config set agents.defaults.model.primary \"claude-proxy/claude-sonnet-4-6\""
echo ""
echo "  ── Hermes Agent ────────────────────────────────"
echo "  Edit ~/.hermes/config.yaml:"
echo ""
echo "    model:"
echo "      default: claude-sonnet-4-6"
echo "      provider: claude-proxy"
echo "      base_url: http://localhost:3456/v1"
echo ""
echo "    custom_providers:"
echo "    - name: claude-proxy"
echo "      base_url: http://localhost:3456/v1"
echo "      api_key: '${API_KEY}'"
echo "      api_mode: chat_completions"
echo "      model: claude-sonnet-4-6"
echo ""
