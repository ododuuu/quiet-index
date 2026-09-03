# 跨對話交接方式

聊天紀錄不是專案的唯一依據；專案儲存庫內的文件與 Git 紀錄才是。

## 開始新對話

使用以下提示：

> 請接手 LocalDocSearch。先讀取根目錄 AGENTS.md，再依序讀 docs/SPEC.md、docs/STATUS.md、docs/DECISIONS.md、docs/HANDOFF.md；檢查 Git 狀態與測試結果後，只處理 STATUS 中的 active milestone。不要重新探索 RAG 或教材網站。

## 每次工作結束

1. 執行相關自動測試。
2. 在 `docs/STATUS.md` 記錄已完成、未完成、阻礙、測試結果與明確下一步。
3. 將產品或架構決策加入 `docs/DECISIONS.md`。
4. 每個 commit 僅處理一個明確範圍，並參考 `docs/STATUS.md` 的建議訊息。
5. 列出仍需使用者在 Windows 公司電腦完成的驗收項目。

## 資訊衝突時的優先順序

文件內容發生衝突時，依下列順序判斷：

1. 使用者最新且明確的決定。
2. `docs/SPEC.md` 已確認的產品行為。
3. `docs/DECISIONS.md` 已記錄的決策。
4. `docs/STATUS.md` 的實作狀態。
5. 現有程式碼與測試。

應修正發生衝突的文件，不可只依賴聊天記憶。
