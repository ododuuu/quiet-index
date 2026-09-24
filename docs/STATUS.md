# 專案狀態

最後更新：2026-09-23（0.36.1 本機實作完成；公司 Windows 人工驗收待回報）

## 目前狀態

- **目前程式版本為 0.36.1；權威規格為 SPEC §45／D054。** 已完成 Windows 系統目錄排除、scope-aware deletion、profile 路徑診斷與可操作 TUI。0.37.0 仍依 §46／D055／D056 處理日常變更發現及 all-terms 效能，未提前實作。
- 2026-09-24 依使用者要求新增本機工作台 GUI 設計提案：[設計說明](design/SEEKAH-WORKBENCH.md)／[互動稿](design/seekah-workbench.html)。提案將既有搜尋、拖曳、上下文預覽與可選 AI API 收斂為「左側導覽／中央結果／右側上下文」三區工作台，並完成桌面與行動版響應式示範；目前只新增設計稿，尚未修改 `docsearch ui` 正式介面、產品行為、版本或 0.37.0 範圍。
- Scanner 現在回報最小 `protectedScopes`。`removeMissing()` 只保留位於失敗 scope 的舊文件；正常 sibling 的已刪文件仍移除。root `readdir` 失敗保護整根，rebuild 也不會先清掉失敗 subtree；同步摘要顯示受掃描失敗保護的數量。
- `$RECYCLE.BIN` 與 `System Volume Information` 改用唯一的 Windows path 判定，僅排除 drive／UNC share root 的精確直接子目錄及其後代，case-insensitive。完整掃描、watch 與局部更新共用；相似名稱、一般子目錄內同名路徑及非 Windows 路徑不排除。
- `--profile` 仍以 exclusive create 拒絕覆寫，也不建立父目錄。失敗診斷顯示 resolved parent、錯誤碼、CMD `%USERPROFILE%` 與 PowerShell `$env:USERPROFILE` 範例；疑似傳入另一 shell 的字面變數只提示，不自動展開。失敗發生在索引寫入前。
- TUI 已依核准稿改為低噪音鍵盤介面：首頁、三行結果、內部 preview、已選清單、context 確認、命令與真實索引狀態共用固定 composer／footer。raw decoder 支援分段 CSI、單獨 Esc 與 UTF-8；↑／↓、Space、Enter、PgUp／PgDn、Esc／←、Tab／Shift+Tab、`/`、q、Ctrl+C、EOF、resize 均有 reducer／render／PTY 證據。輸入焦點中的 q 是文字，context 仍逐字 `yes` 才複製。
- 聚焦回歸 58 項全數通過。短 `TMPDIR=/tmp` 的完整套件在 Node.js 26.7.0 與正式最低 22.17.0 都是 250 項、248 通過、0 失敗、2 項 Windows CMD launcher 略過；真實 80×24 PTY 已完成翻頁、選取、preview、Esc 返回與 q 退出。公司 Windows 尚未驗收，不能以 macOS path semantics／PTY 代替。
- 使用者已在公司 Windows 實測 0.36.0：舊索引沿用；一次性 `文字解析升級=60014` 完成後第二次為 0；約 299,530 份未變更文件會直接略過。0.36.1 不更改此 parser selection，也不處理固定 parser errors。
- 普通 `index D:/` 仍是完整 reconciliation，約 30 萬檔的 2～4 分鐘枚舉成本不屬 0.36.1。0.37.0 將驗收並擴充既有 `autoupdate` 日常路徑、持久 queue、可接續校正與 mixed all-terms pruning；不使用 USN、不要求管理員權限。
- 下一步：在公司 Windows 以無機密測試樹驗證 sibling 權限失敗、系統目錄排除與 80×24／120×40 TUI；不得直接用公司整庫做破壞性刪除實驗。其後依 SPEC §46 實作 0.37.0。

## 已交付基線與歷史紀錄

