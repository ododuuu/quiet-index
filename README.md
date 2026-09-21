# LocalDocSearch

LocalDocSearch 0.26.2 是純本機 CLI，目前以 macOS 作為主要可執行與迭代環境，並保留 Windows 相容方向。它支援原有六種格式，並新增 `.doc`、`.xls`、`.mht`／`.mhtml`、`.html`／`.htm`／`.xhtml`、`.adoc`、`.msg` 與 `.vsd`，搜尋檔名、標題及內容。其他格式與無副檔名檔案會進入本機清冊，可依檔名及副檔名找到。文件留在原位置，索引與搜尋不需要網路或外部 AI。

0.26.2 延續 0.26.1 的可接續升級，並針對 Windows 在 SQLite 開庫時就明確設定零等待鎖；`npm ci` 也會自動編譯 `dist`，不必先跑完整測試才能使用 CLI。

M4 已由使用者於 2026-09-16 回報驗收完成。M5 新增格式篩選、命中原因、原文片段與同步診斷；本機測試與效能證據見 [M5 驗證報告](docs/M5-VALIDATION.md)，M5 公司 Windows 驗收仍待回報。

M6-C 0.9.0 新增 VSD v11 直接儲存的圖形文字搜尋，支援中文與頁面／圖形 ID 定位。再次 index 原根目錄後，使用 `search "圖形文字關鍵字" --type vsd`；0.8.0 的檔名索引會自動重試。舊版本仍保留檔名，尚不展開 master 繼承、動態欄位或 OCR。驗收見 [M6-C 驗證文件](docs/M6C-VALIDATION.md)。

M9 起提供可選 `context`；M10 可匯出多段 JSON／Markdown；M14 可在同一工作階段跨查詢累積規格、文件與 BU 聊天。M11 起可用 `watch` 自動增量索引。預設不接模型。Windows 另附 `docsearch.cmd`。

## 安裝與執行

M6-B 新增 Outlook `.msg` 郵件的主旨、寄件者、收件者／副本／密件副本，以及 HTML、純文字、RTF 正文搜尋。[M6-B 驗證與驗收](docs/M6B-VALIDATION.md) 列出本機證據與公司測試步驟。

目前 Mac 安裝 Node.js 22.17.0 以上版本後，將 M17 壓縮檔解壓並切換到 `LocalDocSearch` 資料夾：

```bash
node --version
npm ci
npm test
node dist/src/cli.js index "$HOME/Documents/測試文件"
node dist/src/cli.js search "關鍵字"
```

Windows 相容操作保留如下，但不再作為逐版開發門檻：

```powershell
node --version
node -p "process.platform + ' ' + process.arch"
npm.cmd ci
npm.cmd test
node dist/src/cli.js --help
node dist/src/cli.js index "C:\Users\你的帳號\Documents\測試文件"
node dist/src/cli.js search "關鍵字"
```

發佈包附帶編譯產物、原始碼、測試與鎖定依賴，不含 Node.js 或 `node_modules`；`npm.cmd ci` 需可取得鎖定套件或本機 npm 快取。安裝可能下載 PDF.js 的平台相依選配套件，沿用 M4 的依賴，不使用 macOS 的 `node_modules` 直接複製至 Windows。安裝完成後，索引與搜尋完全在本機執行，不需要管理員權限、全域安裝或背景服務。

PDF 的 CMap 與標準字型位於 `node_modules/pdfjs-dist/cmaps`、`node_modules/pdfjs-dist/standard_fonts`，請保留完整套件目錄。若修改程式碼，執行 `npm.cmd run build` 重新編譯。

M6-A 的 DOC／XLS 使用純 JavaScript，不必安裝 Word／Excel；SheetJS 官方套件隨包保存在 `vendor/`，請勿移除。其他新增套件為 `word-extractor`、`postal-mime`、`htmlparser2`，版本由鎖檔固定。支援範圍及公司驗收見 [M6-A 驗證與驗收](docs/M6A-VALIDATION.md)。

