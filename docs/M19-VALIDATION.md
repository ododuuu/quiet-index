# M19 0.22.0 驗證

M19 將命中片段改為有界暫存：常見文字逐 Unicode code point 定位，只有組合字或語境大小寫無法證明等價時，才在最多 32 KiB 的區段建立既有 grapheme 對照。前後文以有限收集器產生，不再將整段文字轉成陣列。

2026-09-19 在 macOS、Node.js 26.7.0 執行 `npm test`：138 項中 137 通過、0 失敗、1 項 Windows cmd 專屬測試略過。M5 的 NFKC、組合字、全形、İ、希臘 sigma、日韓字元與長命中測試持續通過；M19 新增跨越多個 32 KiB 區段的原始 Unicode 命中與長命中截短測試。

使用 `/Users/hermes/Downloads/測試用資料` 重跑 12 組完整命中集合，結果與 M18 一致。連續正式搜尋 worker 的取樣峰值 RSS 為 405.8 MiB，M18 同方法為 433.5 MiB；最慢查詢 p95 為 185.2 ms。M19 移除了已定位的片段陣列熱點，但全文 NFKC 正規化與逐份精確核對仍佔主要成本，不能將這個結果描述為壓縮索引後的 RAM 成果。

原始數據在 `storage-backend-comparison-m19.json`。Windows 0.22.0 尚未實機驗證。