- 目前版本：**0.35.0 本機拖曳工作台與可選 AI API**，規格見 SPEC §43、D052；本機實作完成。`docsearch ui` 只綁 `127.0.0.1`，整合既有索引搜尋、人工勾選、拖曳臨時文件、256 KiB 精確預覽／複製，以及經 HMAC preview 與明確同意後的 OpenAI／xAI Responses API 選配。
- 拖曳原檔在權限受限暫存目錄解析後立即刪除；正文與 UI 輸入的 Key 只留在目前程序記憶體。API endpoint 固定，不提供任意 proxy、cookie 擷取或消費訂閱代登入。ChatGPT 與 OpenAI API、Grok 與 xAI API 分別計費。
- 0.35.0 本機 Node.js 22.13.1 完整 `npm test` 共 233 項：232 通過、0 失敗、1 項 Windows cmd 專屬略過；正式最低仍為 22.17.0。真實 Provider 未呼叫，公司 Windows 尚未驗收；驗證見 `docs/0.35.0-VALIDATION.md`，剩餘優化見 `docs/NEXT-TODO.md`。
- 交付包逐檔核對 258 個檔案：`LocalDocSearch-0.35.0.zip`，SHA-256 `a7be696053bcdd1473decacb061099a94d93fe9ea8b1722b624a394b96aaff53`。
- 目前版本：**0.34.0 MCP App 搜尋工作台與本機接入**，規格見 SPEC §42、D051；本機實作完成。相容 Host 可透過標準 MCP App 搜尋、跨頁勾選、更新模型上下文與明確送出問題；另有安全冪等的 Codex 註冊及唯讀 doctor。不支援 UI 時維持四個 headless 工具與 TUI 備援。
- 0.34.0 本機 Node.js 22.13.1 完整 `npm test` 共 228 項：227 通過、0 失敗、1 項 Windows cmd 專屬略過；正式最低仍為 22.17.0，公司 Windows 與真實 MCP Apps Host 尚未驗收。驗證見 `docs/0.34.0-VALIDATION.md`。
- 交付包逐檔核對 246 個檔案：`LocalDocSearch-0.34.0.zip`，SHA-256 `779cf31e00ce3c1513131c3d72fa2c7326e2fd3d83e6d2a2c6a760f5e1df8c6e`。
- 目前版本：**0.33.0 本機 MCP 與人選上下文閉環**，規格見 SPEC §41、D050；本機實作完成。唯讀 stdio MCP 提供 `search_documents`／`prepare_context`／`index_status`，TUI 提供選取籃、預覽與確認複製；不含 MCP 寫入工具、遠端 HTTP、整庫自動匯入或 Host 專屬滑鼠 UI。
- 0.33.0 本機 Node.js 22.13.1 完整 `npm test` 共 222 項：221 通過、0 失敗、1 項 Windows cmd 專屬略過；正式最低仍為 22.17.0，不得把此結果宣稱為公司 Windows 通過。驗證見 `docs/0.33.0-VALIDATION.md`。
- 交付包逐檔核對 239 個檔案：`LocalDocSearch-0.33.0.zip`，SHA-256 `adb5a8485cc2aa083b86955ca5caf05a67ce98e5d252ce739a4f09af20882b57`。
- 目前版本：**0.32.0 XLSM／ODT／RTF／CSV 正文解析＋終端互動介面**，規格見 SPEC §40、D048、D049；本機實作完成。從 0.31.0 起以版本號作唯一里程碑名稱，不再新增 M 編號。
- `.xlsm` 共用安全 OOXML 儲存格解析；`.odt` 擷取 `content.xml` 可見文字；`.rtf` 與 MSG 共用受限核心；`.csv` 支援 RFC 4180 相容 quoting、quoted newline、BOM／UTF-8／Big5。禁止執行巨集、公式、物件或外部資源；舊 unsupported 下一次普通 index／背景完整校正會重試。
- `docsearch tui` 已提供純 Node 全螢幕終端介面，整合搜尋、全部詞、翻頁、結果內縮小、open／reveal、status 與 roots。它不開網路連接埠；context 與 autoupdate 管理仍使用既有 CLI。
- 需要公司真實檔案才能定位的 PDF／PPTX／XLS 問題已集中至 `docs/COMPANY-WINDOWS-DIAGNOSTICS.md`，由公司 Windows 電腦上的 Codex 處理；不得上傳公司文件。
- 已提供 `autoupdate start|status|stop`、可驗證本機單例、事件佇列與精確檔案／子樹更新、預設 6 小時完整增量校正、動態 roots、降級復原、安全停止及有界日誌。本版不做開機／登入自啟，不安裝 Windows Service，0.30.0 索引可直接使用。
- 編碼政策已鎖定：明確 BOM／XML 宣告優先；無訊號時整份嚴格 UTF-8，失敗才整份嚴格 Big5。精度優先，不加統計猜測或要求使用者指定目錄編碼。
- 產品 package **0.32.0**。本機 Node.js 22.13.1（低於正式最低 22.17.0）建置及 0.32.0 聚焦測試通過；完整 218 項為 217 通過、0 失敗、1 項 Windows cmd 專屬測試略過。另修正 macOS `/var` 與 `/private/var` 根目錄別名通過安全驗證後，open／reveal 應保留使用者登錄路徑。交付包逐檔核對 232 個檔案：`LocalDocSearch-0.32.0.zip`，SHA-256 `6e2665d0a624ff33f6dd567a4e3a76f5ecca84bdd8898f66e7ed4e52f3ca77f3`；不得把本機結果宣稱為公司 Windows 通過。
- 前景 `watch` 已改用局部更新引擎；檔案事件不再每個都全根 `sync()`。search／status 不會暗中啟動背景程序。
- Linux 開發沙盒完整 `npm test`：213 項中 210 通過、1 失敗、2 略過。新增 16 項 0.31.0。失敗項為既有 M7 開啟在非 darwin／win32 回報 `ACTION_PLATFORM_UNSUPPORTED`。略過項為 M5 無法讀取目錄（root）及 Windows cmd 專屬測試。不得把此沙盒結果宣稱為 macOS 全套通過或 Windows 驗收。
- 0.30.0 原始碼、Big5 與索引觀測 **已完成實作**。下列 0.30.0／0.29.1 為歷史紀錄。
- 2026-09-22 Linux 開發沙盒 `npm test`：197 項中 194 通過、1 失敗、2 略過。新增 16 項 M27。失敗項為既有 M7 開啟在非 darwin／win32 回報 `ACTION_PLATFORM_UNSUPPORTED`。略過項為 M5 無法讀取目錄（root）及 Windows cmd 專屬測試。不得把此沙盒結果宣稱為 macOS 全套通過或 Windows 驗收。交付包逐檔核對 200 個檔案：`LocalDocSearch-M27-0.30.0.zip`，SHA-256 `4390a048913f76dec7a3b0ebc8bb199e85b8e6b595961af863c7b5bd48df822e`。
- 合成效能（Node.js v22.23.2，160 份 java／sql／js，重測中位數，見 `benchmark-m27.json`）：嚴格 UTF-8 解碼 0.20 ms、UTF-8 失敗後 Big5 0.33 ms；完整索引約 195 ms（兩種編碼相近，成本在寫入而非解碼）；無變更約 12 ms；錯誤重試約 10 ms。索引約 516 KiB。不得外推為固定加倍或零成本，也不得用此小樣本代表 378 GB 公司庫。
- 使用者已回報 0.29.1 公司 Windows 人工執行成功，D 槽合併既有子根 2 個並保留 107,414 文件；找到 358,102 份一般檔案、更新 256,564、未變更 101,526、移除 0；新增 250,688、重新處理 5,876、解析器呼叫 12,161 次。
- 0.29.1 該次處理狀態：indexed 11,534、no_text 561、unsupported 244,403、too_large 0、encrypted 0、error 66；掃描／讀取錯誤 13，同步完整為否，未確認的舊資料被保留。這些是該次處理量，不是全庫累計狀態；不將人工成功擴張為所有格式或全套自動測試通過。
- 同步耗時 8,455,609.94 ms（約 2 小時 21 分），使用者表示電腦仍順暢且耗時可接受。來源規模約 378 GB；容量以使用者後續回報的 1113.18 MiB 為準，暫無立即瘦身需求。來源 GB 並非實際解析 bytes，不能作文字壓縮率。
- XML、PPTX、PDF 的具體失敗根因尚未取得完整錯誤碼；XML 明確宣告失敗不回退 Big5。0.30.0 升級後請比較 XML 錯誤碼分布，不得直接推定所有 XML error 都是 Big5。
- 2026-09-22 Linux 開發沙盒完整 `npm test` 見上方 197 項結果。下列 0.29.1 為歷史紀錄。
- 2026-09-22 Linux 開發沙盒 `npm test`：181 項中 178 通過、1 失敗、2 略過。失敗項為既有 M7 開啟在非 darwin／win32 回報 `ACTION_PLATFORM_UNSUPPORTED`。略過項為 M5 無法讀取目錄及 Windows cmd 專屬測試。不得把此沙盒結果宣稱為 macOS 全套通過或 Windows 驗收。交付包逐檔核對 193 個檔案：`LocalDocSearch-M26-0.29.1.zip`，SHA-256 `add7f3a02441e321fe67ed726c6bd9c9ac989b722d18651bc2b0432433625736`。

