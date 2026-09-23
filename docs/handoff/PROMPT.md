# 給下一個 AI 的驗收 prompt

以下內容可直接複製貼上：

```text
請接手 ododuuu/quiet-index 的 codex/seekah-0.36.1 分支，驗收已完成的 Seekah 0.36.1。產品名稱已更名 Seekah，GitHub 倉庫網址仍沿用 quiet-index。

先完整閱讀 AGENTS.md，再依序讀 docs/SPEC.md、docs/STATUS.md、docs/DECISIONS.md、docs/handoff/README.md、docs/handoff/CURRENT.md、docs/handoff/0.36.1.md、docs/0.36.1-VALIDATION.md、docs/design/SEEKAH-TUI.md。

目前只做 0.36.1 驗收、重現後的缺陷修正及交付核對；不要重新設計 TUI，不要實作 SPEC §46／0.37.0。Windows 系統目錄排除、scope-aware deletion、profile 錯誤 UX 與核准 TUI 已完成本機實作。任何修改都必須維持舊索引路徑、LOCALDOCSEARCH_DATA_DIR、.localdocsearchignore、docsearch 相容入口與既有 IPC/MCP 識別；不得刪庫、刪 WAL/journal、要求 rebuild、降低安全性、上傳公司資料或改 parser selection。

在公司 Windows 普通使用者帳號，以無機密測試樹驗證：不可讀 sibling 與正常 sibling 刪除、drive／UNC root 系統目錄精確排除、CMD／PowerShell profile 路徑，以及 Windows Terminal 80×24／120×40 的方向鍵、Space、Enter、PgUp/PgDn、Esc、Tab、q、Ctrl+C、resize 與 context yes。不要對公司整庫做破壞性 deletion 實驗。

只有使用者實際回報 Windows 結果，才能更新公司 Windows 驗收狀態。若發現缺陷，先用無機密最小重現補回歸測試，再修根因並重跑完整 npm test 與 npm run package。更新 STATUS、0.36.1-VALIDATION.md、CURRENT 與 0.36.1.md；不要混入 0.37.0。
```
