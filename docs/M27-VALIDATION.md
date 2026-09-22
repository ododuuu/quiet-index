# M27 0.30.0 驗證

M27 依 SPEC §38 實作原始碼文字、Big5 與索引觀測。`.java`／`.sql`／`.js` 逐非空白來源行保存原文；`.class` 僅檔名。共用解碼順序為 BOM → XML 既有 UTF-16 特徵／encoding 宣告 → 嚴格 UTF-8 → 嚴格 Big5。明確宣告失敗不回退；`cp950`／`windows-950` 正規化為 `big5`。舊 TXT／MD／AsciiDoc／XML 與新格式 unsupported 以逐文件 `parse_version` 在普通 `index` 升級，不必 rebuild、不可清空索引。

進度：TTY 單行每秒、非 TTY 每五秒；read／parse／write 快速切換不繞過節流。未變更檔在 `processed++` 之後 continue，全數未變更仍會讓出事件迴圈。完成前百分比最高 99.99%。預設不洗版；詳細路徑見 `--verbose` 與 `status --issues`。

`status` 列出主庫與 WAL／SHM／journal／writer 附屬檔的檔案長度（MiB 兩位小數）。`--types` 為已索引 metadata，不掃描來源、不解壓正文。`--issues` 分列目前文件問題與各根同步診斷，兩組可能重疊。

## 本機自動測試

2026-09-22 Linux 開發沙盒 `npm test`：197 項中 194 通過、1 失敗、2 略過。M27 新增 16 項涵蓋解碼優先序、三種原始碼與大小寫、CRLF／LF／CR、空檔與超長單行、100 MiB 邊界、class 不讀正文、舊 unsupported／indexed 升級、中斷接續、too_large／error／子樹隔離、進度節流與 99.99%、status 容量／issues／types、系統目錄提示。

失敗項為既有 M7 真實開啟在非 macOS／Windows 回報 `ACTION_PLATFORM_UNSUPPORTED`。略過項為 M5 無法讀取目錄（此環境為 root）及 Windows cmd launcher。不得以本沙盒結果取代 macOS 完整回歸或公司 Windows 驗收。交付包 `LocalDocSearch-M27-0.30.0.zip` 逐檔核對 200 個檔案，SHA-256 `4390a048913f76dec7a3b0ebc8bb199e85b8e6b595961af863c7b5bd48df822e`。

## 合成效能

`scripts/benchmark-m27.mjs`、原始 JSON `docs/benchmark-m27.json`。Node.js v22.23.2、Linux、160 份小檔（java／sql／js），每組重複 3 次取中位數：

| 項目 | 中位數 |
|---|---|
| 嚴格 UTF-8 解碼（40 份 buffer） | 0.20 ms |
| UTF-8 失敗後 Big5（40 份 buffer） | 0.33 ms |
| 完整索引 UTF-8 根 | 195.0 ms |
| 完整索引 Big5 根 | 195.1 ms |
| 無變更增量 | 11.7 ms |
| 含 1 份解析錯誤的重試 | 10.5 ms |
| 索引檔案長度（各根） | 516,096 bytes |

解碼回退有可測成本，但完整索引被 SQLite 寫入主導，兩種編碼幾乎相同。這是小樣本合成資料，不能外推 378 GB 公司庫，也不得宣稱新增格式固定加倍或零成本。

## 公司 Windows 驗收

請在公司電腦對 **現有 0.29.1 索引** 執行普通 `index`（不要 rebuild、不要刪除資料庫）：

1. 觀察百分比進度是否前進（含大量未變更），結束是否為 100% 且「同步完整」可為否。
2. 搜尋已知中文、Java／SQL／JS 關鍵字，確認行號。
3. 比較 XML 錯誤碼：宣告失敗應為 `XML_ENCODING_UNSUPPORTED`／`XML_DECODE_ERROR`，不得假設全部變成 Big5 成功。
4. 立即再跑一次 `index`，無變更為主；`error` 仍會重試，parserCalls 不必為零。
5. `status` 看容量合計；`status --issues` 與 `--types` 只回報統計與錯誤碼，不要上傳公司文件內容。
6. 抽測搜尋延遲是否可接受。

0.29.1 D 槽人工成功與 1113.18 MiB 是升級前基準；新增正文後容量預期上升。
