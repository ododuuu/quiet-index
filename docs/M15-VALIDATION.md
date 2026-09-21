# M15 0.18.0 驗證

M15 在 M14 的跨查詢選取後新增本機剪貼簿目的地，減少先輸出檔案、開檔、全選及複製的步驟。

```powershell
.\docsearch.cmd context "規格關鍵字" --clipboard
```

剪貼簿模式預設 Markdown；流程仍為候選選取、完整預覽、`done`、輸入 `yes`。取消、EOF、無結果、來源變更或索引變更不寫入。`--clipboard` 與 `--out` 不可同時使用。

自動測試涵蓋：確認後只複製已選內容、預設 Markdown、確認前零寫入、取消零寫入、固定錯誤、256 KiB 共用上限、macOS／Windows 啟動計畫、Windows UTF-8 stdin、無 shell 插值及 CLI 目的地驗證。

2026-09-18：macOS Node.js 26.7.0 與 22.17.0 完整測試均為 127 項、126 通過、0 失敗、1 項 Windows cmd 略過。測試使用注入寫入器，沒有覆寫開發機真實剪貼簿。Windows `Set-Clipboard` 的真實中文貼上仍待公司電腦使用新版驗證，不能由命令組裝測試代替。