- 搜尋會回報完整命中總數、頁碼及本頁範圍。TTY 預設每頁 20 筆，接受 n／p 翻頁、`/ 關鍵字` 縮小、back／reset 與 q；非互動使用 `--page`／`--page-size` 並顯示下一頁提示。`--limit` 保留為互斥的單次輸出。命中排序只建立一次，每頁才回讀片段；工作階段期間若 SQLite `data_version` 改變則回報 `SEARCH_INDEX_CHANGED`。
- `.xml` 逐行保存原文，包含標籤、屬性和值；支援 UTF-8、UTF-16 BOM／起始位元組與 TextDecoder 可辨識的 declaration 編碼，不解析 DTD／entity。舊 unsupported XML 執行一次普通 index 即重試，不需 rebuild。
- 0.27.0 在 macOS／Node.js 26.7.0 完整逐檔回歸為 155 項：154 通過、0 失敗、0 取消、1 Windows CMD 專屬略過（17.13 秒）。新增 5 項覆蓋 45 筆三頁、CLI 總數／範圍／續頁提示／越界、XML 第 12 行、UTF-16、格式不完整、未知編碼及舊 unsupported 升級。交付包逐檔核對 185 個檔案：`LocalDocSearch-M24-0.27.0.zip`，SHA-256 `10a9f058bb2c67ea20e48ef14e666cc3c4410e5411a00433761b93185513cc0b`。公司 Windows 人工驗收已由使用者回報成功；新版完整自動測試結果未另回報。
- 前一里程碑 0.26.3 依 SPEC §34.7 修復公司搜尋已確認的 `too many SQL variables`；下列 0.26.2 為歷史紀錄。
- 公司 0.26.2 真實 index／status 已成功：9,845 份檔案、593 indexed，payload Bloom 1；10 份 PPTX 的 OFFICE_MISSING_PART 與 1 份 XLS 錯誤尚未定位，不能宣稱格式驗收全部通過。
- 公司兩次直接搜尋診斷都在 streamBlocksFor 得到 ERR_SQLITE_ERROR／too many SQL variables。本機新增單份 40,000 區塊案例已在修正前重現相同堆疊；改用固定參數的 json_each 後通過，另驗證 33,001 payload 的跨邊界命中。
- 公司逐檔 M24 為 4 通過；M7／M9／M12／M13 為 33 通過、1 略過。2026-09-22 並行全套為 143 通過、3 失敗、2 略過，仍是 CLI 五秒逾時。0.26.3 預設逐檔測試並延後 watch 的解析器載入；不得將 0.26.2 timeout 設定宣稱為已證根因。
- 0.26.3 在 macOS／Node.js 26.7.0 完整逐檔回歸為 150 項：149 通過、0 失敗、0 取消、1 Windows CMD 專屬略過（16.48 秒）。公司真實搜尋與新版完整測試仍待複驗。交付包由 npm run package 逐檔核對，SHA-256 見同名 .sha256。