## CLI 命令

```powershell
node dist/src/cli.js index "C:\Documents" --verbose
node dist/src/cli.js search "合約" --type pdf,docx --limit 10 --verbose
node dist/src/cli.js search "付款 例外 規格" --all-terms
node dist/src/cli.js context "合約" --out "$env:USERPROFILE\Desktop\context.json"
node dist/src/cli.js context "合約" --clipboard
node dist/src/cli.js watch
node dist/src/cli.js status
node dist/src/cli.js rebuild --verbose
.\docsearch.cmd search "合約"
```

- `index`：新增、重新處理修改文件、重試解析錯誤、略過未變更文件，並移除已確認刪除的索引。可登錄多個不重疊根目錄，新增位置會保留其他索引；不帶路徑則更新全部位置。
- `search`：只搜尋現有索引，預設最多 20 份文件。`--type` 接受逗號分隔格式，可有前導點且忽略大小寫；例如 `.PDF,DocX`。格式篩選先於排序與結果數限制。
- `status`：顯示各文件狀態、最後嘗試／完整同步時間、文件問題及最近同步摘要。摘要是歷史紀錄，不是即時磁碟清單。
- `rebuild [root]`：重解析指定根目錄，省略時處理全部已登錄位置的文件，不修改或刪除來源文件。重建只影響該根目錄；根目錄無法讀取時保留既有資料並回報問題。

文件變更後再次執行 `index`。解析器更新若影響先前成功的文件（例如 M4 超連結修正），執行 `rebuild`；M4 升級 M5 的搜尋改善不需重建，執行一次 `index` 即可保存新的同步摘要。

## 選取討論上下文（可選）

```powershell
.\docsearch.cmd context "討論關鍵字" --out "C:\Users\你的帳號\Desktop\context.json"
```

在清單輸入編號切換選取，`s <另一個查詢>` 保留已選內容並搜尋下一批候選；`b` 查看跨查詢清單，`r <編號>` 移除。`n`／`p` 翻頁，`v` 預覽；`done` 顯示完整匯出內容，再輸入 `yes` 建立檔案。`q`、Ctrl+C 或結束輸入會取消。跨查詢最多選 20 份，預設 100 筆候選（--limit 最高 500）。可用 `--type`、`--root` 縮小範圍。

改用 `--clipboard` 可在相同預覽與 `yes` 後直接複製 Markdown，與 `--out` 二選一；加 `--format json` 可複製 JSON。內容只寫入本機剪貼簿，不會自動送到 AI 或聊天服務。剪貼簿可能被其他本機程式或作業系統剪貼簿歷程讀取，請依公司政策使用。

如果先用 search 找過文件，可加 `--select "文件代碼1,文件代碼2"` 預選，再調整並確認；省略 query 則先提示輸入關鍵字。預選代碼需出現在本次候選中。

匯出是路徑、各自選取查詢、命中片段及來源資訊的 JSON／Markdown，只有選取內容，不含完整文件或未選文件。它留在本機，供你手動帶入允許的討論通道；本版不接模型或自動讀取聊天帳號。若來源或索引已變更，先重新 index 再選取。既有輸出檔案不覆寫，請改用新檔名。

Windows 所有命令皆可用 `.\docsearch.cmd` 代替 `node dist/src/cli.js`；不需要全域安裝或修改 PATH。此入口需 Node.js 已可從終端執行。

## 多根目錄

```powershell
node dist/src/cli.js index "C:\工作文件"
node dist/src/cli.js index "D:\BU資料"
node dist/src/cli.js roots
node dist/src/cli.js index
node dist/src/cli.js search "內文關鍵字"
node dist/src/cli.js search "內文關鍵字" --root "D:\BU資料"
node dist/src/cli.js rebuild "C:\工作文件"
node dist/src/cli.js roots remove "D:\BU資料"
```

