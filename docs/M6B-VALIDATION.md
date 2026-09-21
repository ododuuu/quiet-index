# M6-B 驗證與公司 Windows 驗收

日期：2026-09-16；版本：0.7.0。使用者要求接續下一版，依盤點中的 295 份 MSG 優先實作郵件搜尋。這是格式數量，不表示全部檔案都可成功解析。

## 本批成果與範圍

| 可搜尋內容 | 結果位置 |
|---|---|
| 主旨（使用既有標題排名） | 郵件主旨 |
| 寄件者名稱、原始地址及 SMTP 地址 | 郵件寄件者 |
| To／Cc／Bcc 的名稱及地址 | 郵件收件者／副本／密件副本 |
| HTML 文字與連結目標 | 郵件正文（HTML）／段落 |
| 純文字正文 | 郵件正文（純文字）／段落 |
| 壓縮 RTF 還原文字或 HTML | 郵件正文（RTF／RTF→HTML）／段落 |

只取一種可讀正文表示：HTML 優先，無可用 HTML 時用純文字，再用 RTF。支援 Unicode、宣告字碼頁的 ANSI（含 Big5），無宣告 ANSI 預設 Windows-1252。未知編碼且無可讀備援時回報錯誤，不套用本機語系。

附件名稱、附件內容及附加郵件不納入；不讀取 PST／OST、不連線 Outlook 或 Exchange，不載入 HTML 外部圖片，不執行腳本。不提供 S/MIME 解密／簽章驗證，這些郵件明確報錯並保留檔名。行事曆、聯絡人等非郵件 MSG 項目不在本版範圍。

一般 RTF 使用文字模式，排除圖片 hex、物件及中繼資料；不保證表格版式或所有特殊欄位與 Outlook 完全一致。只有通訊欄位、沒有正文的郵件仍可 indexed；完全空白的郵件為 no_text。存在正文但唯一表示解析失敗時列 error，不把主旨當成完整全文索引成果。

## 可靠性與依賴

- 單檔沿用 100 MiB 上限；超過時保留檔名，不讀取內容。
- MSG 使用獨立 worker，30 秒期限及 512 MiB V8 old-generation heap 上限（不是整個程序 RSS 硬上限）。DOC／XLS 複用同一 worker 管理程式，既有錯誤代碼及行為保留。
- RTF 壓縮資料、宣告／實際解壓長度及文字輸出各限 20 MiB；驗證 LZFu CRC、長度及 bin 參數。超限或損壞不留下半份正文。
- MSG 解析器只接收根層及收件者必要資料，不遞迴解析附件；worker 只傳出固定錯誤代碼，避免解析例外含有正文。
- 鎖定 `@kenjiuno/msgreader@1.28.0`、`@kenjiuno/decompressrtf@0.1.4`、`iconv-lite@0.6.3`、`rtf-stream-parser@3.8.1`。選版、授權及 RTF feature hook 的理由見 D016 與 `vendor/README.md`。

## 本機驗證

- macOS arm64、Node.js 26.7.0：嚴格 TypeScript 編譯及 `npm test`，53 項通過，0 失敗／略過。
- macOS arm64、Node.js 22.17.0：以官方發行包執行編譯及完整 53 項測試，同樣通過；下載包已核對官方 SHA-256。
- 新增 11 項 MSG 測試，包括中文、Big5、收件者類別、HTML 實體／連結／腳本排除、RTF Unicode／LZFu／MELA／HTML 封裝／CRC、附件與附加郵件隔離、空白／主旨限定／損壞／S/MIME／非郵件項目、逾時、100 MiB／20 MiB 邊界、增量及獨立 CLI。
- 合成資料由 `test/fixtures/msg.ts` 產生 OLE／MAPI streams，RTF literal-only LZFu 編碼器與正式解壓器獨立。沒有公司文件；尚未保證所有 Outlook 匯出變體或所有實際文件都成功。
- `npm run demo:msg` 使用四封合成郵件，核對主旨、通訊欄位、HTML／RTF／Big5 正文、未變更零解析與修改後更新。完成後自動清除暫存資料。
- 既有 M5 效能數字不代表這批格式效能。53 項測試和 Node.js 版本相容性也不能代替公司 Windows 驗收。

## 公司 Windows 安裝與驗收

發佈包共有 92 個檔案，逐一與工作檔核對並附 `.sha256`。已在乾淨暫存目錄，以 macOS Node.js 22.17.0 從本機快取執行 `npm ci --offline --ignore-scripts`，35 個套件安裝成功；重新編譯、全部 53 項測試與 MSG Demo 再次通過。發佈包包含原始碼、編譯產物、測試與文件，不含 node_modules；安裝需有可取得的套件或 npm 快取。

解壓 `LocalDocSearch-M6B-2026-09-16.zip`，切換至其中的 LocalDocSearch 目錄，在 CMD 執行：

```cmd
node --version
npm.cmd ci
npm.cmd test
npm.cmd run demo:msg
node dist/src/cli.js index "原本的資料夾完整路徑" --verbose
node dist/src/cli.js search "已知的郵件內文" --type msg
node dist/src/cli.js search "寄件者或收件者地址" --type msg
node dist/src/cli.js status
```

將路徑、查詢詞與地址換成實際值。重新 index 就會加入先前略過的 MSG，不需刪除資料庫或重建所有格式。未變更 error 郵件會依原政策重試；沒有 error 且未修改文件時再次 index 應為零解析。

請在公司電腦核對中文主旨、正文與 To／Cc／Bcc 位置；盡量使用「檔名沒有，內文才有」的關鍵字。回報 Node.js／Windows 版本、測試結果、索引摘要及失敗代碼即可，不需上傳公司郵件。M5／M6-A 未回報的驗收紀錄仍保留。

| 代碼 | 意義 |
|---|---|
| MSG_FORMAT_ERROR | 不是有效 MSG OLE 結構，或缺少必要資料 |
| MSG_ITEM_UNSUPPORTED | 行事曆／聯絡人等非支援郵件類別 |
| MSG_SMIME_UNSUPPORTED | S/MIME 簽章或加密資料，未解密或驗章 |
| MSG_ENCODING_UNSUPPORTED | 宣告的編碼無法識別 |
| MSG_RTF_INVALID／MSG_RTF_LIMIT | RTF 校驗、結構或大小限制問題 |
| MSG_TIMEOUT／MSG_WORKER_ERROR | 超過期限或 worker 失敗 |
| MSG_PARSE_ERROR | 其他解析錯誤；仍可搜尋檔名 |

下一版 M6-C 先驗證 VSD 的純本機擷取與部署可行性，目前尚未支援 VSD。
