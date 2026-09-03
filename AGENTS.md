# LocalDocSearch agent instructions

Before changing code, read these files in order:

1. `docs/SPEC.md`
2. `docs/STATUS.md`
3. `docs/DECISIONS.md`
4. `docs/HANDOFF.md`

## Working rules

- Treat this repository as the formal LocalDocSearch product; do not mix it with the learning website in the parent workspace.
- Preserve the agreed Node.js and TypeScript direction unless the user explicitly changes it.
- Keep all document processing local and do not upload document contents to external services.
- Do not add MCP, AI, embeddings, OCR, GUI, or legacy Office formats before the core CLI is stable.
- Do not silently change product behavior; record proposed behavior in `docs/SPEC.md` and decisions in `docs/DECISIONS.md`.
- Implement only the active milestone in `docs/STATUS.md`.
- Add or update automated tests for every behavior change.
- At the end of every work session, update `docs/STATUS.md` and add significant decisions to `docs/DECISIONS.md`.
- Never claim Windows validation was performed unless the user actually ran it on the company computer and reported the result.
