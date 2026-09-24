# Seekah 交接中心

所有版本交接固定放在這個資料夾，不再另外產生分散的 HANDOFF 檔。

- **永遠從 [CURRENT.md](CURRENT.md) 開始**：指出目前允許實作的版本。
- [0.36.2.md](0.36.2.md)：當前優先，核准 GUI 工作台實作；SPEC 已完成，程式待實作。
- [0.36.1.md](0.36.1.md)：已完成的程式基線與公司 Windows 待驗紀錄。
- [0.37.0.md](0.37.0.md)：背景更新與搜尋效能，暫緩、尚未開工。
- [PROMPT.md](PROMPT.md)：給 Luna Max 的實作指令；不表示本工作階段已切換模型。

先依 AGENTS.md 讀 SPEC、STATUS、DECISIONS，再讀 CURRENT 與其版本檔。SPEC 是行為權威，STATUS 是實際完成狀態；handoff 是執行順序，不得拿歷史成功結果冒充本版驗收。

**每次功能或行為改動都必須檢視 [USER-GUIDE.md](../USER-GUIDE.md)**：只修改受影響的啟動、操作、限制、排錯或隱私段落，保持它是單一當前手冊；不要建立按版本累積的使用教學。交接的 CURRENT／版本檔只記錄「已檢視並更新」及變更範圍、驗證或未驗證限制。

每次交接更新 CURRENT 與版本文件的「已完成／未完成／驗證」，版本檔保留。原 docs/HANDOFF.md 僅作歷史與舊連結相容。
