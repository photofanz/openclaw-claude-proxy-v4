Opus 4.7 API 一個月燒幾千美金。

我花 $200 搞了一個 24/7 的 Telegram AI 助手，大腦是 Opus 4.7，能聊天、能讀寫檔案、能跑 shell、能搜網、能讀圖。

做法：

Claude Max 訂閱 $200/月，透過 Claude Agent SDK 為每個模型維持一條 persistent session。中間寫了一層 Node.js Proxy，把 SDK 輸出包成 OpenAI `/v1/chat/completions` 相容格式，接上 Hermes Agent（或相容的 OpenClaw）當控制層，再串 Telegram Bot。

架構：
Telegram → Hermes Gateway → Proxy v4 → Claude Agent SDK → Claude Max

所有 Request 走官方 SDK + OAuth，跟你坐在 Terminal 前打 `claude` 一模一樣。不偷 Session Token，不怕封號。

v4 對 v3 最有感的兩個升級：

1. Persistent Session：每個模型維護一條長期 session，system prompt 只載入一次，靠 prompt cache 重用。省掉每輪 ~8K 的 CLI system prompt 重複載入，額度撐更久。
2. 內建工具：proxy 層直接開 WebSearch、WebFetch、Bash、Read/Write/Edit、Grep、Glob。上層 Agent 不用自己再實作一套。

跑在 Mac Mini 上，macOS launchd 開機自啟。不建議塞到個人 Mac——下游 Agent 會讀寫檔案、跑指令，把你家目錄的照片密碼私鑰全暴露很危險。租一台專用 Mac Mini 最乾淨，壞了砍掉重建。

踩了不少坑才搞定。最新一個：自己的文件寫 `"api": "openai-chat"`，但下游 OpenClaw schema 只吃 `openai-completions`。文件 bug 比 code bug 難抓。

一鍵安裝（macOS）：

```
git clone https://github.com/photofanz/openclaw-claude-proxy-v4.git openclaw-claude-proxy
cd openclaw-claude-proxy
bash install.sh
```

腳本做的事：檢查 Node.js + Claude CLI 登入 → npm install（含 Agent SDK）→ 產 .env → Agent SDK 煙霧測試 → 建 LaunchAgent（開機自啟）→ 健康檢查 → 印出 Hermes / OpenClaw 兩套 config 範本。

Hermes 和 OpenClaw 可同時連同一個 proxy，共用 Claude Max 額度。原始碼全部在 GitHub。

$200/月，你自己的 Opus 4.7 隨身顧問。

---

既然有最好的靈魂，就該親手為它打造最適合的軀殼。
