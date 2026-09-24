# 目前交接：Seekah 0.36.2 GUI 已實作

更新：2026-09-24。

**目前允許實作範圍為 SPEC §47／D059；0.37.0 仍暫緩。0.36.2 GUI 已完成本機交付驗收，後續不得把本批擴張到 §46。**

程式與 package／lockfile 已為 0.36.2。正式工作台已重做為左導覽／中央搜尋／右上下文三區，後端只新增受保護的唯讀 `GET /api/index-status`；搜尋、臨時文件、精確預覽、複製、Provider／model／Key、AI 回答與錯誤狀態均沿用安全契約完成。

- [0.36.2 實作交接](0.36.2.md)：完成項目、驗證與禁止擴張。
- [給 Luna Max 的實作指令](PROMPT.md)：保留歷史入口，已由本批完成。
- [SPEC §47](../SPEC.md#47-0362核准的本機-gui-工作台改版)：行為權威，安全沿用 §43。
- [核准 GUI 設計說明](../design/SEEKAH-WORKBENCH.md)／[互動稿](../design/seekah-workbench.html)：後者仍是示範原型，不是驗收證據。
- [0.36.1 驗收交接](0.36.1.md)：保留歷史與公司 Windows 待驗，不阻塞本批。
- [0.36.2 驗證文件](../0.36.2-VALIDATION.md)：命令、瀏覽器操作、限制與未驗證項。

固定交接中心：[README.md](README.md)。不移動資料、不改 parser selection、不開放 LAN、不持久化 Key；TUI、CLI、MCP 與 0.37.0 範圍保持不變。
