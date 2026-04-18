Opus 4.7 API 一個月燒幾千美金。

我花 $200 搞了一個 24/7 的 Telegram AI 助手，大腦是 Opus 4.7，能聊天、能讀寫檔案、能跑 shell、能搜網、能讀圖。

做法：

Claude Max 訂閱 $200/月，透過 Claude Agent SDK 每個請求開新 stateless query。中間寫了一層 Node.js Proxy，把 SDK 輸出包成 OpenAI `/v1/chat/completions` 相容格式，接上 Hermes Agent（或相容的 OpenClaw）當控制層，再串 Telegram Bot。

架構：
Telegram → Hermes Gateway → Proxy v5 → Claude Agent SDK → Claude Max

所有 Request 走官方 SDK + OAuth，跟你坐在 Terminal 前打 `claude` 一模一樣。不偷 Session Token，不怕封號。

v5 對 v4 最關鍵的升級：

Stateless 架構。v4 為了省 token 在 proxy 層維持 persistent session，看起來聰明，實際上會踩到兩個坑——多個 bot 共用同一個 proxy 時會互相看到對方的對話歷史（session 污染）；單一 bot 長跑則 session 歷史無限累積，O(N²) 膨脹，token 快速燒光額度。v5 直接切回每請求獨立，靠 Anthropic 原生的 prompt caching（5 分鐘 TTL、90% 折扣）補償 system prompt 重複載入的成本。結果：乾淨、符合 OpenAI stateless 語義、bot 的 `/new` 自動生效。

多 client 部署建議再 fork 一份獨立 proxy（例如 Hermes 3456、OpenClaw 3457），process 層級完全隔離，log 和 stats 也各自分開。

內建工具一樣開滿：WebSearch、WebFetch、Bash、Read/Write/Edit、Grep、Glob。上層 Agent 不用自己再實作。

跑在 Mac Mini 上，macOS launchd 開機自啟。不建議塞到個人 Mac——下游 Agent 會讀寫檔案、跑指令，把你家目錄的照片密碼私鑰全暴露很危險。租一台專用 Mac Mini 最乾淨，壞了砍掉重建。

踩了不少坑才搞定。最新一個：自己的文件寫 `"api": "openai-chat"`，但下游 OpenClaw schema 只吃 `openai-completions`。文件 bug 比 code bug 難抓。

一鍵安裝（macOS）：

```
git clone https://github.com/photofanz/openclaw-claude-proxy-v4.git hermes-claude-proxy
cd hermes-claude-proxy
bash install.sh
```

腳本做的事：檢查 Node.js + Claude CLI 登入 → npm install（含 Agent SDK）→ 產 .env（含 STATELESS_MODE=1）→ Agent SDK 煙霧測試 → 建 LaunchAgent com.hermes.claude-proxy（開機自啟）→ 健康檢查 → 印出 Hermes / OpenClaw 兩套 config 範本。

Hermes 和 OpenClaw 可共用同一個 proxy（v5 stateless 已排除跨 client 污染），或各 fork 一份獨立 proxy 跑不同 port（完全隔離，推薦）。原始碼全部在 GitHub。

$200/月，你自己的 Opus 4.7 隨身顧問。

---

既然有最好的靈魂，就該親手為它打造最適合的軀殼。