- 里程碑：M23 Windows 複驗修正 0.26.2——索引升級、唯讀 status、Windows 開庫零等待與原始碼安裝；規格見 SPEC §34。6。程式、本機回歸與交付包已完成，公司 Windows 重跑尚未完成。
- 公司 Windows／Node.js 22.17.0／0.26.1 全套實測為 148 項：142 通過、4 失敗、2 略過。M13 寫入鎖競爭及 M24 的 live writer／hot journal 三項都在 CLI 子程序五秒期限耗盡；M9 cmd launcher 在 `quiet-index-main (1)` 的含空白／括號路徑回傳 1。這次已執行但未通過，不能標記 Windows 驗收完成。
- 0.26.2 將 `DatabaseSync` 的 `timeout: 0` 提前至主索引唯讀／寫入與 writer 協調資料庫的建構階段，確保任何查詢或 `BEGIN IMMEDIATE` 前已有零等待 busy handler；不延長原五秒測試期限。M9 測試以暫存 wrapper 避免 Node argv 與 `cmd /c` 的雙層特殊字元解析，仍從不同 cwd 呼叫真正的 `docsearch.cmd`。
- GitHub Source code 壓縮檔沒有 `dist`，因此 0.26.2 加入 npm `prepare`：`npm ci` 完成後直接產生編譯檔。0.26.1 的第一次 `MODULE_NOT_FOUND` 發生於 build 前，不是索引資料錯誤；其後 `npm test` 已成功 build。
- 0.26.2 在目前 Mac 的 M9／M13／M24 聚焦回歸為 21 通過、0 失敗、1 項 Windows cmd 專屬略過。完整 148 項為 146 通過、0 失敗、1 項 M11 原生 watcher 在此環境 15 秒逾時而取消、1 項 Windows cmd 專屬略過；單獨重跑 M11 仍為同一環境限制，與本次開庫修正無關。
- 0.26.2 交付包已逐檔核對 181 個檔案：`LocalDocSearch-M23-0.26.2.zip`，雜湊寫入同名 `.sha256`。全新解壓後以 Node 22.13.1 執行 `npm ci`，prepare 成功建立 `dist` 且 CLI help 可執行；版本低於正式目標而出現 engine 警告，不能取代 Windows／22.17.0 重跑。
- 公司 Windows／Node.js 22.17.0／0.26.0 已回報 index 超過五分鐘無進度、status 無輸出，未通過本次驗收。診斷副本回復後可讀：610 文件、219,518 區塊，content_storage_version=2、multi_root_version=1，缺少 payload_bloom_version=1；主庫 84,459,520 bytes、journal 12,965,512 bytes。唯讀診斷曾得到 776（待回復交易），不得當作原始延遲主因或資料毀損證據。
- 已移除共用開庫的自動遷移：status／search 等讀取命令以唯讀連線開庫；status 在任何資料庫查詢前顯示索引位置，列出格式與升級進度。776 會回報 INDEX_RECOVERY_REQUIRED，busy／locked 立即回報 INDEX_BUSY。
- Bloom 升級受 writer lock 保護，直接逐 payload 建立對應與摘要，不重壓縮或改寫 payload；以 Map 線性查找、逐文件交易及完成標記接續。Ctrl+C 在文件／payload 安全點停止並回傳 130；index、rebuild 與 watch 的同步預設輸出節流進度。
- 新增 M23 修正版 4 項回歸：唯讀檢查零遷移、中斷後接續且 payload bytes 不變、主資料庫真實寫入交易期間 status 五秒內讀取，以及 hot journal 明確回報並由下一個 writer 回復。M8／M20 舊遷移測試改為明確寫入升級。
- 610 文件／219,518 區塊合成舊索引量測：Node 26.7.0 為 877.44 ms、峰值 RSS 113,295,360 bytes；Node 22.13.1 為 985.25 ms、峰值 RSS 103,006,208 bytes。兩者 610 個 payload 的數量與 bytes 前後完全相同，建立 219,518 個 mapping、610 個 Bloom／完成標記。這是目前 Mac 合成資料，不取代公司 Node 22.17.0 真實索引複驗。
- 0.26.1 在目前 Mac 的全套共 148 項：146 通過、0 失敗、1 項既有 M11 原生 watcher 在目前環境 15 秒逾時而取消、1 項 Windows cmd 專屬略過。公司 Windows 結果以上述 142／4／2 取代「待複驗」狀態，但尚未通過。以下 0.26.0 記錄為缺陷回報前的歷史證據。
- 0.26.1 交付包已逐檔核對 181 個檔案：`LocalDocSearch-M23-0.26.1.zip`；SHA-256 為 `6164546db0fd62f83b1bce7cf17bd71f84ed9ca901feb3e8932394ab7904d9e3`。公司複驗步驟見 `M23-FIX-WINDOWS-ACCEPTANCE.md`。
- 0.26.0 M23 新增 payload／block 對應與 1 KiB payload 級 trigram Bloom；文件 Bloom 先排除不可能文件，再只解壓含可能 trigram 的完整文字區塊。跨 payload 片語、短詞、舊索引或無 payload 候選均安全回退，搜尋結果語意未變。M20～M23 相關自動測試 6 項通過；完整全套在此受限 sandbox 仍有 M11 原生監看逾時，且 M15 CLI 因預設索引位置唯讀而得到 4（預期 3），待可寫入的標準環境重跑。Windows 0.26.0 尚未實機驗證。
- M23 交付包已建立並逐檔核對 174 個檔案：`LocalDocSearch-M23-0.26.0.zip`；SHA-256 為 `5195f205ceaa9b9ecc0be4fba8fd654da2b46d0d6fe1dcfa24fb10c79e90c2fd`。Windows 仍需使用者在公司電腦完成實機驗收。
- 0.21.0 自動測試共 136 項：135 通過、0 失敗、1 項 Windows cmd 專屬測試在 macOS 略過。M18 測試封鎖舊 `candidates()` 整庫載入，覆蓋片語、多詞、篩選、片段與 context passages。
- 0.22.0 自動測試共 138 項：137 通過、0 失敗、1 項 Windows cmd 專屬測試在 macOS 略過。新增 M19 大型 Unicode 原文與長命中截短回歸。
- M19 交付包為 `LocalDocSearch-M19-0.22.0.zip`，SHA-256 為 `e6523104bd193ef65104be33ff67304dd7f7a72ea8a51e101e3e09a4d29defa5`；Windows 0.22.0 尚未實機驗證。
- 0.20.0 自動測試共 135 項：134 通過、0 失敗、1 項 Windows cmd 專屬測試在 macOS 略過。新增案例涵蓋未知副檔名、無副檔名、不讀正文、任意類型篩選、open dry-run、增量修改／刪除及排除／連結。
- 使用 `/Users/hermes/Downloads/測試用資料` 唯讀實測：找到並登錄 471 份一般檔案，151 次內容解析；結果為 indexed 139、no_text 11、unsupported 320、encrypted 1、error 0，首次 5.11 秒。第二次增量 471 份全數未變更、解析器呼叫 0、21.6 ms。
- 真實資料已用 `.mov` 的 `IMG_8805.MOV` 與 `.zip` 的 `開發手冊.zip` 驗證檔名搜尋及 `--type` 篩選，兩者均清楚顯示 unsupported／僅檔名命中。
- 若索引資料庫位於掃描根目錄內，會排除自身 SQLite、WAL、SHM、journal 與 writer 協調檔，避免索引輸出回饋成來源。
- 交付包為 `LocalDocSearch-M17-0.20.0.zip`；打包程序逐檔核對 156 個檔案，全新解壓後 `npm ci` 無弱點警告並重跑相同 135 項測試結果。
- `search`／`context` 新增 `--all-terms`；全部空白分隔詞可分散在同一文件的檔名、標題與不同內容區塊，既有預設仍為精確片語。
- 代表片段依詞涵蓋數、標題優先與原始順序選擇；context passages 優先補足尚未顯示的關鍵字，預覽後以同模式重新驗證。
- context JSON schemaVersion 4 新增 `matchMode`，Markdown 同樣標示搜尋模式。
- macOS／Node.js 26.7.0 與 22.17.0：131 項，130 通過、0 失敗、1 Windows cmd 略過。
- 0.19.0 交付包全新解壓、`npm ci` 後以 Node.js 22.17.0 重跑，結果相同；Windows M15 剪貼簿與 M16 多詞功能依使用者時間延後實測。
- 0.19.0 交付包為 `LocalDocSearch-M16-0.19.0.zip`，並附同名 `.sha256` 檔供下載或複製後核對檔案完整性。
- `context --clipboard` 在完整預覽及 `yes` 後將 Markdown（或明確指定的 JSON）送入本機剪貼簿；與 `--out` 二選一，不連線外部服務。
- 剪貼簿資料只經子程序 stdin 傳遞；Windows 固定 PowerShell UTF-8 `Set-Clipboard`，macOS 使用 `/usr/bin/pbcopy`。自動測試不改動真實剪貼簿。
- macOS／Node.js 26.7.0 與 22.17.0：127 項，126 通過、0 失敗、1 Windows cmd 略過。
- context 內可用 `s <查詢>` 保留選取並搜尋下一批候選；`b` 查看跨查詢清單，`r <編號>` 移除。
- JSON schemaVersion 4 與 Markdown 都標示搜尋模式、總查詢及每份文件／passage 的查詢來源；同一文件去重，跨查詢總上限 20。
- 匯出前後依各文件自己的查詢重新驗證索引與來源；取消、無結果與無效操作不破壞已選狀態或建立部分檔案。
- macOS 真實 TTY 已完成「規格查詢→選取→BU 聊天查詢→選取→預覽→yes→Markdown」流程。
- 公司 Windows／Node.js 22.17.0 執行 0.17.0 `npm test`：M13 寫入鎖競爭測試超過 10 秒，M9 cmd 啟動測試受引號解析影響；其餘回報未顯示失敗。這次是已執行但未通過，不能標示 Windows 驗收完成。
- 0.17.1 將 SQLite 零等待設定與取鎖拆開，補上競爭耗時斷言及子程序期限；cmd 測試改以環境變數和 `call` 傳遞含空白的絕對路徑，失敗診斷不再解碼 OEM 錯誤內容。
- macOS／Node.js 26.7.0 與 22.17.0：123 項，122 通過、0 失敗、1 Windows cmd 略過；M13 整組分別約 1.57 秒與 1.41 秒。
- 0.17.1 交付包為 `LocalDocSearch-M14-0.17.1.zip`，144 個檔案逐檔核對；全新解壓後 `npm ci` 並以 Node.js 22.17.0 重跑，122 通過、1 Windows 專屬略過。最終雜湊記錄在同名 `.sha256` 檔。
- 使用者於 2026-09-18 回報公司 Windows 的 0.17.1 驗證通過；M13 鎖競爭與 M9 cmd launcher 修正完成驗證。此回報證明自動測試通過，不擴張為所有公司真實文件、open／reveal 或長期日常使用皆已驗收。

