# M10 0.13.0 驗證

本版擴充 `context`：多段命中與 Markdown 匯出。不連線 AI。

## 本機

2026-09-17 macOS：`npm test` 91 通過、0 失敗、1 略過。

```powershell
node dist/src/cli.js context "關鍵字" --format md --passages 5 --out "$env:USERPROFILE\Desktop\ctx.md"
```

確認預覽含多段、`yes` 後寫入，未選文件不出現。
