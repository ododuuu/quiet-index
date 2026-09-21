# LocalDocSearch 整合驗收（0.16.0）

依使用者要求集中驗收，不需逐版更新。安裝本版一次，涵蓋 M5～M13；本機測試不能代替公司 Windows 實際結果。

本機證據（開發機）：
- macOS arm64／Node.js 22.17.0：117 測試，116 通過、0 失敗、1 略過（Windows `docsearch.cmd`）。
- 發佈包：`LocalDocSearch-M13-0.16.0.zip`（打包時逐檔核對），附 `.sha256`。
- Node.js 22.x 複測結果見 STATUS（若已記錄）。目標公司環境仍為 **Node.js 22.17.0 x64**。

## 一次安裝

解壓 `LocalDocSearch-M13-0.16.0.zip` 至可寫入位置。使用公司 Node.js 22.17.0 x64，保留 vendor 與編譯產物；安裝依賴需要既有 npm 快取或可連線下載，但索引／搜尋不外傳文件。

```powershell
node --version
node -p "process.platform + ' ' + process.arch"
npm.cmd ci
npm.cmd test
```

先用兩個自己有權限、不重疊的資料夾。舊索引自動升級；不要再用舊版程式操作新版多根目錄資料庫。

## 搜尋、開啟、更新

```powershell
node dist/src/cli.js index "C:\你的資料夾A"
node dist/src/cli.js index "D:\你的資料夾B"
node dist/src/cli.js roots
node dist/src/cli.js search "只出現在內文的關鍵字"
node dist/src/cli.js search "關鍵字" --root "C:\你的資料夾A" --type doc,docx,pdf,msg,vsd
```

確認兩個資料夾結果並存、中文片段正確、來源位置合理。DOC、XLS、網頁、MSG、VSD 的範圍與限制見各版驗收文件；VSD 只支援 v11 直接文字，master／動態欄位及 OCR 未支援。

從實際搜尋結果複製自己的文件代碼：

```powershell
node dist/src/cli.js open 12-a1b2c3d4e5f60708 --dry-run
node dist/src/cli.js open 12-a1b2c3d4e5f60708
node dist/src/cli.js reveal 12-a1b2c3d4e5f60708
node dist/src/cli.js index
node dist/src/cli.js status
```

確認開啟的文件與 Explorer 選取正確，尤其中文／空白／特殊字元路徑。再次 index 全部位置時，未修改的成功文件不重解析。error 及 unsupported VSD 依規格會重試。

## 人選上下文（M9）

必須在**互動** PowerShell／命令提示字元執行（不要把 stdin 管線化當同意）：

```powershell
node dist/src/cli.js context "同一內文關鍵字" --out "$env:USERPROFILE\Desktop\lds-context-test.json"
.\docsearch.cmd search "關鍵字"
```

勾選編號 → `v` 預覽 → `done` → 輸入 `yes` 才建立檔案。另確認：`q`／取消不建檔；`--out` 已存在則拒絕；可用 `--select <文件代碼>` 預選但仍須預覽與 yes。產生的 JSON 只含片段，不要上傳公司內容。

## 只用測試副本驗證可靠性

- 在 A 增加／修改／刪除一份測試文件，再 index A：變更反映在搜尋，B 的結果保留。
- 對 A 使用 `.localdocsearchignore` 或 `rebuild A`：只影響 A。
- 將一個測試根目錄暫時改名模擬離線，再執行不帶路徑的 index：回報失敗、保留舊索引，另一位置仍更新。還原後再 index。
- `roots remove "測試根目錄"`：只移除索引；來源檔案仍存在，其他根目錄可搜尋及開啟。
- 被公司政策阻擋時記錄錯誤，不提升權限或修改政策。

## 回報摘要

有時間時一次回報：版本／Node.js、自動測試結果、兩個根目錄搜尋是否正確、open／reveal、`context`／`docsearch.cmd`、主要格式的索引狀態與錯誤代碼。不要上傳公司文件或上下文 JSON。既有 2.83 GB 約一分鐘僅為觀察，不作新版速度承諾，也不外推全碟。

## 監看與多段上下文（M10／M11）

- 執行 `docsearch.cmd watch --debounce 1500`，另開終端新增、修改、刪除測試文件；確認 search 更新。
- 初次同步期間修改文件，確認後續自動補同步；同步進行中按 Ctrl+C，確認等待結束且索引可重新開啟。
- 多根監看其中一根失效時應顯示錯誤；其他根仍運作。預設改用定期掃描並重試監看；設定 --rescan 0 才在全部失效時退出 3。
- `context "關鍵字" --format md --passages 3 --out chosen.md` 選取並預覽，確認多段位置與片段正確，取消不建檔。
- OS 可能漏報事件；本版預設每次同步完成後 5 分鐘校正，可用 --rescan 1000 測試離線／恢復與漏事件更新。移除根目錄若遇 INDEX_BUSY，等同步結束後再試。不要以 macOS 結果代替 Windows 驗收。

## 多程序寫入（M13）

- 同一測試索引正在處理文件時，另一終端 index／rebuild／roots remove 應回報 INDEX_BUSY，不破壞索引；search／status 可讀已提交結果。
- watch 遇寫入忙碌應稍後重試，包含 --rescan 0；Ctrl+C 可結束。
- 使用測試資料驗證程序被終止後能再次 index；不手動刪除協調檔。公司文件不作破壞性測試材料。
- 不同索引彼此不阻擋；不要用舊版程式混寫升級後索引。
