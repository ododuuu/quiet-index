# M6-A 驗證與公司 Windows 驗收

日期：2026-09-16；版本：0.6.0。M6-A 本機實作完成，公司 Windows／實際文件驗收尚未完成；M5 全項 Windows 驗收也未因此視為完成。

## 本批成果

| 新增格式 | 擷取及定位 | 限制 |
|---|---|---|
| DOC | 正文、頁首頁尾、註腳／章末註、批註、文字方塊；部位與擷取段落 | Word 97–2003 OLE；無 Word 頁碼、OCR、內嵌物件保證，欄位網址不保證完整 |
| XLS | 儲存格顯示文字、快取結果與超連結；工作表／儲存格 | BIFF；不重算公式、不執行巨集、不同顯示格式仍待實測 |
| MHT／MHTML | 解碼主體 HTML 或純文字；擷取段落 | 不索引附件／圖片、不取得網路資源 |
| HTML／HTM／XHTML | 文字、標題與連結；擷取段落 | 不執行 script；忽略 style／template；BOM／charset、未宣告預設 UTF-8 |
| AsciiDoc | 原始文字、來源行號 | UTF-8，不展開 include，不執行擴充 |

保留原有 MD、TXT、DOCX、PPTX、XLSX、文字型 PDF。`.msg` 與 `.vsd` 未納入本批，後續計畫見 SPEC 第 16 節。副檔名盤點不等於工作文件分類；無副檔名與其他未知格式仍略過。

## 本機證據

- macOS、Node.js 26.7.0：`npm test` 的嚴格 TypeScript 編譯與 42 項測試全部通過，無略過。
- 新增 8 項測試，涵蓋中文 OLE DOC／註腳、BIFF XLS／日期／數字／快取公式／超連結、多工作表、MIME Base64／quoted-printable、Big5、純文字備援、HTML 實體及腳本排除。
- 整合案例核對副檔名別名、大小寫、格式篩選、新增／修改／刪除及未變更零解析；跨程序 CLI 使用中文及空白路徑。
- 狀態案例涵蓋 DOC 加密旗標、XLS FilePass、損壞檔案、無文字、超過 100 MiB 的稀疏檔案；仍可用檔名查找，其他正常文件繼續索引。
- DOC／XLS 每份 worker 有 30 秒期限及 512 MiB V8 old-generation heap 上限（不等於整個程序 RSS 上限）；測試確認可逾時終止，之後正常解析不受影響。
- DOC 與 XLS 使用測試內產生的合成二進位資料，不含公司內容；最小 DOC 僅驗證解析流程，未宣稱 Office 可開啟性或所有舊版格式相容。頁首頁尾、特殊欄位與真實文件版式需公司實際驗收。
- 既有 M5 六格式 Demo／效能腳本保留。`benchmark-local.json` 是 0.5.0 歷史結果，不代表 0.6.0 新格式效能；不將使用者先前 2.83 GB／約 1 分鐘的首次索引當作本批速度保證。

## 交付驗證

`LocalDocSearch-M6A-2026-09-16.zip` 附 SHA-256 檔案，80 個壓縮項目與工作檔逐一核對，包含 vendor 套件但不含 node_modules。解壓至乾淨暫存目錄，從本機快取執行 `npm ci --offline --ignore-scripts` 安裝 30 個套件後，重新編譯及 42 項測試再次通過。既有六格式 Demo 也通過。這是 macOS 驗證，未代替 Windows 安裝與實際文件驗收。

## Windows 安裝與驗收

在新版解壓後的 `LocalDocSearch` 目錄執行（CMD 可直接使用）：

```cmd
node --version
npm.cmd ci
npm.cmd test
node dist/src/cli.js index "原本的資料夾完整路徑" --verbose
node dist/src/cli.js search "已知的文件內文" --type doc
node dist/src/cli.js search "已知的儲存格文字" --type xls
node dist/src/cli.js search "已知的網頁內文" --type mht,mhtml
node dist/src/cli.js status
```

請將路徑及查詢換成實際值。升級後重新 index 會加入先前略過的新格式，無需刪除資料庫或強制重建；若之後解析器修正影響已成功的文件，再用 rebuild。

1. 回報 Windows／Node.js 版本、42 項測試結果及索引耗時。
2. 各挑 DOC、XLS、MHT 實際文件，使用「檔名沒有、內容才有」的中文詞查找；核對 DOC 部位、XLS 工作表／儲存格與網頁文字。
3. 核對 HTML 的 Big5／UTF-8、MHTML、AsciiDoc（若工作資料有使用）。
4. 查看摘要中 indexed、error、encrypted、too_large 與略過數，避免把所有 found 都當成成功全文索引。
5. 再次 index；沒有修改且沒有 error 文件時，解析器呼叫應為 0。若有 error，依既有規則重試。
6. 有問題時回報副檔名、狀態與錯誤代碼即可，不需提供公司文件內容。`DOC_FORMAT_ERROR` 可能是副檔名與內容格式不符；`LEGACY_TIMEOUT` 表示解析超過期限。

正式完成條件仍是使用者在公司 Windows 回報驗收通過。
