# 本機套件來源

`xlsx-0.20.3.tgz` 來自 [SheetJS 官方 Node.js 發行說明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)，下載網址為 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`。保存在發佈包中，讓 `npm ci` 不依賴此下載端點；其他依賴仍需 npm 快取或安裝時網路。

- 版本：0.20.3；授權：Apache-2.0，完整授權與 NOTICE 隨套件保存。
- SHA-256：`8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`。
- 本產品僅用於 XLS 讀取及 OLE 結構檢查；測試使用其 BIFF／CFB 寫入功能產生合成資料。

其他新增直接依賴：`word-extractor@1.0.4`（MIT）、`postal-mime@3.0.0`（MIT-0）、`htmlparser2@12.0.0`（MIT），依 `package-lock.json` 安裝；授權文件保存在各套件目錄。這些解析器不需要上傳文件，也不呼叫 Office 或外部轉檔程式。


M6-B 新增 `@kenjiuno/msgreader@1.28.0`（Apache-2.0）、`@kenjiuno/decompressrtf@0.1.4`（BSD-2-Clause）、`iconv-lite@0.6.3`（MIT）、`rtf-stream-parser@3.8.1`（MIT）。版本由鎖檔固定，授權文件保存在各安裝套件內。選用 3.8.1 的原因與解析前界限檢查見 D016。這些套件用於本機郵件解析，不連線 Outlook 或任何郵件服務。

## libvisio VSD v11 格式參考（M6-C 0.9.0）

`src/parsers/vsd-binary.ts` 的指標、chunk trailer 與 LZSS 解壓部分改寫自 LibreOffice/libvisio 的 `src/lib/VSDParser.cpp`、`VSDInternalStream.cpp`，識別簽章參考 `VisioDocument.cpp`。
來源：https://github.com/LibreOffice/libvisio ，固定 commit `f793b99ae50f9dc8cc14683eac0fdca619b13eaa`。
這些程式以 MPL-2.0 發佈；授權全文附於 `vendor/libvisio-MPL-2.0.txt`，本專案保留修改後 TypeScript 原始碼並隨發佈包提供。修改包含改用既有 CFB 容器、僅擷取直接文字、嚴格界限與資源限制、worker 隔離及搜尋區塊定位；不移植繪圖或 master／動態欄位解算。

`test/fixtures/libvisio-no-bgcolor.vsd` 取自同一版本 `src/test/data/no-bgcolor.vsd`，保留上游 MPL-2.0 授權，用於非合成檔案的回歸驗證。其預期字串是 `My hovercraft is full of eels.`。此為公開測試檔，不是公司文件。其他 VSD 測試資料由本專案產生。
