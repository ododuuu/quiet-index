# 設計決策紀錄

## D001 — 使用 Node.js 與 TypeScript

- 狀態：已確認
- 決策：以 Node.js 22.17.0 x64 為目標環境，應用程式碼採用嚴格模式 TypeScript。
- 原因：公司電腦可以執行 Node.js，已技術驗證 npm 套件可用，而且沒有可用的 .NET SDK。

## D002 — 文件僅在本機處理

- 狀態：已確認
- 決策：文件解析、建立索引與搜尋都留在使用者電腦。
- 原因：不得假設公司文件可以傳送給外部 AI 或 embedding 服務。

## D003 — 可用 MVP 必須支援多種格式

- 狀態：已確認
- 決策：可用 MVP 包含 Markdown、純文字、DOCX、PPTX、XLSX 與文字型 PDF。
- 原因：只支援 Markdown 無法解決使用者真正的文件搜尋需求。

## D004 — 透過統一模型逐步交付各格式

- 狀態：已確認
- 決策：先以 Markdown／純文字打通完整掃描到搜尋流程，再加入 Office 與 PDF 解析器，且不改寫搜尋核心。
- 原因：這能控制實作風險，同時不會把最終產品縮減成只支援 Markdown。

## D005 — 優先使用已在公司環境測試的套件

- 狀態：已確認，但保留公司政策限制
- 決策：規劃使用 `fflate`、`fast-xml-parser` 與 `pdfjs-dist`；可行時採用 Node.js 內建 SQLite。
- 原因：這些套件已在公司電腦成功載入，但技術上能執行不等於公司已正式核准。

## D006 — 專案文件統一使用繁體中文

- 狀態：已確認
- 決策：所有說明文件、SPEC、狀態、交接與決策紀錄使用繁體中文；程式識別字、命令與通用技術名稱保留英文。
- 原因：使用者需要直接審閱、驗收並將文件整理成書審與面試材料。

## D007 — M1 索引位置與搜尋新鮮度

- 狀態：已確認
- 決策：Windows 預設將 SQLite 索引放在 `%LOCALAPPDATA%\LocalDocSearch`；`search` 只查既有索引，文件變更後由使用者再次執行 `index`。
- 原因：使用者選定此行為；索引不會混入可攜式程式目錄，搜尋延遲也不包含掃描時間。

## D008 — 單檔大小上限

- 狀態：已確認
- 決策：M1 單檔大小上限為 100 MB；超限文件保留基本資訊與可搜尋檔名，狀態為 `too_large`。
- 原因：限制大型文件讀取造成的記憶體負擔，並保留基本查找能力。

## D009 — M2 Office 格式透過 ZIP／XML 解析器接入

- 狀態：已隨 M4 由使用者於 2026-09-16 回報驗收完成
- 決策：使用 `fflate@0.8.3` 讀取 Office ZIP，使用 `fast-xml-parser@5.11.1` 擷取 XML，將 DOCX、PPTX、XLSX 內容轉成既有文字區塊模型；不將文件內容傳出本機。
- 原因：沿用已技術驗證的純 JavaScript 套件與 M1 搜尋核心。ZIP 中需要解壓的 XML／關聯資料合計限制為 200 MB，以降低異常壓縮檔造成的記憶體風險。
- 限制：XLSX 的常見數字與日期格式可轉成可讀文字；複雜自訂格式可能與 Excel 畫面不同，需以實際文件驗收與後續修正。
- 超連結：DOCX 解析正文的一般 hyperlink、欄位型 HYPERLINK，以及 `word/` 下各部件的 hyperlink relationship；圖形或頁首頁尾等無法對應正文位置的網址另存文字區塊並標示來源部件，拆成多個 run 的欄位指令合併解析。XLSX 解析各工作表的 relationship、hyperlink 節點、文件內位置與提示。沿用既有搜尋核心。

## D010 — M3 PDF 文字層解析

- 狀態：已完成並通過公司 Windows 實際文件驗收
- 決策：使用 `pdfjs-dist@6.3.289` 從本機 PDF 位元組擷取每頁文字；CMap 與標準字型資料從安裝在本機的套件目錄載入。加密 PDF 記錄為 `encrypted`，沒有文字層記錄為 `no_text`，損壞 PDF 記錄為 `error`。
- 原因：沿用先前技術驗證的套件，保留頁碼並支援中文文字層；不發送文件內容至外部服務。掃描影像的 OCR 不屬於 MVP。
- Windows 修正：PDF.js 要求 `cMapUrl` 與 `standardFontDataUrl` 以正斜線結尾；資源路徑統一轉為可供 Windows `fs` 讀取的正斜線形式，避免原生反斜線觸發 `Invalid factory url`。
- 重試政策：增量索引會重新解析狀態為 `error` 的未變更文件，使解析器修正生效時不必由使用者刪除索引；已成功、`no_text`、`encrypted` 與 `too_large` 的未變更文件仍會略過。
- 驗收：使用者於 2026-09-15 回報 PDF Windows 資源路徑修正版成功解析實際文件。

## D011 — M4 重建、排除與同步狀態

