# LocalDocSearch 後續優化清單

更新：2026-09-23。此清單以 0.35.0 為基準；已完成搜尋核心、格式解析、背景更新、TUI、MCP／MCP App，以及第一版本機拖曳工作台。

## 當前優先：0.36.0 索引增量／效能與 TUI 修正

使用者已回報 0.35.0 使用問題；本機已重現 TUI Ctrl+C／EOF 退出缺陷，公司索引慢速根因仍待量測。唯一 active milestone 為 [SPEC §44](SPEC.md#44-0360-索引增量效能與-tui-可用性修正)，由 Grok 依 HANDOFF 首節實作。下列其他擴充暫排後；本次規格完成不代表修復完成。

- [ ] 沿用既有資料庫，區分一次性文字升級／新格式／錯誤重試／未變更，已完成成功文件重跑零解析。
- [ ] 階段計時與匿名本機 profile、大型舊庫替換基線、按實測修正 SQL／壓縮等熱點並核對內容完整性。
- [ ] TUI 退出生命週期與真實 PTY 回歸，help 容錯／補全、固定輸入列、可翻頁預覽與中文視窗適配。
- [ ] 0.36.0 本機回歸／效能報告／交付包，以及公司 Windows 增量與 TUI 複驗。

## P0：外部環境與真實資料證據

- [ ] 公司 Windows 驗證 0.31.0 背景更新、0.34.0 MCP App、0.35.0 localhost UI／拖曳／清理；不得以 macOS 測試代替。
- [ ] PDF／PPTX／XLS 真實錯誤只在公司電腦依 `COMPANY-WINDOWS-DIAGNOSTICS.md` 診斷，建立無機密最小重現後再修 parser。
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
- [ ] Windows 安裝器、捷徑與開機啟動屬部署選配；需先證明免管理員可行與企業端點政策，不由 Web UI 自行安裝。
- [ ] OCR、圖片、資料夾拖曳與舊版 Office 新格式仍未納入；只有真實需求與安全 parser 方案明確時才排入，不無限擴格式。

## 明確不是缺陷

- ChatGPT Plus／Pro 與 OpenAI API 分開計費；SuperGrok／X Premium 與 xAI API 也分開。無法用消費訂閱額度不應以抓 cookie 或模擬登入規避。
- 工作台不保存對話、API Key 或拖曳內容是刻意的隱私設計；若日後要保存，必須先定義加密、刪除與公司資料治理。
- 0.35.0 不把本機 server 暴露至 LAN／Internet，也不讓任意 endpoint 代理請求；遠端 ChatGPT 網頁仍不會直接讀本機索引。
