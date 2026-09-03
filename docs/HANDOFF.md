# Cross-conversation handoff

Chat history is not the source of truth. The repository is.

## Start a new conversation

Use this prompt:

> 請接手 LocalDocSearch。先讀取根目錄 AGENTS.md，再依序讀 docs/SPEC.md、docs/STATUS.md、docs/DECISIONS.md、docs/HANDOFF.md；檢查 Git 狀態與測試結果後，只處理 STATUS 中的 active milestone。不要重新探索 RAG 或教材網站。

## End every work session

1. Run the relevant automated tests.
2. Update `docs/STATUS.md` with completed work, unfinished work, blockers, test results, and the exact next task.
3. Add any product or architecture decision to `docs/DECISIONS.md`.
4. Keep each commit focused and use the suggested commit message in `docs/STATUS.md`.
5. List any Windows checks that still require the user.

## Source-of-truth order

When documents conflict, use this order:

1. The user's latest explicit decision.
2. `docs/SPEC.md` accepted behavior.
3. `docs/DECISIONS.md` recorded decisions.
4. `docs/STATUS.md` implementation status.
5. Existing code and tests.

Update the conflicting document rather than relying on chat memory.