## 後續與限制

- 已用 `/Users/hermes/Downloads/測試用資料` 完成第一輪儲存／搜尋後端對照。12 組完整命中集合均與 0.20.0 相同；現況 17.70 MiB，64 KiB Brotli 4.46 MiB，Brotli＋Bloom 6.02 MiB，Brotli＋FTS5 12.16 MiB。詳見 `STORAGE-BACKEND-COMPARISON-2026-09-19.md` 與原始 JSON。
- 現有 SQLite 只改逐列串流，原型峰值 RSS 由 477.6 MiB 降至 104.7 MiB。下一里程碑建議先修正式搜尋的整庫載入，再做版本化 Brotli 分塊；Bloom 候選排在壓縮之後，FTS5 暫不採用。
- M18 對「測試用資料」重跑 12 組完整命中集合，結果與 M17 相同；正式搜尋已不載入所有 blocks。長時間連續查詢 worker 的峰值仍為 433.5 MiB，原因是 `makeSnippet()` 對命中的超大區塊建立整段 Unicode 對照表，不是 SQLite 整庫載入。下一步先將片段定位改成有界記憶體；在那之前不宣稱 M18 已達到 104.7 MiB 的正式 CLI 峰值。
- M19 在同一資料夾、Node.js 26.7.0 的 12 組查詢重跑，完整命中集合不變；正式 worker 峰值 RSS 為 405.8 MiB，最慢 p95 為 185.2 ms。片段的整段位置陣列已移除，但全文正規化與逐一核對仍是主要記憶體成本；不得把這個小幅下降宣稱為壓縮後端的成果。原始量測為 `storage-backend-comparison-m19.json`。
- M20 的第一個每 block Brotli 實作已由真實資料否決：115,618 個 payload 使資料庫達 19.31 MiB，高於 M17 的 17.70 MiB。命中與資料完整性均正確，但空間目標未達成；正在改為每文件合併小 block 的 payload 設計，尚不可封裝或宣稱 M20 完成。
- M20 改為每文件合併小 block 的 64 KiB Brotli payload 後，真實資料的 payload 數降為 285，資料庫為 12,259,328 bytes（11.69 MiB），較 M17 的 17.70 MiB 減少 34.0%。`管理系統` 搜尋命中、位置與原始片段正確。140 項自動測試為 139 通過、0 失敗、1 Windows 專屬略過；Windows 0.23.0 尚未實機驗證。
- M21 將主搜尋改為逐 payload、逐 block 產生，並修正 payload 寫入必須依 block ordinal 排序。141 項自動測試為 140 通過、0 失敗、1 Windows 專屬略過。真實 12 查詢結果集合不變；獨立程序連續量測峰值 RSS 394,512 KiB（約 385 MiB）。仍需解壓與正規化全部 payload，下一步候選過濾才可能有量級改善。
- M22 新增 1 KiB 文件級正規化 trigram Bloom；三字以上長查詢可跳過確定不命中的文件，一、二字及缺摘要資料安全回退。142 項測試為 141 通過、0 失敗、1 Windows 專屬略過。真實 12 查詢結果不變，峰值 RSS 389,280 KiB（約 380 MiB）；長片語／無結果較快，但常見詞候選多，下一步需 payload 級候選。

