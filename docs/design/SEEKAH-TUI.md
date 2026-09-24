# Seekah 0.36.2：Claude Code 式單欄 TUI 契約

狀態：2026-09-24 核准並實作。本文件是 `src/tui.ts` 的視覺與互動契約；[seekah-tui.html](seekah-tui.html) 只供外觀審閱，使用示範資料且不連接索引。
權威行為：[SPEC §45](../SPEC.md#45-0361windows-掃描正確性與-tui-可操作性修正)。搜尋、選取、context、open／reveal、TTY 與退出安全仍以 SPEC 為準。

## 視覺方向

採 Claude Code 風格的資訊階層：單欄時間序 transcript、低噪音工具結果、底部固定 composer。只借用資訊排列方式，不整合 Claude Code 程式碼、服務、帳號、模型或 AI 功能。

- 頂列只有 `seekah <version>`、真實文件／root 摘要與已選數；不使用 tab 或首頁導覽列。
- 中央依時間排列使用者查詢、真實搜尋摘要、選取與 context 結果。目前結果或其他 view 是同一 transcript 內的 block，不是另一個儀表板。
- 使用者 prompt 右縮排；搜尋、選取、context 與 notice 靠左，以文字標籤說明種類。
- 結果每筆固定三行：檔名與 extension／reason、`[x]` 與路徑、location 與 snippet。active card 使用 `›` 與低對比 surface；游標與選取是兩個獨立狀態。
- 底部固定兩行 composer：`› 搜尋 › <input>` 或 `› 確認 › <input>`；第二行顯示真實 mode、root 與目前 focus 可用按鍵。狀態／錯誤另佔一行，不得覆蓋輸入。
- context 只顯示實際 `prepareSelectedContext()` 預覽與 UTF-8 bytes，明示只有完整 `yes` 可複製、尚未傳送；不得模仿 agent 回答或已送出訊息。

終端色盤：graphite `#1f1f23`、panel `#27272a`、text `#e8e6e3`、muted `#a1a1aa`、accent `#8ab4f8`、warning `#d8a657`。24-bit 終端依此輸出；16 色降級仍保留 `›`、`[x]`、種類標籤與警告文字。`NO_COLOR` 不輸出 ANSI，所有狀態仍可辨識。

## 80×24 參考

```text
  seekah 0.36.2 · 12 份文件 · D:\工作資料 · 已選 1

      › 複製回本機 安裝
        全部關鍵字

  ◆ 搜尋  找到 4 份文件
    └ 全部關鍵字 · 真實索引結果

  ◆ 搜尋結果                                      4 份文件
    複製回本機 安裝 · 全部關鍵字 · 第 1/1 頁
  › CTM_CLIENT9.0.21安裝手冊.docx          DOCX · 內容
    [ ] D:\工作資料\手冊\CTM_CLIENT9.0.21安裝手冊.docx
      第 2 段 · 將檔案複製回本機進行安裝…
    安裝筆記.md                                  MD · 內容
    [x] D:\工作資料\筆記\安裝筆記.md
      第 8 行 · 先複製回本機，再執行安裝。

  ◆ 選取  已選取 安裝筆記.md
    └ 目前已選 1 份

  ↑↓ 移動、Space 選取、Enter 預覽、PgUp/PgDn 翻頁。
  › 搜尋 › 複製回本機 安裝
  全部關鍵字 · D:\工作資料 · ↑↓ · Space · Enter · PgUp/PgDn · Tab · q
```

120×40 使用同一結構，顯示更多較舊 workflow entries 與 result cards。80×24 空間不足時按最舊到最新裁掉完整舊 block，必須保留目前 view、最新 workflow、狀態與 composer；不得以虛構折疊數取代真實資料。

## Session workflow model

`runTui()` 持有最多 12 筆記憶體內 workflow entries：

```ts
{ kind: "prompt" | "search" | "selection" | "context" | "notice"; text: string; detail?: string }
```

- `SearchSession` 成功建立並取得結果後，才加入 prompt 與 search；摘要使用 `originalTotal`，mode 使用實際 phrase／all-terms。
- 成功加入選取後記錄 basename 與目前已選數；取消選取不冒充成功加入。
- `prepareSelectedContext()` 成功後才記錄文件數、實際 passage 數與 `Buffer.byteLength(..., "utf8")`。
- 「正在搜尋」、尚未完成、失敗或取消不得寫成成功紀錄。notice 只用於需要留在 transcript 的可辨識 UI 狀態。
- 超過 12 筆移除最舊項目。`SEARCH_INDEX_CHANGED` 清除過期 session 與 workflow。
- workflow、query、結果、路徑、選取及任何 view state 都不得落盤；退出 TUI 即消失。

## View 與 focus

1. **搜尋結果**：目前 cards 緊接在最新 search block 後；`state.cursor` 決定唯一 active `›`。↑↓ 移動，Space 切換選取，Enter 預覽，PgUp／PgDn 翻頁。
2. **文件預覽**：以 transcript block 顯示檔名、真實路徑、extension／location、snippet、reason 與文件代碼；這不等於 open。Esc／← 回原頁原游標。
3. **已選文件**：顯示穩定 reference 對應項目，可移動、取消與預覽。跨頁／查詢選取、20 份上限與 mixed-mode 拒絕不變。
4. **Context**：逐頁顯示完整精確 Markdown；顯示頁次與 bytes。只有完整 `yes` 才呼叫剪貼簿；其他輸入或 Esc 取消且不複製。
5. **Help／commands／roots／status**：保留既有 view、內容、分頁與返回語意，以標題、真實內容、頁次組成 transcript block。status 不捏造 daemon 或 0.37.0 queue 狀態。
6. **Focus**：Tab／Shift+Tab 循環 input→results→selected。文字 focus 的 q、Space、`/` 是輸入；非文字 focus 的 q 離開。`/`、既有 slash commands、open／reveal 與 fallback 行為不變。

## 尺寸、安全與 lifecycle

- 80×24 至少顯示 header、一個 workflow block、目前結果／view 主體、狀態與 composer；120×40 顯示完整 fixture workflow 及更多 cards。
- 小於 60×16 顯示「請放大終端」、可用 composer、`/help`、`/quit` 與 Ctrl+C 提示；不得崩潰或進入重畫迴圈。
- header 在 80 欄以下先移除 root，再移除文件數，始終保留產品名稱與已選數。
- 所有行依 terminal cell width 裁切，絕不依 JavaScript `string.length`。必須沿用 `displayWidth()`、`clipWidth()`、`sanitizeTerminal()`／`terminalText()`；檔名、路徑、snippet、root、message 與 workflow text 的控制字元不可到達終端。
- resize 保留 query、focus、cursor、selection、preview 返回位置與 workflow，重新計算可見 page size。
- 不改 `TuiEvent`、decoder、reducer、80 ms Esc、raw mode、alternate screen、SIGINT／SIGTERM、EOF 或 finally cleanup。正常 q／quit／EOF 為 0，Ctrl+C 為 130，SIGTERM 為 143。
- 不改 `SearchSession`、`prepareSelectedContext()`、`actOnDocument()`、read-only store 或剪貼簿確認；TUI 不新增網路、LLM、agent、provider、daemon 或持久狀態。

## 驗收

- renderer fixture 含 prompt／search／selection／context 與兩筆 CJK／長 Windows path 結果；120×40 依輸入順序全顯示，80×24 裁掉最舊 block 且保留最新 context 與 results。
- 驗證 header、fixed composer、真實 search total、active `›`、selected `[x]`、精確 context bytes、only-yes 文案、頁次與目前 focus hints。
- 24-bit、16 色及 `NO_COLOR` 每行 cell width 不超過 columns；惡意 ESC、C0／C1 與 bidi control 不得原樣出現。
- 保留 reducer、decoder、resize、CJK、interaction、explicit `yes`、取消不複製、single-copy 與 Unix PTY cleanup 測試。
- 以隔離索引在真實 80×24 ANSI terminal 操作搜尋、選取、預覽、context、取消／確認與退出；另以 `NO_COLOR=1` 驗證無 ANSI 且 focus／selection 可辨識。Windows Terminal 只有使用者實機回報後才能標示通過。
