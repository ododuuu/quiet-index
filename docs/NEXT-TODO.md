# Seekah 後續優化清單

- [x] 產品更名 Seekah；新舊 CLI 入口共用同一索引與設定，保留儲存／協定識別。
- [x] 核准 TUI 規格與互動稿存入 [design/](design/SEEKAH-TUI.md)，交接集中 [handoff/CURRENT.md](handoff/CURRENT.md)。
- [x] 在 0.36.1 落地核准的整體排版與完整焦點／鍵盤操作，不只增加 /select 或 /next；已以 80×24、120×40 render fixture 與真實 PTY 終端轉錄驗收。

更新：2026-09-24。0.36.1 為程式基線；當前優先依 SPEC §47 實作 0.36.2 GUI，0.37.0 暫緩。公司 Windows 未驗項保留。

## 當前優先：0.36.2 GUI

- [x] 使用者核准工作台設計；SPEC §47、D059 與固定交接完成。
- [ ] 正式三區 GUI、搜尋／分頁／選取、命中預覽、臨時文件與真實唯讀狀態。
- [ ] 連線設定、精確上下文、失效確認、複製／送出與實際回答。
- [ ] 正式瀏覽器尺寸／無障礙／安全驗收、完整回歸、升版與 GitHub 交付；詳見 handoff/0.36.2.md。

## 已完成：0.36.1 correctness／UX

- [x] 完整 scan、watch／local update 共用 exact Windows volume-root exclusions；相似名稱與巢狀普通目錄不誤排除。
- [x] scan 回報最小失敗 scope；不可讀 subtree 保留，正常 sibling 已刪文件移除；root failure 與 rebuild 保留既有資料。
- [x] `--profile` 保留 exclusive create／不建父目錄，錯誤提供安全 parent、code 與 CMD／PowerShell 範例。
- [x] TUI 建立 focus／cursor／key event 層，支援方向鍵、選取、預覽、翻頁、返回、focus 切換、q、Ctrl+C／EOF；slash fallback 與 context `yes` 保留。
- [x] README、STATUS、DECISIONS、HANDOFF 與 `0.36.1-VALIDATION.md` 已更新；package／lockfile 升至 0.36.1。
- [ ] 公司 Windows 以無機密測試樹驗證 sibling 權限失敗、系統目錄排除及 80×24／120×40 TUI；不得以本機 PTY 代替。

## 暫緩：0.37.0 performance／daily incremental

- [ ] 以正確 CMD／PowerShell profile 路徑取得 full reconciliation 的 enumerate、stat／compare、parser、compression／Bloom、write／commit 成本；相同資料至少三次，不以目前總耗時猜各階段比例。
- [ ] 驗證並產品化既有 `autoupdate`：啟動校正完成後，單檔新增／修改／刪除只走事件路徑或最小子樹，不掃 30 萬檔；status 顯示 daemon 健康、最近局部事件、上次／下次完整校正與降級原因。
- [ ] 明確文件化：`index` 是立即完整校正；`autoupdate start` 是已初次索引使用者的日常路徑。保留啟動、預設 6 小時、overflow／未知事件、ignore／roots 變更的完整校正安全網。
- [ ] 測停止 daemon 期間的新增／修改／刪除，確認下次 start 的完整校正補回。持久事件 queue 只能保護 daemon 已觀察的事件，不得宣稱能補未執行期間。
- [ ] 為 mixed long＋short `--all-terms` 建 benchmark；以所有 Bloom 可表示的必要長詞安全排除文件候選，候選文件仍全文精確核對。加入中英短詞、跨 block、舊／缺 Bloom、全部短詞與結果集合等價測試。
- [ ] 按 SPEC §46.7 建獨立本機工作狀態庫：queue 世代、commit 後 ack、冪等重播、10,000 路徑上限與 dirty scope 降級；測 crash、落盤失敗、新事件與舊 ack 競態。
- [ ] 拆分 root 直屬與子目錄 watcher scopes，handle 上限與粗 scope fallback；只對可定位的漏失做局部補掃，保留 Node 無法可靠回報 overflow 的安全網。
- [ ] 按 §46.8 實作 directory frontier／generation、可中斷分批校正、事件優先與公平排程，釋放批次間 writer lock；測掃描與事件交錯的安全刪除、離線 gap、重啟與失敗 sibling。
- [ ] `autoupdate startup enable|disable|status`：明確 opt-in 的目前使用者 Startup 捷徑，冪等／擁有權／路徑安全／政策拒絕；不得提權或安裝 Service。
- [ ] 更新 README、0.37.0 驗證文件與 Windows 普通帳號驗收流程；USN 已依 D056 移出本版，勿再研究或要求管理員。parser 分流不重做，Paperless managed library 不納入。

