# LocalDocSearch 操作介面方向

更新：2026-09-22。使用者已確認需要易於日常操作的介面；具體版本尚未排定。本文是後續規格化的建議，不代表已實作。

## 建議結論

先做類似 Claude Code 的本機終端互動介面（TUI），再依日常需要決定是否增加 localhost Web UI。不要做需要外部網站或雲端服務才能使用的介面。

## 為何先做終端互動介面

- 沿用現有 Node.js／TypeScript、`docsearch.cmd`、SQLite 與 CLI service，不需要管理員、安裝程式或額外瀏覽器政策。
- 不開本機連接埠，攻擊面與公司環境阻力較小；斷網仍可完整使用。
- 最快把既有功能組成單一工作區：輸入查詢、列表／分頁、`/` 縮小、back／reset、open／reveal、context 選取、roots、status 與 autoupdate。
- 可先使用 Node readline／ANSI 與鍵盤操作，避免為外觀引入大型 GUI framework；非 TTY 時保留既有命令與可腳本化輸出。

## 何時值得增加 localhost Web UI

若實際使用需要滑鼠、多欄篩選、長片段閱讀、問題統計圖表或更豐富的文件預覽，再新增本機 Web UI。它仍由 LocalDocSearch 在本機提供，只綁定 `127.0.0.1`，每次啟動使用隨機 token，不接受 LAN 連線、不載入 CDN、不把文件送到外部。

Web UI 的優點是版面、可及性與預覽較好；代價是要管理 port、瀏覽器啟動、CSRF／token、CSP、生命週期及公司端點防護軟體。這些成本在目前「快速可攜、無管理員、純本機」目標下，不應先於 TUI。

## 建議分期

1. 0.32.0 先完成 XLSM／ODT／RTF／CSV，避免介面與解析器同版擴張。
2. 下一個介面版本先建立可測試的 application service，再做 TUI；CLI 保持相容，介面不直接操作 SQLite schema。
3. 在公司 Windows 驗證鍵盤、中文輸入、終端尺寸、open／reveal 與背景狀態。
4. 收集兩週日常摩擦；只有 TUI 無法解決的問題明確出現時，再規格化 localhost Web UI。

## 必要安全界線

- 介面只顯示使用者主動搜尋到的索引內容，不預載整庫正文。
- 預覽、剪貼簿及 context 沿用既有明確選取與確認；不得自動傳送至 AI 或聊天平台。
- 日誌不得記正文；公司文件與索引不得上傳。
- GUI／Web/TUI 都必須共用既有搜尋、根目錄、安全開啟、writer lock 與 autoupdate 契約，不另寫第二套索引核心。
