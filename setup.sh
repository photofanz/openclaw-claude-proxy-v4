#!/bin/bash
# ============================================================================
# OpenClaw + Claude Code Proxy — 一鍵安裝
# 在任何 Ubuntu 22.04+ 機器上跑，5 分鐘搞定 Telegram AI 助手
#
# 前置條件：
#   1. Claude Max 訂閱 ($200/月)
#   2. 一台 Ubuntu 22.04+ 的機器（VPS / Cloud / 本地都行，建議 2GB+ RAM）
#   3. 已 SSH 進入這台機器（或直接在 terminal 操作）
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/51AutoPilot/openclaw-claude-proxy/main/setup.sh -o setup.sh
#   bash setup.sh
# ============================================================================

set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1;36m'; N='\033[0m'

echo ""
echo -e "${B}╔══════════════════════════════════════════════════╗${N}"
echo -e "${B}║  OpenClaw + Claude Code Proxy 一鍵安裝           ║${N}"
echo -e "${B}║  Opus 4.6 Telegram Bot · \$200/月                ║${N}"
echo -e "${B}╚══════════════════════════════════════════════════╝${N}"
echo ""
echo "  開始之前，請準備好："
echo ""
echo "  1. Telegram Bot Token"
echo "     → 搜尋 @BotFather → /newbot → 拿到 Token"
echo ""
echo "  2. 你的 Telegram User ID"
echo "     → 搜尋 @userinfobot → 發訊息 → 拿到數字 ID"
echo ""

read -rp "📱 Telegram Bot Token: " BOT_TOKEN
read -rp "🆔 你的 Telegram User ID: " USER_ID

if [ -z "$BOT_TOKEN" ] || [ -z "$USER_ID" ]; then
  echo -e "${R}❌ Bot Token 和 User ID 都必填${N}"; exit 1
fi
echo ""

# ── Step 1: Node.js 22 ──────────────────────────────────────────────────────
echo -e "${Y}▶ [1/7] Node.js 22${N}"
if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1 | tr -d 'v')" -ge 22 ] 2>/dev/null; then
  echo -e "  ${G}✓${N} $(node -v) 已安裝"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
  sudo apt-get install -y nodejs > /dev/null 2>&1
  echo -e "  ${G}✓${N} $(node -v) 安裝完成"
fi

# ── Step 2: PM2 + Claude CLI ────────────────────────────────────────────────
echo -e "${Y}▶ [2/7] PM2 + Claude Code CLI${N}"
sudo npm install -g pm2 @anthropic-ai/claude-code > /dev/null 2>&1
echo -e "  ${G}✓${N} 完成"

# ── Step 3: 認證 Claude CLI ─────────────────────────────────────────────────
echo -e "${Y}▶ [3/7] Claude CLI 認證${N}"
if [ -d "$HOME/.claude" ]; then
  echo -e "  ${G}✓${N} 已認證（如需重新認證，刪 ~/.claude 後重跑）"
else
  echo ""
  echo "  ⚠️  需要手動認證。在另一個 terminal 執行："
  echo -e "     ${B}claude${N}"
  echo "  → 瀏覽器開 URL → 登入 Max 帳號 → 完成後 Ctrl+C"
  echo ""
  read -rp "  認證完成後按 Enter ... "
fi
echo -n "  驗證中... "
if claude --print "hi" > /dev/null 2>&1; then
  echo -e "${G}✓${N} Claude CLI 認證正常"
else
  echo -e "${R}✗ Claude CLI 認證失敗${N}"
  echo "  請執行 claude 完成登入後重跑此腳本"
  exit 1
fi

# ── Step 4: 部署 Proxy ──────────────────────────────────────────────────────
echo -e "${Y}▶ [4/7] 部署 Proxy${N}"

PROXY_DIR="$HOME/openclaw-claude-proxy"
mkdir -p "$PROXY_DIR"
PROXY_API_KEY="sk-proxy-$(openssl rand -hex 16)"

cat > "$PROXY_DIR/package.json" << 'EOF'
{"name":"openclaw-claude-proxy","version":"1.0.0","private":true,"dependencies":{"express":"^4.21.0"}}
EOF

cat > "$PROXY_DIR/.env" << EOF
PORT=3456
API_KEY=${PROXY_API_KEY}
CLAUDE_CLI_PATH=claude
MAX_CONCURRENT=3
REQUEST_TIMEOUT=300000
MAX_TOOL_TURNS=10
EOF

cat > "$PROXY_DIR/.gitignore" << 'EOF'
node_modules/
.env
EOF

