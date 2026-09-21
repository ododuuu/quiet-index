# M6-C 0.9.0 VSD v11 驗證與 Windows 驗收

本版擷取 VSD v11 直接儲存的圖形文字，取代 0.8.0 僅檔名支援。不需要 Visio、Python、原生程式或新增 npm 依賴。

## 範圍與限制

- 可搜尋直接儲存的 UTF-16 文字（包含中文），定位為頁面 ID／圖形 ID／區塊。這些 ID 不是畫面頁碼或頁名。
- 不展開 master 繼承、動態欄位、頁名、超連結、OCR；不索引樣板或附件。no_text 表示無法取得本版範圍的直接文字，不表示圖上沒有可見文字。
- 其他版本：unsupported／VSD_VERSION_UNSUPPORTED；未知必要結構：unsupported／VSD_STRUCTURE_UNSUPPORTED；損壞：error；超過 100 MiB：too_large。以上仍可搜尋檔名。
- 單檔 worker 30 秒、V8 heap 512 MiB，累計展開資料 64 MiB、文字 20 MiB、100,000 紀錄、遞迴 64 層。不是程序 RSS 硬上限。

## 本機證據

2026-09-17 macOS arm64，Node.js 26.7.0／22.17.0：嚴格編譯及全部 63 項測試通過。自動測試包含中文壓縮／未壓縮串流、巢狀圖形 ID、LZSS 重疊複製與字典回繞、輸出限制、舊版本、損壞／循環／不合法 Unicode、中途失敗不留部分全文、大小上限、舊索引升級、格式篩選、增量／重建／排除／刪除、CLI 及 worker 期限。

固定公開回歸案例 `test/fixtures/libvisio-no-bgcolor.vsd` 驗證文字 `My hovercraft is full of eels.` 與頁面 ID 4／圖形 ID 6。來源 commit 及授權見 vendor/README.md，未使用公司文件。

另對該 commit 的 18 份上游 VSD 作本機探測：13 份 v11 可走完本版解析（10 份有文字、3 份無直接文字），5 份較舊版本明確回報 unsupported。這只代表解析探測，沒有逐一與 Visio 畫面核對，不是全文完整率或公司檔案成功率。

## Windows 驗收

解壓 0.9.0 發佈包，在 LocalDocSearch 資料夾執行：

```powershell
node --version
npm.cmd ci
npm.cmd test
node dist/src/cli.js index "原本的資料夾完整路徑" --verbose
node dist/src/cli.js search "已知只在圖形中的文字" --type vsd
node dist/src/cli.js status
```

原 0.8.0 的 unsupported VSD 會重新解析，不需刪除資料庫或 rebuild。成功案例應可依圖形文字命中並顯示來源 ID；舊版本仍可依檔名找到。再次 index 時 indexed／no_text 文件不重解析；unsupported VSD 仍重試。

請在公司 Windows 核對實際中文文字、來源 ID、狀態及既有 DOC／XLS／MSG 回歸。只需回報 Node.js 版本、測試摘要、格式狀態及錯誤代碼，不需上傳公司文件。本機 macOS 結果不能代替 Windows 驗收，先前未回報的各版驗收仍保留。

乾淨目錄交付驗證：macOS Node.js 22.17.0，從本機快取 npm ci --offline --ignore-scripts 安裝後重新編譯，63 項測試再次通過。發佈包提供原始碼、編譯產物與授權，不包含 node_modules 或公司文件。
