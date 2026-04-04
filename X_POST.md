Opus 4.6 API 一個月燒幾千美金。

我花 $200 搞了一個 24/7 的 Telegram AI 助手，大腦是 Opus 4.6，能聊天、能讀寫檔案、能跑 shell、能操作瀏覽器。

做法很簡單：

Claude Max 訂閱 $200/月，透過 Claude Code CLI 的 --print 模式驅動。中間寫了一層 Node.js Proxy 把 CLI 輸出包成 OpenAI 相容格式，接上 OpenClaw 這個 Agent 框架，再串 Telegram Bot。

全部跑在一台 VPS 上（我用 AWS Free Tier，免費）。

架構：
Telegram → OpenClaw Gateway → Proxy → claude --print → Anthropic API

所有 Request 從官方 Binary 出去，跟你坐在 Terminal 前打字一模一樣。不偷 Session Token，不怕封號。

為什麼跑在 VPS 不跑本機？因為 OpenClaw 的 Agent 能讀寫檔案、跑指令。放你的 Mac 上，你的照片密碼私鑰全暴露。VPS 是空機器，壞了砍掉重建。

踩了 8 個坑才搞定。最刺激的一個：OpenClaw 的 system prompt + 工具定義太大，直接把 Linux 的命令列參數上限撐爆（E2BIG）。解法：prompt 改走 stdin 管道。

寫了一個一鍵安裝腳本。你只需要：

1. 一台 Ubuntu 機器（任何 VPS 都行，2GB RAM 以上）
2. 訂閱 Claude Max
3. 跟 @BotFather 建一個 Telegram Bot
4. SSH 進去跑兩行指令：

curl -fsSL <GitHub連結> -o setup.sh
bash setup.sh

輸入 Bot Token 和你的 Telegram ID，5 分鐘自動裝完。

腳本做的事：裝 Node.js 22 → PM2 → Claude Code CLI → 部署 Proxy → 裝 OpenClaw → 設定自訂 Provider → 設定 Telegram 白名單 → 建 systemd 開機自啟。

原始碼和腳本都在 GitHub。

$200/月，你自己的 Opus 4.6 隨身顧問。

---

既然有最好的靈魂，就該親手為它打造最適合的軀殼。
