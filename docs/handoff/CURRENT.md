# 目前交接：Seekah 0.36.1 驗收

更新：2026-09-23。

**0.36.1 本機實作已完成；目前只接受驗收、缺陷修正與交付核對，不要提前實作 0.37.0。**

package／lockfile 已為 0.36.1。Windows volume-root 系統目錄排除、scope-aware deletion、profile 錯誤提示及核准的新 TUI 均已落地；舊 LocalDocSearch 索引路徑、`LOCALDOCSEARCH_DATA_DIR`、`.localdocsearchignore`、IPC／MCP 識別與 `docsearch` 入口保持相容，不需 rebuild。

設計權威：[SEEKAH-TUI.md](../design/SEEKAH-TUI.md)；視覺參考：[seekah-tui.html](../design/seekah-tui.html)；實作與驗證：[0.36.1.md](0.36.1.md)、[0.36.1-VALIDATION.md](../0.36.1-VALIDATION.md)。

公司 Windows 的 0.36.1 人工驗收尚未進行。下一個 AI 應先讀 [SPEC §45](../SPEC.md#45-0361windows-掃描正確性與-tui-可操作性修正)、[STATUS](../STATUS.md)、[DECISIONS](../DECISIONS.md) D054／D057，再依版本交接執行無機密 Windows 測試；不得把 macOS／PTY 結果宣稱為公司 Windows 通過。

固定交接中心：[README.md](README.md)。0.37.0 僅保留在既有規格／版本交接中，不屬目前可實作範圍。