## P0：外部環境與真實資料證據

- [ ] 保留 0.36.0 已確認事實：舊索引沿用、文字升級只一次、約 299,530 未變更零 parse。後續回歸若破壞任一項即阻擋交付。
- [ ] 公司 Windows 驗證 0.31.0 背景更新、0.34.0 MCP App、0.35.0 localhost UI／拖曳／清理；不得以 macOS 測試代替。
- [ ] PDF／PPTX／XLS 真實錯誤只在公司電腦依 `COMPANY-WINDOWS-DIAGNOSTICS.md` 診斷，建立無機密最小重現後再修 parser。
- [ ] MSG_FORMAT_ERROR、OFFICE_MISSING_PART、PDF_CORRUPT、PDF_PARSE_ERROR、RTF_INVALID、TEXT_DECODE_ERROR、XLS_FORMAT_ERROR、XML_DECODE_ERROR、FILE_READ_FAILED 與固定 error retry policy 暫不併入 0.36.1／0.37.0。
- [ ] 若公司政策允許，用無機密合成文字實測 OpenAI／xAI API 的 model 權限、代理、速率限制、錯誤訊息與帳務；目前只有假 fetch 自動測試。

## P1：工作台實用性

- [ ] 串流顯示回答、取消進行中的 API 請求、明確 timeout／rate-limit 重試；仍不得自動重送可能計費的要求。
- [ ] Provider model 清單唯讀載入與能力篩選，避免手動 model id；失敗時保留手動輸入，不快取 Key。
- [ ] 可選系統 Keychain／Windows Credential Manager 整合；在完成前維持環境變數或 session memory，不用明文設定檔。
- [ ] 拖曳文件的段落／頁面／工作表細選、單檔文字預覽與去重，而不是只按文件整份依 256 KiB 截短。
- [ ] UI 增加副檔名／根目錄篩選、已選籃排序、鍵盤快速鍵、窄螢幕與螢幕閱讀器實機驗證。
- [ ] token／context 預估與 provider 上限提示；byte 上限仍是安全硬限制，不以估算取代。

## P2：隱私與部署選配

- [ ] 本機模型 provider（例如經核准的 Ollama／llama.cpp endpoint）需另定版本、健康檢查、模型能力與任意 URL／SSRF 邊界；不可直接開放自訂 URL。
- [ ] 若官方未來提供適合第三方桌面程式的 OpenAI／xAI OAuth，再另案實作 PKCE、callback、token storage 與撤銷；目前不做 cookie、密碼代登或假「訂閱登入」。
- [ ] Windows 全套安裝器與一般應用捷徑仍屬後續部署選配；目前使用者的可選登入啟動已納入 0.37.0 §46.9，不由 Web UI 自行註冊。
- [ ] OCR、圖片、資料夾拖曳與舊版 Office 新格式仍未納入；只有真實需求與安全 parser 方案明確時才排入，不無限擴格式。

## 明確不是缺陷

- ChatGPT Plus／Pro 與 OpenAI API 分開計費；SuperGrok／X Premium 與 xAI API 也分開。無法用消費訂閱額度不應以抓 cookie 或模擬登入規避。
- 工作台不保存對話、API Key 或拖曳內容是刻意的隱私設計；若日後要保存，必須先定義加密、刪除與公司資料治理。
- 0.35.0 不把本機 server 暴露至 LAN／Internet，也不讓任意 endpoint 代理請求；遠端 ChatGPT 網頁仍不會直接讀本機索引。
