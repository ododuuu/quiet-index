# Seekah 交接中心

所有版本交接固定放在這個資料夾，不再另外產生分散的 HANDOFF 檔。

- **永遠從 [CURRENT.md](CURRENT.md) 開始**：指出目前允許實作的版本。
- [0.36.1.md](0.36.1.md)：目前工作，correctness／UX 與核准的 Seekah TUI。
- [0.37.0.md](0.37.0.md)：後續背景更新與搜尋效能，尚未開工。
- [PROMPT.md](PROMPT.md)：可直接貼給下一個 AI 的開發指令。

先依 AGENTS.md 讀 SPEC、STATUS、DECISIONS，再讀 CURRENT 與其版本檔。SPEC 是行為權威，STATUS 是實際完成狀態；handoff 是執行順序，不得拿歷史成功結果冒充本版驗收。
每次交接更新 CURRENT 與版本文件的「已完成／未完成／驗證」，版本檔保留。原 docs/HANDOFF.md 僅作歷史與舊連結相容。
