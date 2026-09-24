# 給 Luna Max 的 GUI 實作指令

使用者指定由 Luna Max 接手；文件本身不會切換模型，也不表示已啟動該模型。

```text
請接手 ododuuu/seekah 最新 main，依已核准設計稿完整實作 Seekah 0.36.2 本機 GUI 工作台。

先依 AGENTS.md 讀 docs/SPEC.md、docs/STATUS.md、docs/DECISIONS.md、docs/handoff/README.md、docs/handoff/CURRENT.md、docs/handoff/0.36.2.md，再讀 docs/design/SEEKAH-WORKBENCH.md 與 seekah-workbench.html。

目前實作權威是 SPEC §47／D059，安全契約沿用 §43。左導覽／中央搜尋結果／右上下文、行動抽屜、臨時文件、唯讀索引狀態、連線設定、精確預覽／複製、確認送出與實際 AI 回答全部完成，不是把 HTML 原型貼到 src 或只改 CSS。

重用 src/workbench-app.ts、workbench.ts、workbench-context.ts、workbench-provider.ts 及 mcp-tools.ts。新增的後端範圍只包含受保護的唯讀 GET /api/index-status；不得另寫搜尋或 parser。容量由預覽 server bytes 計算，缺少預覽顯示待產生；假計數、假 watcher 活動與假已解析狀態全部移除。命中預覽不等於全文。只複製不需要 Key 或問題，但沿用有效 provider/model 的既有 preview 契約。

保留 fragment token、自訂 header、Host／Origin、nonce CSP、HMAC preview、來源重驗、20 份與 256 KiB。問題／model／Provider／選取改變後舊確認失效，較晚舊請求不能覆蓋新狀態。不自動重試可能計費的 API，不將公司資料送到外部，不持久化 Key 或文件。

不要修改 TUI 或實作 0.37.0 watcher／queue／startup／all-terms 效能。舊索引路徑、LOCALDOCSEARCH_DATA_DIR、ignore、IPC/MCP 識別、docsearch 入口及 parser selection 保留；不要刪庫、刪 WAL/journal 或要求 rebuild。

依 §47.8 完成正式 ui 的瀏覽器操作與截圖，包含 1440×1000、1280×800、1024×768、390×844、320×568、深淺色、200% 縮放、鍵盤與錯誤狀態。合成來源經真實索引／上傳／preview；Provider 用注入捕捉器，不調用付費 API。補消費者可見行為回歸，完成後跑完整 npm test、Node 22.17.0 相容驗證及 npm run package。

全部完成後才升 package／lockfile 至 0.36.2，更新 README、STATUS、DECISIONS、CURRENT、版本交接與 0.36.2-VALIDATION.md；推送 GitHub main 並提供連結。平台沒實測就標示未驗證；設計稿截圖不是正式程式完成證據。
```
