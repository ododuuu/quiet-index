# Seekah 0.36.1：核准的 TUI 設計

狀態：2026-09-23 使用者核准；本文件為實作契約，**不是已完成的 TUI**。
互動視覺參考：[seekah-tui.html](seekah-tui.html)。以瀏覽器本機開啟即可；它只有示範資料，不連接索引。
權威行為：[SPEC §45](../SPEC.md#45-0361windows-掃描正確性與-tui-可操作性修正)；交接：[0.36.1](../handoff/0.36.1.md)。

## 視覺方向

沿用使用者選定那版：OpenCode 式低噪音終端介面，石墨底色、灰階層級、青綠重點色、留白與底部固定搜尋列。不做滿版粗框線、彩虹狀態、巨大 ASCII logo 或每筆重複整條路徑。不是要求移植 OpenCode 程式碼或改用其 runtime。

- 頂列：`▌ seekah 0.36.1`，右側簡短 root／索引狀態。
- 中央：首頁、結果、文件預覽、已選文件、命令清單及確認畫面。
- 底部固定 composer：左側青綠細線，輸入行與模式／根目錄／格式摘要。
- 最下列：只列目前 focus 可用的快捷鍵；訊息不能覆蓋搜尋輸入。
- 游標列：`›`、青綠左側線及低對比底色；選取為獨立 `[x]`。游標移動不等於勾選。
- 結果三行：檔名＋格式／命中類型；淡色路徑＋定位；命中片段。避免原本「同一路徑重複三遍」。
- 全部資料皆來自真實查詢。HTML 的「背景監看中／部分範圍待確認」只是設計示範，不能硬編進程式或暗示 0.37.0 已存在。

深色參考：背景 #131416、面板 #1e2023、正文 #dddeda、次要 #9a9eaa、重點 #95d6d5、游標 #253336、警告 #dbb879。
淺色參考：背景 #f5f3ef、面板 #ebe8e2、正文 #272a2e、次要 #626970、重點 #226e78、游標 #dee8e6、警告 #86581c。
終端實作按能力降級到 ANSI 16 色；支援 NO_COLOR，不依賴顏色表達選取、錯誤或 focus。0.36.1 不要求主題設定持久化；終端背景未知時採預設終端底色與安全前景。HTML 的主題切換是比較工具。

## 畫面與操作

```text
 ▌ seekah 0.36.1                          本機索引 · D:\工作資料

 搜尋結果                               4 份 · 已選 1
 複製回本機 安裝                          全部關鍵字

 › [ ] CTM_CLIENT9.0.21安裝手冊.docx                 DOCX · 內容
       D:\工作資料\手冊                          第 2 段
       一、將檔案複製回本機進行安裝…

   [x] 安裝筆記.md                                   MD · 內容
       D:\工作資料\筆記                          第 8 行
       先複製回本機，再執行安裝。

 第 1 / 1 頁

 ▌ 搜尋 › 複製回本機 安裝
   全部關鍵字 · D:\工作資料 · 全部格式

 ↑↓ 移動  Space 選取  Enter 預覽  Tab 切換  / 搜尋  q 離開
```

1. 首頁：小型 seekah 字標、簡短用途、目前 roots／索引摘要，最近搜尋僅限本次 session，不偷偷落盤使用者查詢。
2. 搜尋：文字輸入收到一般字元；Enter 執行後 focus 結果首筆，空結果顯示下一步提示；錯誤保留 query。輸入 q、空白、斜線均為文字，不可變成全域快捷鍵。
3. 結果：↑↓ 移動，Space 勾選，Enter 預覽，PgUp／PgDn 翻頁；跨頁選取以穩定文件代碼保存，不用列號當 identity。翻頁先完成查詢再換頁，不偽造載入成功。
4. 預覽：頂部檔名與來源定位，中間有界文字，↑↓／PgUp／PgDn 捲動；Esc／← 回到原頁原游標。預覽不等於開啟檔案；open／reveal 保留明確動作與原有路徑安全驗證。
5. 已選文件：可移動、取消勾選，清楚顯示數量／既有上限；進 context 前仍走現有 prepare／驗證與字節上限，不更改選取契約。
6. context：展示即將複製的精確有界內容及大小；只有確認輸入 `yes` 才複製；Enter、Space、切換 focus 都不得替代確認。Esc 取消。
7. 命令清單：保留 /help 等現有 slash commands。非輸入區按 / 聚焦 composer；在 composer 輸入完整命令。命令與搜尋共用一個可理解入口，不新增互相衝突的快捷鍵。
8. Tab／Shift+Tab 循環搜尋輸入→結果→已選區（可顯示對應 view）；無已選文件時仍能進空清單並返回。預覽／確認有局部 focus 邊界，不讓背景操作穿透。
9. 非文字 focus 的 q 正常退出 0；文字 focus 使用 /quit；全程 Ctrl+C 退出 130，EOF 安全退出。無論錯誤、取消、正常退出均還原 raw mode、游標及 alternate screen。
10. 命令 fallback 保留。非 TTY 不啟用 raw／alternate screen，維持既有安全錯誤或 line-mode 契約；不可為了 fallback 允許無確認 context 複製。

## 尺寸、狀態與安全

- 至少 80×24／120×40 可用；按可用高度算結果數，保留頂列、composer 和 footer。窄高不足時用緊湊兩行結果／裁減次要資訊，不把互動提示推出畫面。
- 小於 60×16 顯示「請放大終端」及退出提示；不做負長度 slice／重畫迴圈。resize 保留 query、穩定游標 ID、勾選集合與 preview 返回位置，頁面必要時重新定位。
- 依 terminal cell width 截斷，不依 JS 字串 length；中文、emoji、組合字元及混合中英路徑不得切壞。超長檔名保留辨識前後段，完整路徑可在 preview 看到。
- 不可信檔名／片段的 ESC、控制字元不可直接送進 terminal；既有消毒必須保留。NO_COLOR 也要保持游標及勾選可辨識。
- 空庫／無結果／讀取失敗／SEARCH_INDEX_CHANGED／複製失敗各有可返回畫面；索引變更時提示重新搜尋，不悄悄選取另一份文件。
- 既有 autoupdate 可用 status 顯示真實狀態；查不到就顯示未知／未啟動，不為了亮綠燈自動啟動 daemon。0.37.0 的 queue、dirty scopes、新啟動功能不在本版。

## 結構與驗收

維持 Node.js＋TypeScript。將純 state reducer（focus、view、cursor ID、page、selection、query）與 key decoder、render、CLI terminal lifecycle 分離；不改 search/context domain 語意。來源重點為 src/tui.ts、src/cli.ts、src/terminal.ts（若存在則沿用）及既有 m32／m33／m36 tests。

必須交付：

- reducer 測試每個上述鍵、文字 focus 的 q／Space、空清單、跨頁選取、preview 回復、確認取消、query error 與索引更新。
- key decoder 測分段 escape sequence、方向鍵、PgUp／PgDn、Tab／Shift+Tab、Ctrl+C；中文輸入與貼上不能逐 byte 損壞。
- 80×24／120×40／極小尺寸、NO_COLOR 的 render fixtures；中文／emoji／惡意控制碼／長路徑；所有行 cell width 不超過 columns。
- 真實 PTY 測 raw mode、resize、EOF、正常退出與例外 finally 清理；另列公司 CMD／PowerShell／Windows Terminal 人工清單，不冒稱通過。
- 交付真實終端截圖或文字轉錄，對照此設計及 HTML；不是只交 /select／/next，也不是只更改顏色。
- 契約優先順序：SPEC 安全與行為 → 本設計文件 → HTML 示範。若發現衝突，先釐清並記錄決策，不自作主張降低安全。

參考來源（風格參考，不是新依賴）：[OpenCode TUI](https://opencode.ai/docs/tui/)、[主題](https://opencode.ai/docs/themes/)、[官方畫面](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/assets/lander/screenshot.png)。
