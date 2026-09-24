# 目前交接：Seekah 0.36.2 GUI 已實作

更新：2026-09-24。

**目前允許實作範圍為 SPEC §47／D059；0.37.0 仍暫緩。0.36.2 GUI 已完成本機交付驗收，後續不得把本批擴張到 §46。**

程式與 package／lockfile已為 0.36.2。正式工作台為左導覽／中央搜尋／右上下文三區；命中預覽可經 stable reference 安全地開啟原檔或顯示所在位置，GUI 不顯示 ISO 時間。工作台開啟後背景同步既有根目錄，尚無索引時由使用者在 UI 選擇第一個根目錄；精確上下文只供本機複製，不提供聊天 Provider。TUI 另依 SPEC §45.8／D063 改為 session-local 單欄 workflow。兩者都重用既有搜尋、選取與 context 安全契約，不開始 0.37.0。

- [產品使用手冊](../USER-GUIDE.md)：安裝、索引、GUI、TUI、CLI、上下文複製與排錯的操作入口。
- 本批已檢視並更新使用手冊：雙擊後命令視窗會顯示安裝／啟動進度，不再停在空白啟動頁；完成後才開工作台。後續改動只更新受影響段落。
- [0.36.2 實作交接](0.36.2.md)：完成項目、驗證與禁止擴張。
- [給 Luna Max 的實作指令](PROMPT.md)：保留歷史入口，已由本批完成。
- [SPEC §47](../SPEC.md#47-0362核准的本機-gui-工作台改版)：行為權威，安全沿用 §43。
- [核准 GUI 設計說明](../design/SEEKAH-WORKBENCH.md)／[互動稿](../design/seekah-workbench.html)：後者仍是示範原型，不是驗收證據。
- [核准 TUI 設計說明](../design/SEEKAH-TUI.md)／[互動稿](../design/seekah-tui.html)：Claude Code 式資訊階層；後者明示示範資料，不是 runtime 驗收證據。
- [0.36.1 驗收交接](0.36.1.md)：保留歷史與公司 Windows 待驗，不阻塞本批。
- [0.36.2 驗證文件](../0.36.2-VALIDATION.md)：命令、瀏覽器操作、限制與未驗證項。

固定交接中心：[README.md](README.md)。GitHub 儲存庫為 [`ododuuu/seekah`](https://github.com/ododuuu/seekah)；不移動資料、不改 parser selection、不開放 LAN、不持久化 Key；CLI／MCP 與 0.37.0 範圍保持不變。TUI 只改呈現及 session-local workflow，不改 domain 或 terminal lifecycle。