搜尋預設涵蓋所有登錄位置；`--root` 使用 roots 顯示的路徑。`roots remove` 只移除該位置的索引，不刪來源。父子重疊根目錄會被拒絕，避免重複與排除規則衝突；同一位置的別名沿用既有根目錄。某個目錄離線時保留其舊索引並提示，其他目錄仍更新。

首次使用本版自動升級舊單根目錄資料庫，不必重建；已升級的多根目錄索引請勿交由舊版程式操作。公司實測集中使用 [整合驗收清單](docs/INTEGRATED-ACCEPTANCE.md)，不需逐版重新安裝。

## 開啟搜尋結果

搜尋結果附上文件代碼，例如 `12-a1b2c3d4e5f60708`，這不是結果排名。複製自己的代碼執行：

```powershell
node dist/src/cli.js open 12-a1b2c3d4e5f60708
node dist/src/cli.js reveal 12-a1b2c3d4e5f60708
```

`open` 使用預設程式開啟；`reveal` 在檔案總管選取來源。加上 `--dry-run` 可先檢查路徑而不開啟。來源不存在、不可讀、變成連結或代碼失效時拒絕操作；重建或移除根目錄後，代碼若失效請重新搜尋。內容更新後仍開啟目前來源，並提示索引可能過期。

Windows 使用內建 Windows PowerShell；不要求管理員、SDK 或變更執行政策。被公司政策封鎖或沒有檔案關聯時回報 `ACTION_LAUNCH_FAILED`，不嘗試繞過。成功訊息只表示請求送出，不能保證外部應用程式已顯示。M7 公司驗收見 [驗收文件](docs/M7-VALIDATION.md)。


## 監看自動增量

前台監看已登錄根目錄；檔案變更後防抖再跑既有增量 `index` 邏輯。不做 Windows 服務、不開機常駐。

```powershell
node dist/src/cli.js watch
node dist/src/cli.js watch "C:\工作文件" --debounce 2000 --verbose
```

省略路徑時監看全部已登錄位置；指定路徑必須已用 `index` 登錄。預設防抖 1500 ms（`--debounce` 200～60000）。略過 `.git`、`node_modules`、`.localdocsearch` 與 `~$` 暫存。啟動同步期間的變更會排入後續同步；Ctrl+C 等進行中的同步完成後結束。預設每次同步完成後 5 分鐘增量校正，以補償遺漏事件；`--rescan 60000` 改為 1 分鐘，`--rescan 0` 關閉。監看器失效時降級定期掃描並重試；關閉校正時，全部監看失效才自動退出。詳見 [M12 驗證](docs/M12-VALIDATION.md)。M13 起，同一索引寫入互斥；手動命令遇到 INDEX_BUSY 可稍後重試，watch 會自動重試。移除成功後，watch 下次同步會停止該根。

## 人選上下文（可選）

在互動終端把搜尋命中匯出成 JSON 片段檔，供你手動帶入允許的討論通道；**不連線 AI、不自動外傳**。

```powershell
node dist/src/cli.js context "內文關鍵字" --out "$env:USERPROFILE\Desktop\context.json"
node dist/src/cli.js context "內文關鍵字" --format md --passages 5 --out "$env:USERPROFILE\Desktop\context.md"
node dist/src/cli.js context --out "$env:USERPROFILE\Desktop\context.json" --select 12-a1b2c3d4e5f60708 --type msg --root "D:\BU資料"
```

流程：列出候選 → 編號勾選 → 視需要用 `s <查詢>` 搜尋其他來源並繼續勾選 → `v` 預覽／`done` 後輸入 `yes` 才寫入。`--format md` 產出可貼上的 Markdown；`--passages` 控制每份文件最多幾段命中。取消、EOF、非互動或沒有結果不建檔；禁止覆寫。詳見 [M14](docs/M14-VALIDATION.md)。


## 搜尋結果