cat > "$PROXY_DIR/ecosystem.config.js" << 'EOF'
const dotenv = require('fs').existsSync('.env')
  ? Object.fromEntries(require('fs').readFileSync('.env','utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>l.split('=').map(s=>s.trim())))
  : {};
module.exports = { apps: [{ name:'openclaw-claude-proxy', script:'server.js', instances:1, autorestart:true, watch:false, max_memory_restart:'256M', env:{ NODE_ENV:'production', ...dotenv }}]};
EOF

# server.js — 核心 Proxy
cat > "$PROXY_DIR/server.js" << 'SERVEREOF'
#!/usr/bin/env node
const express=require('express'),{spawn}=require('child_process'),{randomUUID}=require('crypto');
const PORT=parseInt(process.env.PORT||'3456',10),API_KEY=process.env.API_KEY||'',CLI=process.env.CLAUDE_CLI_PATH||'claude';
const MAX_C=parseInt(process.env.MAX_CONCURRENT||'3',10),TIMEOUT=parseInt(process.env.REQUEST_TIMEOUT||'300000',10);
const MAX_TURNS=parseInt(process.env.MAX_TOOL_TURNS||'10',10);
let active=0;const app=express();app.use(express.json({limit:'10mb'}));

function auth(req,res,next){if(!API_KEY)return next();const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):h;if(t!==API_KEY)return res.status(401).json({error:{message:'Invalid API key',type:'auth_error'}});next();}

function msgs2prompt(msgs){if(!Array.isArray(msgs)||!msgs.length)return'';const p=[];for(const m of msgs){const r=m.role||'user';const c=typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map(x=>x.text||'').join('\n'):String(m.content||'');if(r==='system')p.push(`[System Instructions]\n${c}\n[End System Instructions]`);else if(r==='assistant'){if(m.tool_calls&&Array.isArray(m.tool_calls)){const td=m.tool_calls.map(tc=>{let a=tc.function?.arguments||'{}';try{a=JSON.stringify(JSON.parse(a),null,2)}catch(_){}return`[Tool Call: ${tc.function?.name}]\n${a}`}).join('\n');p.push(`[Previous Assistant Response]\n${c||''}${td?'\n'+td:''}`);}else p.push(`[Previous Assistant Response]\n${c}`);}else if(r==='tool')p.push(`[Tool Result: ${m.name||m.tool_call_id||'?'}]\n${c}`);else p.push(c);}return p.join('\n\n');}

function callClaude(prompt,sys,tools){return new Promise((resolve,reject)=>{const args=['--print'];if(tools){args.push('--dangerously-skip-permissions','--max-turns',String(MAX_TURNS),'--output-format','json');}let stdin='';if(sys&&sys.length<=100000)args.push('--system-prompt',sys);else if(sys)stdin+=`[System Instructions]\n${sys}\n[End System Instructions]\n\n`;stdin+=prompt;const proc=spawn(CLI,args,{cwd:process.env.HOME||'/home/ubuntu',env:{...process.env},stdio:['pipe','pipe','pipe'],timeout:TIMEOUT});proc.stdin.write(stdin);proc.stdin.end();let out='',err='';proc.stdout.on('data',c=>{out+=c.toString()});proc.stderr.on('data',c=>{err+=c.toString()});proc.on('close',code=>{if(code!==0)return reject(new Error(`CLI exit ${code}: ${err.slice(0,500)}`));let r=out.trim();if(tools&&r){try{r=(JSON.parse(r).result||r).trim()}catch(_){}}resolve(r)});proc.on('error',e=>reject(new Error(`Spawn: ${e.message}`)));setTimeout(()=>{try{proc.kill('SIGTERM')}catch(_){}reject(new Error('Timeout'))},TIMEOUT+5000)});}

app.post('/v1/chat/completions',auth,async(req,res)=>{const{messages,model,stream,tools}=req.body;if(!messages||!Array.isArray(messages))return res.status(400).json({error:{message:'messages required'}});if(active>=MAX_C)return res.status(429).json({error:{message:'Too many requests'}});active++;const id=`chatcmpl-${randomUUID().replace(/-/g,'').slice(0,24)}`,ts=Math.floor(Date.now()/1000);let sys='';const nm=[];for(const m of messages){if(m.role==='system')sys+=(sys?'\n':'')+(typeof m.content==='string'?m.content:'');else nm.push(m);}const ht=tools&&Array.isArray(tools)&&tools.length>0;const prompt=msgs2prompt(nm);console.log(`[${new Date().toISOString()}] ${id} | stream=${!!stream} | tools=${ht} | msgs=${messages.length}`);try{const result=await callClaude(prompt,sys||undefined,ht);if(stream){res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created:ts,model:model||'claude-opus-4-6',choices:[{index:0,delta:{role:'assistant',content:result},finish_reason:null}]})}\n\n`);res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created:ts,model:model||'claude-opus-4-6',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);res.write('data: [DONE]\n\n');res.end();}else{res.json({id,object:'chat.completion',created:ts,model:model||'claude-opus-4-6',choices:[{index:0,message:{role:'assistant',content:result},finish_reason:'stop'}],usage:{prompt_tokens:Math.ceil(prompt.length/4),completion_tokens:Math.ceil(result.length/4),total_tokens:Math.ceil((prompt.length+result.length)/4)}});}active--;console.log(`[${new Date().toISOString()}] Done ${id} | len=${result.length}`);}catch(e){active--;console.error(`[${new Date().toISOString()}] Err ${id}: ${e.message}`);res.status(500).json({error:{message:e.message}});}});

app.get('/v1/models',auth,(_,res)=>res.json({object:'list',data:[{id:'claude-opus-4-6',object:'model',created:1700000000,owned_by:'anthropic'},{id:'claude-sonnet-4-5-20250929',object:'model',created:1700000000,owned_by:'anthropic'}]}));
app.get('/health',(_,res)=>res.json({status:'ok',active_requests:active,max_concurrent:MAX_C}));
app.listen(PORT,'0.0.0.0',()=>console.log(`Proxy :${PORT} | Auth:${API_KEY?'ON':'OFF'} | Max:${MAX_C}`));
SERVEREOF

cd "$PROXY_DIR" && npm install --production > /dev/null 2>&1
cd "$PROXY_DIR" && pm2 delete openclaw-claude-proxy 2>/dev/null || true
cd "$PROXY_DIR" && pm2 start ecosystem.config.js > /dev/null 2>&1
pm2 save > /dev/null 2>&1
PM2_STARTUP=$(pm2 startup 2>/dev/null | grep "sudo" | head -1)
[ -n "$PM2_STARTUP" ] && eval "$PM2_STARTUP" > /dev/null 2>&1 || true
sleep 2
if curl -s http://localhost:3456/health | grep -q '"ok"' 2>/dev/null; then
  echo -e "  ${G}✓${N} Proxy 啟動在 localhost:3456"
else
  echo -e "  ${R}✗ Proxy 啟動失敗${N}"
  echo "  查看 log: pm2 logs openclaw-claude-proxy --lines 20"
  exit 1
fi

# ── Step 5: OpenClaw ────────────────────────────────────────────────────────
echo -e "${Y}▶ [5/7] 安裝 OpenClaw${N}"
sudo npm install -g openclaw@latest > /dev/null 2>&1
echo -e "  ${G}✓${N} 完成"

# ── Step 6: 設定 OpenClaw ───────────────────────────────────────────────────
echo -e "${Y}▶ [6/7] 設定 OpenClaw${N}"
openclaw config set channels.telegram.botToken "$BOT_TOKEN" > /dev/null 2>&1
openclaw config set channels.telegram.dmPolicy allowlist > /dev/null 2>&1
openclaw config set channels.telegram.allowFrom --json "[\"telegram:${USER_ID}\"]" > /dev/null 2>&1
openclaw config set 'models.providers.claude-proxy' --json "{\"baseUrl\":\"http://localhost:3456/v1\",\"apiKey\":\"${PROXY_API_KEY}\",\"api\":\"openai-completions\",\"models\":[{\"id\":\"claude-opus-4-6\",\"name\":\"Claude Opus 4.6\"}]}" > /dev/null 2>&1
openclaw config set agents.defaults.model.primary "claude-proxy/claude-opus-4-6" > /dev/null 2>&1
openclaw config set gateway.mode local > /dev/null 2>&1
echo -e "  ${G}✓${N} 完成"

# ── Step 7: systemd ─────────────────────────────────────────────────────────
echo -e "${Y}▶ [7/7] 建立 systemd service${N}"
sudo tee /etc/systemd/system/openclaw.service > /dev/null << SVCEOF
[Unit]
Description=OpenClaw Gateway
After=network.target
[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$HOME
Environment=PATH=/usr/bin:/usr/local/bin:$HOME/.local/bin
ExecStart=$(which openclaw) gateway
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
SVCEOF
sudo systemctl daemon-reload
sudo systemctl enable openclaw > /dev/null 2>&1
sudo systemctl restart openclaw
sleep 3

if sudo systemctl is-active openclaw > /dev/null 2>&1; then
  echo -e "  ${G}✓${N} OpenClaw Gateway 運行中"
else
  echo -e "  ${R}✗${N} 啟動失敗 → sudo journalctl -u openclaw -n 20"
fi

# ── 完成 ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}════════════════════════════════════════════${N}"
echo -e "${G}  ✅ 安裝完成！打開 Telegram 跟 Bot 說句話。${N}"
echo -e "${G}════════════════════════════════════════════${N}"
echo ""
echo "  Proxy API Key: ${PROXY_API_KEY}"
echo ""
echo "  常用指令："
echo "    pm2 logs openclaw-claude-proxy   # Proxy log"
echo "    sudo journalctl -u openclaw -f   # Gateway log"
echo "    pm2 restart openclaw-claude-proxy # 重啟 Proxy"
echo "    sudo systemctl restart openclaw   # 重啟 Gateway"
echo ""