- 狀態：已完成；使用者於 2026-09-16 回報 M4 驗收完成
- 決策：單一根目錄使用 `.localdocsearchignore` 保存排除規則，採用不依賴額外套件的有限 glob 語法；`rebuild` 使用資料庫 transaction 清空衍生文件資料後，重新索引目前根目錄。
- 決策：同步紀錄分為「最後嘗試」與「最後完整同步」。掃描或讀檔不完整時保留既有索引中的未確認路徑，並在 `status` 保存最近錯誤；文件解析錯誤則保存文件基本資訊並於後續索引重試。
- 原因：排除設定需跟著來源目錄並供重建沿用；保守刪除可避免權限或暫時讀取錯誤被誤判成來源文件刪除。所有清除操作只作用於明確開啟的 SQLite 索引，不刪除來源文件或寬泛路徑。
- 限制：初版 glob 不支援 `!` 重新納入；多根目錄與全機模式留待單一根目錄可靠性驗收後擴充。

## D012 — M5 借鑑開源專案完善品質與交付

- 日期：2026-09-16
- 狀態：規格已確認；使用者於 2026-09-16 回報 M4 驗收完成並要求開始 M5 實作與測試。
- 參考：[Paperless-ngx](https://docs.paperless-ngx.com/usage/#searching) 的欄位搜尋與相關性排序、[sist2](https://github.com/sist2app/sist2/blob/master/docs/USAGE.md) 的增量掃描與診斷、[ripgrep](https://github.com/BurntSushi/ripgrep) 的類型篩選與效能比較方法。採用範圍與完整驗收條件見 `SPEC.md` 第 15 節。
- 決策：新增搜尋 `--type`，先篩選再排序與限制結果數；維持整段子字串查詢，沿用檔名／標題／內容優先序。同分再依修改時間與固定路徑字串順序排列，每份文件一筆結果。
- 決策：明列 NFKC 與不依系統語系的小寫轉換；命中片段對回原文，來源位置與代表區塊一致。只有檔名命中時清楚標示，不展示無關片段。`--verbose` 解釋排序依據。
- 決策：補齊索引摘要、略過分類、耗時與歷史摘要保存；新增 `index`／`rebuild` 的 `--verbose`。不自動套用 `.gitignore` 或排除所有隱藏檔，不追蹤掃描中遇到的符號連結／junction。
- 決策：以固定合成資料集量測端到端 CLI 延遲、首次／增量索引、峰值 RSS 與索引大小，明確區分暖機與正式樣本，並驗證結果正確性及無變更時零解析。Windows 驗收與乾淨目錄交付驗證列為完成條件。
- 原因：既有 M5 僅概述排序、效能與交付，缺少可實作及可驗收的定義；本次把設計參考轉為符合公司 Windows 使用情境的具體要求。
- 範圍：保持 Node.js／TypeScript、SQLite、純本機、單根目錄與六種格式；進階查詢、多根目錄、全機模式、watch、OCR、GUI、AI 與外部搜尋服務另行規格化。


## D013 — M5 搜尋定位、診斷與交付實作

- 日期：2026-09-16
- 狀態：本機實作與測試完成，等待公司 Windows 的 M5 驗收。
- 決策：保留 SQLite 原文，搜尋時 NFKC／`toLowerCase()` 比對；僅對最後回傳結果建立 grapheme 原文範圍映射，必要時用前綴正規化處理跨 grapheme 組合。片段上限與截短註記由命中原文範圍決定。
- 決策：格式篩選在 SQLite 候選文件查詢套用；搜尋維持整段子字串與原有四級排序，CLI 僅在索引／重建時載入解析器，避免搜尋啟動時載入 Office／PDF。
- 決策：同步摘要與診斷沿用 metadata transaction 保存，不要求重建舊索引；根目錄切換時清除上個根目錄的最後完整同步時間。讀檔錯誤使同步不完整，格式解析失敗另列文件狀態。
- 決策：CLI 使用固定診斷訊息、階段、路徑與代碼，避免解析器原始例外帶出正文。略過目錄只算已遇到的項目，不遍歷其內部來累計數量。
- 決策：發布 0.5.0 原始碼／編譯產物包，依 package-lock 在目標平台安裝依賴，不打包 macOS 的 node_modules。效能腳本測量獨立 CLI，核對完整結果及增量內容，紀錄來源雜湊與平台；本機數據不推論 Windows 達標。
- 驗證：34 項自動測試、乾淨目錄安裝／測試／Demo 與 1,000 文件基準通過；詳細證據及資料集限制見 `M5-VALIDATION.md`。

## D014 — 後續格式優先序先依本機盤點決定

- 日期：2026-09-16
- 狀態：盤點已收到，由 D015 與 SPEC 第 16 節接續；M5 歷史基線不變。
- 背景：使用者確認公司 Windows 上無法搜尋內容的檔案為舊版 `.doc`；這是目前 SPEC 明列不支援的格式，非 `.docx` 解析缺陷。
- 決策：將 `.doc` 列為下次優化候選。先用 Windows 內建命令在本機彙總可讀檔案的副檔名與數量，再依盤點結果、格式解析可行性及實際需求決定優先序。
- 隱私：只需彙總數字，不需收集檔名、完整路徑或文件內容；不將公司文件上傳外部服務。


## D015 — 依使用者盤點啟動 M6-A

- 日期：2026-09-16
- 狀態：使用者已明確要求依缺口規劃並執行，M6-A 本機實作完成，Windows 驗收待回報；目前里程碑見 STATUS。
- 決策：本批加入 DOC、XLS、MHT／MHTML、HTML／HTM／XHTML、AsciiDoc；MSG 下一批、VSD 先做部署可行性驗證，其他候選見 SPEC 第 16 節。
- 決策：維持 Node.js／TypeScript 及本機處理，新增純 JavaScript 解析依賴，不要求 Office、COM 或外部轉檔程式。SheetJS 使用官方新版 tarball 並存於 vendor，避免 npm 舊版本及官方下載端點影響重現安裝。
- 參考：[word-extractor](https://github.com/morungos/node-word-extractor)、[SheetJS Node.js 安裝](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)、[postal-mime](https://github.com/postalsys/postal-mime)、[htmlparser2](https://github.com/fb55/htmlparser2)。
- 範圍：本次明確授權解除 DOC／XLS 的舊版 Office 開發限制；不是開啟全機掃描、OCR 或 AI。M5 Windows 未驗收部分保留，不阻擋本次授權的開發。

- 實作：新增依賴鎖定 `word-extractor@1.0.4`（MIT）、`xlsx@0.20.3`（Apache-2.0）、`postal-mime@3.0.0`（MIT-0）、`htmlparser2@12.0.0`（MIT）；來源說明見 `vendor/README.md`。
- 可靠性：DOC／XLS 二進位解析放入可終止 worker，30 秒期限及 512 MiB V8 old-generation heap 上限；逾時不留下半份文字，保留檔名並記為 error。對外診斷使用固定代碼，不輸出可能含正文的原始例外。
- 驗證：2026-09-16 macOS／Node.js 26.7.0 的 42 項自動測試通過；新增案例含合成 DOC／XLS、中文與 Big5、MIME、加密、失敗備援、worker 期限及跨程序 CLI。公司 Windows／實際文件尚待驗收。


## D016 — M6-B 本機 MSG 郵件內容搜尋

- 日期：2026-09-16；狀態：使用者已授權接續下一版，規格見 SPEC 16.4。
- 決策：新版本 0.7.0 支援郵件主旨、通訊欄位與一種正文表示（HTML、純文字、RTF 依序）；不展開附件或連線 Outlook。不改動既有排序與 SQLite 結構。
- 決策：使用純 JavaScript MSG／RTF 套件與既有 HTML 文字擷取，複用 worker 期限機制，避免損壞 OLE 或 RTF 讓整批索引卡住。只把郵件根層及收件者必要欄位交給 MSG 解析器，不遞迴解析附件郵件。
- 參考：[msgreader](https://github.com/HiraokaHyperTools/msgreader)、[rtf-stream-parser](https://github.com/mazira/rtf-stream-parser)。版本、限制及驗證結果將記錄於本批交付文件。
- 驗收界線：前版本機通過不等於 Windows 已驗收，本次繼續開發也不把前版驗收自動標記完成。VSD 留待下一里程碑。

- 依賴：`@kenjiuno/msgreader@1.28.0`（Apache-2.0）、`@kenjiuno/decompressrtf@0.1.4`（BSD-2-Clause）、`iconv-lite@0.6.3`（MIT）、`rtf-stream-parser@3.8.1`（MIT）。4.0.0 實際下載包缺少 package.json 指定的 dist 入口，故鎖定可載入的 3.8.1；解析前限制 RTF 輸入／解壓／輸出長度與 bin 參數，並在 worker 隔離執行。
- RTF：驗證 LZFu CRC 及長度。一般 RTF 加入文字模式標記後沿用 Unicode／字碼頁處理；使用版本鎖定的 feature hook 排除 pict／object／info 等非正文資料，並以回歸測試約束此行為。RTF 特殊欄位與版式不保證完整還原。
- S/MIME：依 [Microsoft 訊息辨識規格](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxosmime/e6f63b02-c679-4752-9302-9c4641749e95)，類別可能代表簽章或加密；不單憑類別回報 encrypted。本版以 MSG_SMIME_UNSUPPORTED 錯誤保留檔名。
- 驗證：macOS Node.js 26.7.0／22.17.0 全部 53 項測試通過；乾淨目錄 Node.js 22.17.0 的鎖檔安裝、測試與郵件 Demo 通過。92 項發佈內容核對並提供 SHA-256；公司 Windows 及實際 MSG 驗收尚待回報。

## D017：M6-C 先交付 VSD 檔名搜尋，保留內容解析缺口

- 日期：2026-09-16
- 使用者要求繼續實作，接續盤點中 143 份 VSD。0.8.0 先納入檔名與格式篩選，使用既有 unsupported 狀態與 VSD_CONTENT_UNSUPPORTED，與未掃描的未知格式區分。不將 unsupported 視為暫時解析故障重試。
- 審查 npm `@mdgate/visio@0.6.25` 的實際發佈內容：二進位 OLE 分支僅列舉 root streams 並掃描 UTF-16／UTF-8 可列印字串，未解析 VSD 圖形文字結構與壓縮；不採用其字串結果作為可靠內容。未安裝此候選套件。來源：https://github.com/mdgate/converters/tree/main/packages/visio 。
- LibreOffice libvisio 為原生解析器；本批未完成可攜式 Windows 整合、授權隨附及中文案例驗證，不自行引入 Visio／Python 或外部服務。不是宣稱所有 VSD 本機解析皆不可行。
- metadata-only 分支只 stat，不 readFile，沒有文件內容解析、損壞或加密判定；沿用單檔大小政策及增量生命週期。未來正式加入內容解析時，需讓原 unsupported 文件重新處理，不能只新增 parser 後沿用未變更略過。
- M6-C 內容擷取仍未完成；本次交付不代表全文支援或公司 Windows 驗收通過。

## D018：M6-C 以 TypeScript 解析 VSD v11 的直接圖形文字

- 日期：2026-09-17；使用者要求繼續 VSD 實作，本決策擴充 D017 的檔名限定。
- `visio-viewer-extension` 現行純 JS 版明列不支援二進位 VSD；未採用。改以 LibreOffice/libvisio 的 MPL-2.0 指標、chunk 及解壓邏輯為參考，移植所需部分至 TypeScript。固定來源 commit、授權及修改範圍見 vendor/README.md；改寫檔案保留 MPL-2.0，原始碼與授權隨包交付。
- 沿用 SheetJS CFB 容器及既有 worker，不加入 Python、原生模組、Visio 或網路服務。VSD v11 的直接 UTF-16 文字依紀錄邊界擷取，不採字串掃描；不渲染圖形，也不把未使用 master 或附件納入內容。
- 限制：未展開 master 繼承、動態欄位、頁名、超連結及 OCR。來源位置使用真實頁面／圖形 ID，不冒充畫面頁碼；沒有直接文字的 no_text 不代表圖形視覺上空白。
- 嚴格檢查長度、Unicode、循環、指標順序及總資源預算。任何解析失敗清空本次區塊，僅保留檔名。未知版本或必要結構回報 unsupported，損壞回報 error。
- 增量例外：unsupported VSD 即使未變更也重試，使 0.8.0 索引可直接升級並容納後續版本擴充。成功／no_text 仍零解析略過，未修改其他格式的重試規則。

## D019：以日常找檔閉環排序後續開發

- 日期：2026-09-17。依使用者收斂目標，成功標準為無管理員、有權限目錄中的本機內文搜尋與開啟。作品集為加值，不追開源星數或參考專案功能清單。
- M6-C 本批後，新增格式依真實失敗案例設停損，下一階段先規格化開啟文件／顯示資料夾，再多根目錄。完整順序、驗證缺口與可選 AI 人選上下文模式見 ROADMAP.md；不自動啟用 OCR、GUI 或整庫 RAG。

## D020：M7 以固定文件代碼連接搜尋與開啟

- 日期：2026-09-17。依 ROADMAP 進入 M7，版本 0.10.0；M5～M6 Windows 驗收仍保留。
- 選擇 ID＋路徑雜湊代碼而非上一輪搜尋排名，無需保存全域「最後搜尋」，不同終端互不覆寫；重用 ID 到不同路徑不能誤開舊結果。代碼只是選擇工具，不是授權憑證。
- 開啟前查目前索引、根目錄與來源檔案；拒絕子路徑連結、已刪除、非一般檔案及非支援格式。大小／mtime 改變時提示但不強迫重新解析。
- Windows 以固定 PowerShell 程式呼叫 ProcessStartInfo.UseShellExecute（open）或 Explorer /select（reveal）。文件路徑透過環境變數，不拼接 PowerShell 程式；不使用 cmd/start，不變更 ExecutionPolicy。10 秒期限並將啟動問題轉成固定代碼。
- 參考：https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute ；此機制只送出作業系統開啟請求，應用程式顯示及公司政策需要 Windows 實測。
- macOS 的 open／-R 僅供本機開發；自動測試使用 dry-run 或注入啟動函式，不自動開啟桌面應用程式。Windows 命令組裝測試不能冒稱 Windows UI 驗證。

## D021：M8 多根目錄隔離與集中驗收

- 日期：2026-09-17。使用者明確表示無時間逐版確認，授權持續開發；各版保留本機證據，整合後提供一份 Windows 清單，不以未回報驗收冒稱成功。
- 新增 roots 與 document_roots，歸屬及文件更新在同一 transaction；舊 root metadata 與全部文件一次原子遷移，保留文件 ID、文字及原同步時間。不依賴來源可讀，離線也可完成資料庫升級。
- 新增 index 位置不再清空其他位置。刪除、排除、重建均以歸屬限制；根目錄移除只刪衍生資料。根目錄各自保存同步摘要與最後完整時間，CLI 不以最新一次同步代表整體。
- 父子重疊先明確拒絕，避免同份文件兩套排除政策；實際相同位置的別名沿用既有根目錄。搜尋 --root 依已登錄路徑查索引，不重新存取來源。
- 批次同步根目錄失敗仍繼續其他位置，保存失敗紀錄並回傳 3。掃描不完整的重建保留未確認舊資料，已可讀的文件仍強制重解析。M7 開啟動作驗證文件自己的歸屬。


## D022：M9 人選上下文只匯出確認過的搜尋片段

- 日期：2026-09-17。依 ROADMAP／SPEC §19 進入 M9，版本 0.12.0；Windows 仍採 INTEGRATED-ACCEPTANCE 集中驗收。
- 決策：提供 `context` 互動命令，沿用既有關鍵字搜尋與文件代碼，不呼叫模型、不改寫查詢、不自動灌整庫。候選預設 100、每頁 10、最多選 20；匯出前完整預覽且必須輸入 `yes`。
- 決策：輸出為新 UTF-8 JSON（exclusive create），只含選取文件的路徑、代碼、狀態、位置、≤160 code point 片段與同步資訊；禁止覆寫；超過 256 KiB 拒絕。確認前後重新核對搜尋快照與來源 mtime／存在性，變更即拒絕靜默帶入舊預覽。
- 決策：非 TTY／EOF／取消不建立檔案。附 `docsearch.cmd` 僅方便呼叫，不改索引位置或 PATH。尚未連接 AI／IDE／MCP；BU 聊天專用匯入另定規格。
- 驗證：macOS Node.js 26.7.0 的 88 項測試通過、1 項 Windows cmd 略過；公司互動終端與 cmd 入口待集中驗收。

## D023：M10 以多段命中與 Markdown 服務「可貼上的精準上下文」

- 日期：2026-09-17。使用者明確要求繼續開發，不要把時間花在代理人自行驗收。
- 決策：在不接模型的前提下，讓 `context` 匯出更適合手動貼進允許通道：每份文件可帶多個命中區塊，並提供 Markdown 格式。
- 決策：JSON 升 schemaVersion 2，保留 M9 欄位以相容；新增 `passages`。預設 passages=3，上限 10，避免一次貼上過長。
- 決策：仍禁止自動外傳／自動同意／覆寫；OCR／GUI／向量 RAG 不在本版。

## D024：M11 用 Node fs.watch 做可選前台監看，不做系統服務

- 日期：2026-09-17。使用者選擇「監看目錄自動增量 index」。
- 決策：新增前台 `watch` 命令，依賴 Node 內建 `fs.watch({ recursive: true })` 與既有 `sync` 增量，不引入 chokidar／原生模組，不安裝 Windows 服務。
- 決策：防抖合併事件，避免存檔連打造成重複全量掃描壓力；啟動時先 sync 一次以對齊現況。
- 決策：只能監看已登錄根目錄，避免 watch 偷偷擴大索引範圍。

## D022：M9 先提供人選上下文檔，不自動接模型

- 日期：2026-09-17。沿用使用者要求的精準上下文方向，透過 CLI 互動清單實作模式 A 的預選代碼與模式 B 的查詢輸入，共用分頁、選取、完整預覽及確認。
- 僅匯出已選結果的原文命中片段與來源資訊，JSON 方便手動帶入或未來整合；不讀取整份正文、不匯出未選結果，不操作剪貼簿或任何 AI／聊天連線。檔名命中保留明確標示。
- 確認不接受管線或 --yes，避免非互動批次把整批結果自動帶走；產品中的人選是本功能本身，不影響使用者已授權持續開發。
- 預覽後核對原結果與當前索引，並檢查來源可讀性、大小與修改時間；偵測改變就拒絕，不靜默更換內容。這不是來源文件內容雜湊驗證，不承諾偵測刻意保持大小與 mtime 的變更。
- 輸出採 exclusive create 防止覆寫，最多 256 KiB。控制字元在終端跳脫顯示，JSON 正確保存原始值；來源文字標註為資料而非操作指令。選取功能不代表外傳公司文件已獲許可。
- 附加 docsearch.cmd，使用相對於腳本的 CLI 入口並傳回結束碼，不安裝服務或修改 PATH。Windows 實際批次檔測試在 macOS 明確略過，保留集中驗收。

## D025：M11 監看生命週期修正（0.14.1）

- 先建立監看再初次同步，避免初始化期間的事件空窗；同步中的事件僅標髒，完成後再防抖補跑。
- 停止時先關閉事件來源與計時器，再等待進行中的同步，最後由 CLI 關閉 SQLite。失效監看器不可繼續宣稱監看中；全部失效自動退出 3。
- 沿用 M11 範圍，不新增服務或外部依賴。更正套件版本與既有 M10／M11 文件不一致。

## D026：M12 以定期增量校正補償監看遺漏

- 依使用者持續開發授權，補足 FR-11 的事件僅作提示原則。預設每次同步完成後 5 分鐘再校正，可用 --rescan 調整或以 0 關閉。
- 沿用純 Node、增量比對與原索引範圍。監看失效降級為定期掃描並重試；離線保留索引，恢復重新同步。非背景服務。
- 測試注入計時器和監看器，使用真實暫存文件驗證漏事件修改／刪除、離線恢復與退出清理。

## D027：M13 獨立 SQLite 交易作寫入互斥

- 用主索引實際路徑旁的 .writer.sqlite 協調檔，以 BEGIN IMMEDIATE 持有跨程序單一寫入交易；不把漫長解析包在主索引交易，不用移除過期 PID 檔。檔案保留，關閉交易即釋放鎖。
- [SQLite 交易文件](https://www.sqlite.org/lang_transaction.html) 說明 IMMEDIATE 的互斥與 SQLITE_BUSY。本版另用獨立程序被終止測試恢復；不冒稱 Windows 已驗收。
- 忙碌不改主索引報告；watch 防抖後重試。鎖內再驗證登錄範圍，避免移除與掃描交錯復活資料。

### M13 證據補充（2026-09-17）

逐項盤點目標與現況，新增 GOAL-AUDIT.md；用現版重跑既有合成基準，另存 benchmark-m13-node22.json／M13-PERFORMANCE.md，保留 M5 歷史結果。不同 Node 版本不作速度優劣對比，macOS 數據不代替 Windows 驗收。不因持續開發授權而自動擴大 GUI／AI 範圍。

## D028：M14 跨查詢累積人選上下文

- 使用者將目前 macOS 電腦改為優先執行環境，Windows 驗收延後且不再阻擋版本迭代；仍維持 Node.js／TypeScript、純本機與不自動外傳。
- `context` 工作階段可用 `s <查詢>` 切換候選並保留已選文件；用 `b` 檢視跨查詢清單、`r <編號>` 移除。最多仍為 20 份文件，同一路徑只出現一次並保留首次選取時的查詢依據。
- JSON 升為 schemaVersion 3，頂層列出 `queries`，每份文件與每段命中記錄所屬 `query`。保留頂層 `query` 與文件既有欄位，讓既有讀取端有明確主要查詢可用。
- 切換查詢不呼叫模型、不改寫關鍵字、不掃描來源；只查本機索引。匯出前後分別以各文件的選取查詢重新驗證索引與來源。

## D029：M14 Windows 實測失敗以 0.17.1 修正

- 日期：2026-09-18。使用者在公司 Windows 執行 0.17.0 `npm test`，M13 寫入鎖競爭案例在 10 秒後逾時且整體約 65 秒，M9 從任意工作目錄啟動 `docsearch.cmd` 時被 `cmd.exe` 錯誤解析；OEM code page 錯誤文字又被測試當作 UTF-8 顯示成亂碼。
- 寫入協調仍採獨立 SQLite 交易。將 `PRAGMA busy_timeout = 0` 與 `BEGIN IMMEDIATE` 分為兩次呼叫，確保先安裝零等待 busy handler；同時辨識 SQLite extended BUSY／LOCKED code。測試直接斷言競爭在一秒內回報，CLI 子程序各有五秒期限，避免同步 API 卡住後掩蓋真正位置。
- cmd 測試不再自行組合首尾巢狀引號。批次檔絕對路徑放入測試專用環境變數，再以 `cmd.exe /d /c call` 啟動；失敗訊息只列結束碼、signal 與 Node error，不顯示可能採 OEM code page 的 cmd 錯誤位元組。
- 這些變更修正 Windows 入口與鎖競爭契約，不改產品索引資料、搜尋或 context schema。macOS Node.js 22.17.0／26.7.0 回歸通過；Windows 必須以 0.17.1 再跑後才可標示通過。

## D030：M15 以明確選用的本機剪貼簿降低交付摩擦

- 日期：2026-09-18。使用者回報 0.17.1 公司 Windows 驗證通過並詢問下一步；依 STATUS 已排定的方向，先縮短已選上下文帶入討論的操作，不直接連接特定 AI、IDE 或聊天帳號。
- `--clipboard` 與 `--out` 二選一，完整預覽和逐字 `yes` 不變。剪貼簿模式預設 Markdown，適合貼入討論；不提供非互動同意或自動傳送。
- 文件內容只經子程序 stdin 傳給 macOS `pbcopy` 或固定 Windows PowerShell `Set-Clipboard`，不放入 argv、環境變數、stderr 或 shell。仍受作業系統剪貼簿歷程、同步設定及其他本機程式影響，因此預覽時明示此界線。
- 測試以注入寫入器驗證內容、時序、取消與錯誤，不碰真實剪貼簿；平台啟動計畫另測 Unicode 輸入設定與無 shell 插值。

## D031：M16 以顯式 all-terms 補足片語搜尋缺口

- 日期：2026-09-18。使用者要求略過 M15 人工測試並繼續下一版。現有搜尋將整段查詢視為連續子字串，對日常用數個記得的詞找文件不方便；新增 `--all-terms`，不改預設語意。
- 詞以 Unicode 空白切分，不加入引號、布林、模糊、同義詞或中文斷詞語法。全部詞可分散於同一文件的檔名、標題和內容區塊，避免要求使用者記得原句與詞序。
- 仍使用線性掃描既有本機索引與可解釋排序，不新增 FTS schema、embedding 或外部服務。代表片段依詞涵蓋數、標題優先及 ordinal 決定；context 的重搜驗證必須保留相同模式。
- context JSON 升 schemaVersion 4 並記錄 `matchMode`，Markdown 同樣標示，避免相同查詢文字在日後無法分辨是片語或全部關鍵字。

## D032：M17 將掃描範圍升級為完整檔案清冊

- 日期：2026-09-19。使用者指出遞迴掃描即使遇到尚未支援的格式，也應知道檔案存在；因此所有未被排除的一般檔案都進 `documents`，而不是只保留內容解析器支援的格式。
- 支援格式維持全文解析。其他副檔名與無副檔名檔案採 metadata-only：只 `stat` 並保存路徑、檔名、類型、大小和修改時間，狀態為 `unsupported`，不讀正文、不建立 blocks，也不製造逐檔錯誤訊息。
- `--type` 改為接受安全的任意副檔名，open／reveal 以「已索引且仍位於所屬根目錄」作安全邊界，不再以解析器格式白名單拒絕。排除規則與連結政策不變。
- 未來加入新解析器時，既有同格式 `unsupported` 文件必須在下一次增量索引重試。這一版只修清冊完整性；壓縮內容與候選索引仍依獨立實驗決定，避免把正確性修正和儲存後端改造混在同一版。

## D033：索引瘦身先拆成串流、壓縮與候選三階段

- 日期：2026-09-19。使用「測試用資料」比較現況、逐列串流、每文件 Brotli、64 KiB Brotli、FTS5 trigram 與 Bloom trigram；12 組完整命中集合全部一致。
- 現況資料表只改逐列搜尋，峰值 RSS 即由 477.6 MiB 降至 104.7 MiB，證明 RAM 問題主要來自 `candidates()` 一次具體化整庫。下一版先修這個讀取路徑，不等待 schema 遷移。
- 儲存方向選 64 KiB 左右的獨立 Brotli 塊：4.46 MiB，為現況 25.2%；不採更小的每文件單塊，因為大型文件需整份解壓。這是原型方向，正式 chunk 邊界仍須保證片段、位置與更新原子性。
- FTS5 方案為 12.16 MiB，候選效果與 6.02 MiB 的 Bloom 接近，因此不列為首選。Bloom 保留為壓縮後的第二階段實驗，不能先於精確串流核對器；一、二字仍必須退回掃描。
- 原型沒有取代產品後端；正式行為變更必須另開里程碑、更新 SPEC 並補增量、崩潰恢復、排序、片段與遷移測試。

## D034：M18 先以 SQLite 串流讀取移除整庫 JavaScript 載入

- 日期：2026-09-19。依使用者要求開始改動，先實作 D033 風險最低的一步。SQLite schema、內容、查詢語意與 CLI 均維持不變；只替換讀取迴圈。
- Store 提供文件列與單一文件區塊的 iterator。搜尋掃完目前文件再前進，檔名命中不讀 blocks；context passages 直接定位單一文件。
- 搜尋結果仍需要保存命中的文件以排序和套用 limit，這是有界於文件數的必要資料；不得保存所有文字區塊或所有正規化全文。

## D035：M19 片段採區段定位與有界前後文

- 日期：2026-09-19。M18 移除 SQLite 整庫載入後，正式連續搜尋仍出現高 RSS；量測定位到 `makeSnippet()` 對超大命中區塊建立完整 Unicode 來源範圍與前後文陣列。這是顯示層暫存，而非索引或 SQLite 快取。
- 正常路徑以 code point 邊界分段核對完整 NFKC／小寫結果，並逐 code point 直接定位命中來源；前後文以有限收集器產生。組合字或語境大小寫無法逐點證明等價時，才只為命中小區段建立保留 grapheme 的來源範圍。避免把 `Intl.Segmenter` 套用於整份多 MB 原文，讓一般文字的額外配置量受片段上限約束。
- Unicode 的跨區段正規化或大小寫語境若使分段結果與完整結果不一致，立即使用既有完整映射作保守回退。回退罕見但可能耗用較多記憶體；不可為了節省記憶體而犧牲命中位置正確性。
- 本版只消除已量測的摘要熱點，不開始 Brotli schema 遷移。壓縮塊仍是下一個資料儲存里程碑，需另行處理遷移、transaction、一致性與實測。

## D036：M20 以 SQLite 關聯的獨立 Brotli payload 保存正文

- 日期：2026-09-19。M19 證實片段暫存不是 RAM 的唯一來源，且原始實驗顯示 64 KiB Brotli 分塊的總儲存量顯著低於現況。因此先改內容層，不先加入可能膨脹索引的 FTS 或 Bloom。
- 區塊 metadata 保留在 `blocks`；正文存入外鍵相連、每塊可獨立解壓的 payload 表。這讓更新與刪除能受既有 SQLite transaction 和 cascade 保護，也讓未來候選索引可只指向 payload，而不複製正文。
- 遷移採「先寫 payload，再確認寫入，最後清除舊正文」的單一 transaction。讀取時暫容忍舊正文，以利從舊版資料庫無中斷升級；任何資料不完整都視為索引錯誤，不靜默回傳漏字結果。
- 初步先由讀取層重組單一 text block，優先保住精確搜尋結果；後續再將搜尋核對下推至 payload 串流並加入候選過濾。不可將完成壓縮儲存誤稱為已完成最終 RAM 最佳化。
- 實作量測修正：真實資料有 115,618 個小文字區塊；每 block 一個 Brotli blob 使 SQLite 列與 frame 開銷反而將資料庫推至 19.31 MiB，較 17.70 MiB 現況更大。因此正式 payload 必須至少以文件為單位合併小 block 至約 64 KiB，並另存 block 對 payload 的範圍；不得交付一 blob 一 block 的中間設計。

## D037：M21 搜尋從文件批次 payload 逐段產生 block

- 日期：2026-09-19。M20 已壓縮正文，但若 `streamCandidates()` 先解壓並建成整份文件 blocks 陣列，仍會放大大型文件搜尋的短暫記憶體。搜尋主路徑改接 generator。
- payload 中的 `[blockId, contentFragment]` 保持原始 block 順序；讀取器只暫存當前 block 的跨 payload fragment，遇到下一 block 即交給搜尋。這保證跨 payload 的同 block 查詢不漏，而不同段落不會因串接誤命中。

## D038：M22 以文件級 trigram Bloom 作純排除候選

- 日期：2026-09-20。M21 仍對每份文件解壓與正規化；採固定大小 Bloom 可用極小空間跳過罕見三字以上查詢的不可能文件。
- Bloom 不儲存正文、不能作搜尋結果依據，且可能誤判為候選；只有「缺少某個必要 trigram」才能跳過文件。短詞與舊資料庫一律回退完整核對，正確性優先。

## D039：M23 以 payload 級 Bloom 縮小解壓範圍

- 日期：2026-09-21。M22 已能略過整份不可能文件，但常見詞仍使大型文件的全部 payload 解壓。保留文件級 Bloom 作第一層，再為每個 Brotli payload 保存固定 1 KiB 摘要及 payload／block 對應。
- payload Bloom 只尋找「至少一個可能 trigram」，不能要求整條長片語的全部 trigram 都在同一 payload；否則跨 payload 文字會被錯誤排除。選中的 payload 會回讀其完整 block fragments，最後仍由原精確核對決定命中。沒有 payload 候選但文件級摘要可能命中時回退整份文件，優先避免邊界漏搜。
- 代表片段回讀改依 block mapping 限縮至目標 block，避免排序後又解壓無關 payload。新 mapping／摘要遷移受單一 transaction 保護；缺資料一律走既有完整讀取，而非靜默省略。

## D040：M23 修正版將遷移移出開庫，逐文件接續且不重壓縮

- 日期：2026-09-21；0.26.1 已依 SPEC §34 實作。取代 D039 的全庫單一遷移交易及 D036 在共用開庫時自動遷移的做法；單份文件更新的原子性仍保留。
- 公司診斷副本顯示 610 文件、219,518 區塊且缺 payload_bloom_version；共用初始化因此對 index／status 都執行全庫遷移。已定位路徑，尚未量測各熱點成本，不能歸因於解析逾時。
- 唯讀操作不建表、不遷移、不回復 hot journal；明確回報需要升級、忙碌或 INDEX_RECOVERY_REQUIRED。回復與遷移放在持有跨程序寫入鎖的明確寫入流程，先顯示階段。
- 已是內容格式 2 的資料只逐 payload 建立摘要及對應，保留原壓縮 bytes；使用 ID／Map 查找，消除 O(B²) 掃描。每文件的衍生資料及完成標記原子提交，全部完成才寫全庫版本，中斷後接續。
- 搜尋對未完成摘要採完整核對；即時進度及取消能力涵蓋升級與索引各階段。610 文件／219,518 區塊合成量測在目前 Mac 的 Node 26.7.0／22.13.1 均約一秒且 payload bytes 不變；仍需公司 Windows／Node 22.17.0 複驗。本次不調整解析期限、不改產品搜尋語意。

## D041：Windows 鎖等待必須在 DatabaseSync 開庫時設為零

2026-09-22 更正：當時將開庫 timeout 當作逾時根因的推論未獲證實。公司 0.26.2 逐檔測試通過、並行全套仍逾時；保留零等待設定，但不能稱為已驗證的效能修正。

- 日期：2026-09-21。公司 Windows／Node.js 22.17.0 執行 0.26.1 全套測試得到 142 通過、4 失敗、2 略過；M13 一項及 M24 兩項都在 CLI 子程序的五秒期限耗盡，M9 則在含空白與括號的下載路徑經 `cmd.exe /c` 呼叫失敗。
- Node.js 22.16.0 已加入 `DatabaseSync` 的 `timeout` 建構選項，目標 22.17.0 可用。主索引唯讀／寫入連線與 writer 協調連線均在建構時傳入 `timeout: 0`，再保留分開的 PRAGMA；這讓 busy handler 在任何 schema／狀態查詢或 `BEGIN IMMEDIATE` 前生效。
- 不放寬產品或測試的五秒期限。M9 測試改由暫存批次檔呼叫含特殊字元的 launcher 路徑，避開 Node argv 到 `cmd /c` 的額外引號解析，同時保留不同 cwd 的驗證目的。
- GitHub 原始碼壓縮檔不含編譯產物；加入 npm `prepare`，使 `npm ci` 直接建立 `dist`。這是安裝流程修正，不改搜尋、索引資料或文件內容。

## D042：以固定 SQL 參數傳遞候選集合

- 日期：2026-09-22。公司搜尋與本機 40,000 區塊回歸均證實 SQL 綁定參數超限。以 json_each(?) 展開候選 payload／block 數字陣列，兩階段查詢分別固定為 2／3 個參數；維持唯讀、不建立暫存表、不修改索引格式。
- 公司獨立測試通過而全套並行逾時，預設測試改為逐檔，保留內部真正的跨程序鎖競爭及原期限。watch 靜態引用 sync 會連帶載入所有 parser，改為 runWatch 時才動態載入。