從舊版升級後，重新執行 `index "原本的資料夾"` 即會加入新格式，原本成功的格式不必重解析。`--type doc,xls,mht,mhtml` 可查看 M6-A 格式，`--type msg` 可只搜尋郵件。

排序依序為檔名完全符合（含副檔名）、檔名包含、標題、內容；同級依修改時間由新到舊，再按完整路徑固定字串順序。每份文件只列一筆，顯示命中原因、來源位置、片段與修改時間。僅命中檔名時會明確標示，不顯示無關段落。

查詢預設採 Unicode NFKC 正規化及忽略大小寫的整段子字串比對，保留原文片段；中文不需斷詞。加上 `--all-terms` 後，空白分隔的每個關鍵字都必須出現在同一份文件，可分散在檔名、標題或不同段落。未加選項時，`"年度 合約"` 的空白仍是片語的一部分；`AND`、`*`、`?` 都是一般文字。沒有布林、正規表示式、繁簡轉換或語意搜尋。片段最多 160 個 Unicode code point，過長命中會標示截短。

`--verbose` 顯示排序依據，或索引時的排除規則與錯誤階段／代碼。同步摘要區分新增、重新處理、未變更、移除、各解析狀態、略過原因及耗時。「同步完整」表示掃描／讀取流程完整，不表示所有文件都成功擷取文字。

## 索引位置與排除規則

Windows 預設索引：`%LOCALAPPDATA%\LocalDocSearch\index.db`。索引含有衍生文件文字，請依公司文件政策保管。可用 `LOCALDOCSEARCH_DATA_DIR` 指定測試資料位置，程式會在其下建立 `LocalDocSearch/index.db`；測試與 Demo 使用獨立暫存目錄。

在來源根目錄建立 `.localdocsearchignore`：

```gitignore
# 排除任一層的 archive 目錄
archive/
# 排除備份文字檔
*.backup.txt
# 只排除根目錄下 private 內的 PDF
/private/*.pdf
```

支援 `*`、`**`、`?`、根目錄 `/` 與目錄尾端 `/`；不支援 `!` 重新納入。修改後再次 `index`。固定略過 `.git`、`node_modules`、`.localdocsearch` 和 `~$` 暫存檔，不自動套用 `.gitignore` 或略過所有隱藏檔；不追蹤符號連結及 Windows junction。

略過數只計已遇到的項目，排除整個目錄不會統計其內部文件。掃描不完整時，增量索引保留無法確認的既有文件，並在搜尋中提示最近同步不完整。

## 格式限制與故障排除

| 狀態／情況 | 說明與處理方式 |
|---|---|
| `indexed` | 已擷取可搜尋文字 |
| `no_text` | 空文件或沒有文字層的 PDF；仍可搜尋檔名，未提供 OCR |
| `encrypted` | 可辨識的加密 PDF／DOC／XLS 無法擷取內容；仍可搜尋檔名 |
| `too_large` | 單檔超過 100 MB，不讀取內容；仍可搜尋檔名 |
| `error` | 檢查原始文件可否開啟及讀取權限；修正後再次 `index` 會重試 |
| 搜尋不到最新內容 | 再次 `index`，查看 `status`；解析器更新後必要時 `rebuild` |
| 沒有 M5 歷史摘要 | 舊索引仍可搜尋；再次 `index` 保存摘要 |
| 排除規則錯誤 | 移除不支援的 `!` 或修正讀取權限，再執行 `index` |
| PDF `Invalid factory url` | 使用目前版本並確認本機 PDF.js 資源完整，再 `index` 重試 |

DOCX／XLSX 可搜尋超連結顯示文字及實際目標；來源位置可能為段落、儲存格或 Word 部件。XLSX 使用公式快取值與常見數字／日期格式，不重新計算公式；複雜自訂格式仍可能與 Excel 畫面不同。

