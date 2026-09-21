# M23 修正版 0.26.2 公司 Windows 複驗

此複驗針對 0.26.0 的啟動阻塞。不得刪除 `%LOCALAPPDATA%\LocalDocSearch` 內的資料庫、journal、WAL 或 writer 檔；來源文件不會被修改。

## 1. 核對與解壓

```cmd
certutil -hashfile LocalDocSearch-M23-0.26.2.zip SHA256
```

將輸出與交付的 `LocalDocSearch-M23-0.26.2.zip.sha256` 內容比對，兩者必須相同。

解壓至新的使用者可寫入目錄，在該目錄開啟 CMD：

```cmd
node -v
node -p "require('./package.json').version"
node dist/src/cli.js status
```

若使用 GitHub 的 Source code 壓縮檔而不是正式交付包，先執行一次 `npm ci`；0.26.2 會在安裝後自動建立 `dist`。

預期 Node.js 為 `v22.17.0`、版本為 `0.26.2`。`status` 必須先印出索引位置與「讀取索引狀態」，不得進行全庫升級或長時間空白。

- 若顯示「需要升級」，記錄已完成／總文件數後繼續第 2 節。
- 若回報 `INDEX_RECOVERY_REQUIRED`，這是先前中斷留下的待回復交易；直接繼續第 2 節，不刪除 journal。
- 若五秒內沒有上述輸出，記錄最後一行並停止測試。

## 2. 接續升級與索引

以原本測試的完整路徑執行：

```cmd
node dist/src/cli.js index "原本指定的資料夾完整路徑"
```

預期先看到 `[recover]`／`[upgrade]` 階段，升級期間持續顯示已完成／總文件數與目前文件；完成後顯示 `[scan]`、`[read]`／`[parse]`／`[write]` 及最終摘要。升級不得重新解析來源文件，也不得重新壓縮既有 payload。

若需驗證接續，可在升級期間按一次 `Ctrl+C`。預期回報 `OPERATION_CANCELLED` 並回到 CMD；再次執行同一命令時，完成數從已提交位置接續。不要使用工作管理員強制終止作為正常驗收步驟。

## 3. 完成後狀態

```cmd
node dist/src/cli.js status
```

預期顯示 `payload Bloom 1`、「索引升級：已完成」，並列出根目錄、最近同步與文件狀態。回報三次命令的完整輸出與大約耗時；在使用者回報前，不標記公司 Windows 驗收通過。
