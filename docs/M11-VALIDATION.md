# M11 0.14.1 驗證

本版新增前台 `watch`：變更後自動增量 index。不做系統服務、不連網。

## 本機

2026-09-17 macOS／Node.js 22.17.0：102 測試，101 通過、0 失敗、1 略過（Windows cmd）。新增啟動期間事件、同步中停止、監看器部分／全部失敗及原生 fs.watch 修改後可搜尋的回歸測試。

```powershell
node dist/src/cli.js index "C:\Users\你的帳號\Documents\測試文件"
node dist/src/cli.js watch
# 另開終端修改測試目錄內的 .txt，等待約 1.5 秒後
node dist/src/cli.js search "新關鍵字"
```

確認啟動會同步、變更後索引更新、Ctrl+C 正常結束。macOS 原生監看已自動實測；公司 Windows 訊號、網路磁碟與監看行為仍保留集中實測。