- 2026-09-19 使用使用者指定的本機開發手冊作唯讀原型：20 份支援文件、239 個文字區塊。Brotli 將 152,742 bytes 文字壓至 78,538 bytes，但加上精簡 contentless trigram 後合計 335,872 bytes，高於現有 249,856 bytes 索引；五組三字以上查詢未漏候選，一／二字搜尋仍未解。詳見 `SEARCH-BACKEND-EXPERIMENT-2026-09-19.md`。
- 第三方 `@oxdev03/node-tantivy-binding@0.3.3` 可載入預編譯套件，但實際 API 缺少型別宣告中的 n-gram tokenizer 建構方法；不加入產品依賴。Tantivy 若續評估，需以官方 Rust crate 建立受控 sidecar 原型。
- 使用者已授權以目前 Mac 持續逐版做到完整目標，不逐版要求確認。M16 已補上多詞分散命中；後續繼續以本機自動測試推進，並依實際搜尋失敗案例調整查詢、格式支援或本機整合，不預設連接外部帳號。
- 專用聊天平台匯入、AI／IDE 直接接入與查詢改寫仍未實作；M14 只處理本機索引中的 TXT／MD／MSG 等既有來源。
- 不混用舊版寫入索引、不刪除執行中的協調檔；索引放本機磁碟。搜尋不是整批同步的固定快照。
- 保留大量既有未提交工作，不重置或覆蓋舊版交付包。