DOC 以正文／註腳等部位與擷取段落定位，不提供 Word 頁碼，也不保證內嵌物件或所有欄位網址；只接受 Word 97–2003 OLE，改副檔名的 RTF／HTML 會記錄解析錯誤。XLS 讀取 BIFF 儲存格、快取結果與超連結，不執行公式、巨集或外部連線。DOC／XLS 每份文件在獨立 worker 解析，30 秒逾時或 worker 失敗時保留可搜尋檔名，下次 `index` 重試。

MHT／MHTML 只擷取 MIME 主體的 HTML 或純文字，不索引附件、圖片或外部資源；HTML 不執行腳本，來源位置為擷取段落。AsciiDoc 索引原始文字及行號，不展開 include。`.vsd` v11 擷取直接圖形文字，較舊版本或不支援結構為 unsupported，仍可搜尋檔名；`.ppt` 仍未支援。M17 起，未知副檔名與無副檔名的一般檔案會保留路徑、檔名、類型、大小與修改時間，可依檔名搜尋及開啟；其內容不會被讀取或搜尋。

MSG 不必安裝 Outlook。正文優先採 HTML，其次純文字，再還原壓縮 RTF，只取一種可讀表示。結果會標明「郵件主旨／寄件者／副本／正文」；不索引附件檔名與內容、不展開附加郵件，也不支援 PST／OST。S/MIME 簽章或加密郵件列 `error`／`MSG_SMIME_UNSUPPORTED`，仍可搜尋檔名；不是已全文索引。一般 RTF 的表格／特殊欄位不保證與 Outlook 相同。MSG 同樣有 30 秒解析期限，RTF 資料另限 20 MiB；超過上限或損壞會明確報錯。

CLI 結束碼：0 為命令完成（單檔問題請看摘要），2 為參數錯誤，3 為根目錄／設定／尚未建立索引，4 為致命內部錯誤。

## 測試、效能與 Demo

```powershell
npm.cmd test
node scripts/demo.mjs
npm.cmd run demo:msg
npm.cmd run benchmark -- "docs/benchmark-windows.json" "SSD"
npm.cmd run package
```

效能腳本建立 1,000 份六格式合成文件，測量首次、無變更及新增／修改／刪除各 10 份的增量索引，並執行 20 組搜尋，每組暖機 3 次、正式 10 次。延遲包含 CLI 啟動、SQLite、排序和輸出；會核對完整命中清單與順序，並驗證無變更時解析器呼叫為 0。請將 `SSD` 改為實際儲存裝置類型；資料在作業系統暫存目錄生成，完成後清除。

測量方法、資料集限制與本機結果見 [M5 驗證報告](docs/M5-VALIDATION.md)。[Windows 驗收表](docs/M5-WINDOWS-ACCEPTANCE.md) 列出仍需在公司電腦執行的步驟；[Demo 與書審材料](docs/M5-DEMO.md) 提供展示流程及架構說明。

既有基準尚未涵蓋 M6-A／M6-B 新格式，M5 歷史報告不是新版效能證據。

產品規格見 [SPEC](docs/SPEC.md)，目前進度見 [STATUS](docs/STATUS.md)，設計原因見 [DECISIONS](docs/DECISIONS.md)。

## 多終端同時使用

0.16.0 起，index／rebuild／roots remove 與 watch 的同步共用寫入協調。忙碌時手動命令回傳 INDEX_BUSY（退出碼 3），不改動索引；search／status 仍讀取已提交內容。watch 等待事件時不占用寫入鎖，遇忙碌會防抖後重試。

索引旁的 `index.db.writer.sqlite` 是協調檔，不含文件內容；即使留在磁碟上也不表示鎖住。程序正常或異常結束後會釋放鎖，請勿在執行期間刪除它。索引應保留在本機磁碟，且不要同時執行舊版 LocalDocSearch。詳見 [M13 驗證](docs/M13-VALIDATION.md)。

目前功能、測試能證明的範圍，以及 Windows／AI 接入仍缺哪些證據，集中見 [產品目標盤點](docs/GOAL-AUDIT.md)。
