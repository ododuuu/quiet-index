# M7 0.10.0 驗證與 Windows 驗收

本版讓內容搜尋結果可直接開啟或在資料夾顯示，未加入 GUI、AI 或更多格式。

## 自動驗證範圍

2026-09-17，macOS arm64 的 Node.js 26.7.0／22.17.0：嚴格 TypeScript 編譯及 71 項測試通過（新增 8 項）。

新增測試涵蓋固定文件代碼、不因排序改變選錯檔案、ID 重用、來源刪除／不可用、根目錄切換、非一般檔案、子路徑連結、中文與特殊字元、來源變更提示、dry-run 不啟動、固定 PowerShell 程式與路徑資料分離、子程序失敗／期限及獨立 CLI 搜尋到動作驗證。

macOS 的測試不啟動桌面應用程式；Windows 指令組裝測試不能證明公司 Windows 能開啟。Windows 無管理員測試避免建立檔案 symlink，仍以資料夾 junction 測試連結拒絕。其餘原有格式與增量測試保留。

## 公司 Windows 操作

```powershell
node --version
npm.cmd ci
npm.cmd test
node dist/src/cli.js index "你的文件資料夾"
node dist/src/cli.js search "文件內文的關鍵字"
```

從實際輸出複製文件代碼，取代下列範例：

```powershell
node dist/src/cli.js open 12-a1b2c3d4e5f60708 --dry-run
node dist/src/cli.js open 12-a1b2c3d4e5f60708
node dist/src/cli.js reveal 12-a1b2c3d4e5f60708
```

驗收事項：

1. 內文搜尋找到預期文件；文件代碼與該路徑同列。
2. dry-run 顯示正確路徑且沒有開啟程式。
3. open 透過預設程式開啟正確文件；reveal 在 Explorer 選取同一份文件。分別測試中文、空白、逗號、`&` 與單引號檔名。
4. 搜尋不同關鍵字後，原代碼仍指向原文件；修改文件後能開啟最新版並提示索引可能過期。
5. 對自己建立的測試副本，移除來源後舊代碼明確失敗；不拿工作文件做刪除測試。
6. 若程式關聯或 PowerShell 被公司政策阻擋，記錄 ACTION_LAUNCH_FAILED，不修改政策。可先依結果完整路徑人工開啟。

需回報：Node.js 版本、自動測試摘要、open／reveal 結果及錯誤代碼。不要上傳公司文件。成功訊息僅表示開啟請求已送出，仍需目視確認應用程式與選取的文件。
