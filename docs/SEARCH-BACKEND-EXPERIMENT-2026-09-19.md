# 搜尋儲存原型試驗（2026-09-19）

本次使用使用者指定的本機「開發手冊」資料夾作唯讀試驗；產品索引與來源文件皆未修改。資料夾總量約 27 MiB、143 個檔案，其中目前 LocalDocSearch 支援 20 份文字文件，其餘主要為圖片與不支援格式。成功擷取 239 個文字區塊、UTF-8 文字合計 152,742 bytes。

## 現有 0.19.0 基準

- SQLite 索引：249,856 bytes。
- 初次索引：約 0.61 秒；CLI 回報同步核心約 25.61 ms。
- 五組代表查詢：約 0.18～0.20 秒。
- 索引與搜尋程序最高 RSS：約 129～133 MB；此小資料集主要反映 Node.js 與模組啟動成本，不能外推大型資料量。

## 臨時 SQLite 原型

原型沒有修改正式程式碼。它將每個既有文字區塊以 Node.js 22.17.0 內建 Brotli quality 5 無損壓縮，另建 FTS5 contentless trigram、`detail=none`、`columnsize=0` 候選索引。

| 項目 | 大小 |
|---|---:|
| 原始擷取文字 | 152,742 bytes |
| Brotli 壓縮內容本體 | 78,538 bytes |
| 含位置欄位的壓縮內容資料庫 | 110,592 bytes |
| contentless trigram 候選資料庫 | 225,280 bytes |
| 兩者合計 | 335,872 bytes |
| 現有 SQLite 索引 | 249,856 bytes |

壓縮內容剩原文字節數的 51.4%，但加入 trigram 後，原型總量比現有索引大。這批資料不能證明大型資料仍是相同比例，卻足以否定「換成 FTS5 trigram 就會自動瘦身」。

239 個區塊逐一解壓後與原始 SQLite 文字完全一致。五組至少三個 Unicode 字元的代表查詢，以現有 NFKC＋小寫連續子字串結果為基準；trigram 候選皆包含全部正確文件，本次沒有漏候選，也沒有額外候選。少於三字的查詢無法依賴這個 trigram 路徑，尚未解決。

Node.js 22.17.0 的 FTS5 實測可用，但 `contentless_delete=1` 與 `columnsize=0` 不能同時設定。正式設計若採最精簡 contentless 索引，增量刪除需使用 FTS5 delete 命令，不能假設一般 DELETE 行為。

## Tantivy Node 綁定檢查

本機未安裝 Rust，因此先在臨時目錄測試第三方 `@oxdev03/node-tantivy-binding@0.3.3` 預編譯套件，未加入產品依賴。套件可在 macOS arm64／Node.js 22.17.0 載入，但型別宣告列出的 `Tokenizer.ngram()` 等靜態建構方法在實際執行時不存在，無法依文件建立自訂 n-gram analyzer。

這個第三方綁定目前不能作為產品選型依據。若繼續評估 Tantivy，應建立由本專案控制、使用官方 Rust crate 的獨立 sidecar 原型，同時驗證 Windows x64 封裝；不能把本次未完成的 Node 綁定試驗解讀為 Tantivy 核心失敗。

## 結論與限制

- 無損壓縮本身不影響文字精確度，且本資料有明顯空間收益。
- 完整 trigram 倒排索引可能抵銷壓縮收益；容量與效能必須一起看。
- 這批資料適合作搜尋正確性種子集，不足以決定大量資料的索引體積、RAM 或後端選型。
- 後續比較必須涵蓋一字／二字中文、長片語、標點與料號、跨區塊 all-terms、增量修改刪除及更大文字量。

