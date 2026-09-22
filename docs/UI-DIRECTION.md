# LocalDocSearch 操作介面方向

更新：2026-09-23。0.33.0 已將 TUI 選取籃與唯讀本機 MCP 接上同一套上下文服務；本文保留 MCP App／本機 Web UI 的判斷依據。

## 建議結論

目前已完成類似 Claude Code 的本機終端互動介面（TUI）與 stdio MCP。下一步優先在 MCP 工具上增加可選的嵌入式 MCP App：搜尋、勾選、確認後把選定片段送回對話；仍保留 TUI 作所有終端可用的後備。不要做需要外部網站或雲端服務才能使用的介面。

## 為何先做終端互動介面

- 沿用現有 Node.js／TypeScript、`docsearch.cmd`、SQLite 與 CLI service，不需要管理員、安裝程式或額外瀏覽器政策。
- 不開本機連接埠，攻擊面與公司環境阻力較小；斷網仍可完整使用。
- 最快把既有功能組成單一工作區：輸入查詢、列表／分頁、`/` 縮小、back／reset、open／reveal、context 選取、roots、status 與 autoupdate。
- 可先使用 Node readline／ANSI 與鍵盤操作，避免為外觀引入大型 GUI framework；非 TTY 時保留既有命令與可腳本化輸出。

## 何時值得增加 localhost Web UI

若實際使用需要滑鼠、多欄篩選、長片段閱讀、問題統計圖表或更豐富的文件預覽，再新增本機 Web UI。它仍由 LocalDocSearch 在本機提供，只綁定 `127.0.0.1`，每次啟動使用隨機 token，不接受 LAN 連線、不載入 CDN、不把文件送到外部。

Web UI 的優點是版面、可及性與預覽較好；代價是要管理 port、瀏覽器啟動、CSRF／token、CSP、生命週期及公司端點防護軟體。這些成本在目前「快速可攜、無管理員、純本機」目標下，不應先於 TUI。

## 建議分期

1. 使用者後續明確要求同版完成；0.32.0 已交付 XLSM／ODT／RTF／CSV 與純 Node 終端互動介面。
2. 後續介面功能持續經既有 application service／`SearchSession` 擴充；CLI 保持相容，介面不直接操作 SQLite schema。
3. 在公司 Windows 驗證鍵盤、中文輸入、終端尺寸、open／reveal 與背景狀態。
4. 0.33.0 已補 `/select`／`/context` 與 MCP。0.34.0 優先評估相容 Host 內的 MCP App 選取介面及一鍵註冊／診斷；Host 不支援 UI 時，headless tools 與 TUI 必須完整可用。
5. 只有嵌入 UI 與 TUI 都無法解決的滑鼠／預覽需求明確出現時，才另行規格化 localhost Web UI。

## 必要安全界線

- 介面只顯示使用者主動搜尋到的索引內容，不預載整庫正文。
- 預覽、剪貼簿及 context 沿用既有明確選取與確認；不得自動傳送至 AI 或聊天平台。
- 日誌不得記正文；公司文件與索引不得上傳。
- GUI／Web/TUI 都必須共用既有搜尋、根目錄、安全開啟、writer lock 與 autoupdate 契約，不另寫第二套索引核心。
