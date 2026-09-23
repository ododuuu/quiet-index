# 給下一個 AI 的開發 prompt

以下內容可直接複製貼上：

```text
請在 ododuuu/quiet-index 的最新 main 基礎上，開 codex/ 前綴分支實作 Seekah 0.36.1。產品已更名 Seekah，GitHub 倉庫網址仍沿用 quiet-index。

先完整閱讀 AGENTS.md，再依序讀 docs/SPEC.md、docs/STATUS.md、docs/DECISIONS.md、docs/handoff/README.md、docs/handoff/CURRENT.md 及 CURRENT 指定的版本交接文件。

本次只實作 SPEC §45 的 0.36.1：Windows 系統目錄內建排除、scope-aware deletion、profile 錯誤 UX，以及已核准的新 TUI。TUI 請逐項依 docs/design/SEEKAH-TUI.md，並對照 docs/design/seekah-tui.html，不要重新設計另一版。

TUI 要真正支援方向鍵移動、Space 勾選、Enter 預覽、PgUp/PgDn 翻頁、Esc 返回、Tab 切換區域、情境快捷鍵與安全退出；保留低噪音灰階＋青綠重點色、固定底部搜尋列、獨立游標與 checkbox。不能只換顏色或仍靠 /select、/next 操作。示範的 status 不能硬編成真實狀態；context 必須保留明確 yes 確認。

保留舊索引路徑、LOCALDOCSEARCH_DATA_DIR、.localdocsearchignore、docsearch 相容入口與既有 IPC/MCP 識別。不得刪庫、刪 WAL/journal、要求 rebuild、降低安全性、上傳公司資料、改已正常的 parser selection。不要做 0.37.0 watcher/queue/startup/all-terms 優化，不修尚未現場診斷的 parser errors，不提權、不做 USN 或 Service。

每項行為變更先補測試。完成 reducer、鍵盤解析、80×24/120×40、中文寬度、resize、跨頁選取、context 確認、PTY 退出清理與 scope deletion 安全測試，再跑完整 npm test 與 npm run package。提供實際終端畫面對照核准稿；公司 Windows 未實測不得宣稱通過。

只有全部 0.36.1 實作完成後才升 package/lockfile 版本。更新 README、STATUS、NEXT-TODO、DECISIONS、0.36.1-VALIDATION.md 與 docs/handoff/ 下的 CURRENT 和版本交接，保持固定交接位置。最後提交並 push 開發分支，回報 commit、測試結果、未完成項目及公司 Windows 人工驗收步驟；不要混入下一版。
```