## M13 目標證據盤點與效能複測

- 2026-09-17 已逐項整理 GOAL-AUDIT.md，區分本機已證明、Windows 缺證據與後續選配。
- Node.js 22.17.0 的 0.16.0 固定 1000 份六格式合成小文件：初次索引中位數 4087.98 ms、未變更 217.99 ms、搜尋 p95 216.63 ms；所有結果及增量異動斷言通過。
- 原始報告 benchmark-m13-node22.json 與 M13-PERFORMANCE.md 為本次補充；舊 M5 數據與已交付 0.16.0 壓縮檔未覆寫，程式碼沒有變更。
- 缺口仍是公司 Windows 新版實際使用證據；AI／IDE 自動接入、專用聊天匯入與 GUI 按鈕並未實作，依路線圖為未啟動選配。不把 CLI 匯出冒稱已連接 AI。

## 開發目標調整

2026-09-17 使用者明確取消公司 Windows 逐版驗收門檻，要求先在目前 macOS 電腦持續迭代到完整目標。Windows 相容與未驗證事實仍保留，但不再視為 active blocker。

M14 先讓同一個 context 工作階段能跨多次查詢累積選取，將規格、程式文件與 BU 聊天等不同關鍵字來源放入同一份精準上下文。仍需逐項預覽與 yes，不自動傳送到 AI。
