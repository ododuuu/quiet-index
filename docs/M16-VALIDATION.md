# M16 0.19.0 驗證

M16 加入顯式多關鍵字全部命中模式，處理只記得數個詞、但不知道原句與詞序的找檔情境。

```powershell
.\docsearch.cmd search "付款 例外 規格" --all-terms
.\docsearch.cmd context "付款 例外 規格" --all-terms --clipboard
```

未加 `--all-terms` 時仍比對完整連續片語。啟用後，每個空白分隔詞都必須在同一份文件中出現，可分散於檔名、標題或不同內容區塊。沒有布林、引號、模糊、同義詞或萬用字元語法。

自動測試涵蓋：跨區塊全部命中、缺一詞拒絕、預設片語回歸、Unicode 空白、重複詞、檔名／標題／內容排序、passage 詞覆蓋、context 同模式重驗、schemaVersion 4／matchMode 與 CLI 選項範圍。

2026-09-18：macOS Node.js 26.7.0 與 22.17.0 完整測試均為 131 項、130 通過、0 失敗、1 項 Windows cmd 略過。交付包解壓至全新目錄、`npm ci` 後，以 Node.js 22.17.0 重跑結果相同。Windows 功能實測依使用者時間延後。
