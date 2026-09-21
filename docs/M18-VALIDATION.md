# M18 0.21.0 驗證

M18 將 `search` 改為逐份文件、逐區塊讀取 SQLite；`matchingPassages` 改為只讀指定文件。排序、片段、格式／根目錄篩選、片語和 `--all-terms` 行為不改，資料庫 schema 也不改。

2026-09-19 在 macOS、Node.js 26.7.0 執行 `npm test`：136 項中 135 通過、0 失敗、1 項 Windows cmd 專屬測試略過。新增測試使舊 `candidates()` 方法直接失敗，確認產品搜尋不再走整庫 blocks 陣列；同時驗證片語、檔名、all-terms、root／type 篩選和 context passages。

使用 `/Users/hermes/Downloads/測試用資料` 的 12 組完整命中集合重跑，結果與 M17 一致。原型的純串流核對峰值為 103.1 MiB；正式產品的連續查詢 worker 峰值為 433.5 MiB。後者仍高，是因為命中超大區塊時 `makeSnippet()` 會建立整段 Unicode 範圍對照，並非所有 SQLite blocks 又被讀回記憶體。

因此 M18 已移除第一個 RAM 熱點，但不把原型數字宣稱為正式 CLI 成果。下一里程碑先把片段計算改成有界記憶體，再進行 Brotli 分塊遷移。Windows 0.21.0 尚未實機驗證。
