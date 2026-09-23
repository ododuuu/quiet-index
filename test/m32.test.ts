import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import iconv from "iconv-lite";
import { parseDocument } from "../src/parser.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { runTui } from "../src/tui.js";
import { productVersion } from "../src/version.js";

const zipped = (parts: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(parts)
  .map(([name, value]) => [name, typeof value === "string" ? strToU8(value) : value])));

const xlsm = zipped({
  "xl/workbook.xml": `<workbook><sheets><sheet name="巨集活頁簿" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>安全儲存格</t></is></c><c r="B1"><f>RUN()</f><v>42</v></c></row></sheetData></worksheet>`,
  "xl/vbaProject.bin": strToU8("macro-secret-must-not-index"),
});

const odt = zipped({
  "content.xml": `<office:document-content xmlns:office="urn:o" xmlns:text="urn:t" xmlns:table="urn:tb" xmlns:xlink="urn:x">
    <office:body><office:text><text:h>專案標題</text:h><text:p>中文段落 <text:a xlink:href="https://example.invalid/odt-key">入口</text:a></text:p>
    <text:list><text:list-item><text:p>清單內容</text:p></text:list-item></text:list>
    <table:table><table:table-row><table:table-cell><text:p>欄一</text:p></table:table-cell><table:table-cell><text:p>欄二</text:p></table:table-cell></table:table-row></table:table>
    </office:text></office:body></office:document-content>`,
  "META-INF/manifest.xml": `<manifest:manifest xmlns:manifest="urn:m"/>`,
});

test("0.32 parses XLSM without macro bytes and parses ODT structure", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m32-"));
  try {
    const book = path.join(temp, "安全.XLSM");
    const text = path.join(temp, "文件.odt");
    await writeFile(book, xlsm); await writeFile(text, odt);
    const workbook = await parseDocument(book);
    assert.equal(workbook.status, "indexed");
    assert.deepEqual(workbook.blocks.map(block => block.content), ["安全儲存格", "42"]);
    assert.doesNotMatch(workbook.blocks.map(block => block.content).join("\n"), /macro-secret/u);
    const document = await parseDocument(text);
    assert.equal(document.status, "indexed");
    const content = document.blocks.map(block => block.content).join("\n");
    assert.match(content, /專案標題/u); assert.match(content, /清單內容/u); assert.match(content, /欄一 \| 欄二/u);
    assert.match(content, /odt-key/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("0.32 marks encrypted ODT and rejects corrupt required content", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m32-"));
  try {
    const encrypted = path.join(temp, "加密.odt");
    await writeFile(encrypted, zipped({
      "content.xml": "<office:document-content/>",
      "META-INF/manifest.xml": `<manifest:manifest><manifest:file-entry><manifest:encryption-data/></manifest:file-entry></manifest:manifest>`,
    }));
    assert.equal((await parseDocument(encrypted)).status, "encrypted");
    const missing = path.join(temp, "缺少.odt");
    await writeFile(missing, zipped({ "META-INF/manifest.xml": "<manifest:manifest/>" }));
    const result = await parseDocument(missing);
    assert.equal(result.status, "error"); assert.equal(result.errorCode, "OFFICE_MISSING_PART");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("0.32 parses standalone RTF and excludes objects", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m32-"));
  try {
    const file = path.join(temp, "內容.rtf");
    await writeFile(file, Buffer.from(String.raw`{\rtf1\ansi\ansicpg950\uc1 \u20013?\u25991? RTF\par second line{\field{\*\fldinst HYPERLINK "https://example.invalid/rtf-key"}{\fldrslt 入口}}{\object object-secret}{\pict 616263}}`, "latin1"));
    const document = await parseDocument(file);
    assert.equal(document.status, "indexed");
    const content = document.blocks.map(block => block.content).join("\n");
    assert.match(content, /中文 RTF/u); assert.match(content, /second line/u);
    assert.match(content, /rtf-key/u);
    assert.doesNotMatch(content, /object-secret|616263/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("0.32 CSV keeps logical rows, quoted newlines, formulas as text and Big5", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m32-"));
  try {
    const utf8 = path.join(temp, "資料.csv");
    await writeFile(utf8, `名稱,說明,值\r\n"測試,一","跨\n行","=1+1"\r最後,一列,@命令`);
    const document = await parseDocument(utf8);
    assert.equal(document.status, "indexed"); assert.equal(document.blocks.length, 3);
    assert.equal(document.blocks[1]!.locationValue, "第 2 列（A–C）");
    assert.match(document.blocks[1]!.content, /跨\n行/u); assert.match(document.blocks[1]!.content, /=1\+1/u);
    const big5 = path.join(temp, "繁中.csv");
    await writeFile(big5, iconv.encode("欄位,內容\r\n一,繁體中文", "big5"));
    assert.match((await parseDocument(big5)).blocks[1]!.content, /繁體中文/u);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("0.32 formats flow through sync/search and TUI supports search/refine/status", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m32-"));
  const root = path.join(temp, "docs");
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    await mkdir(root);
    const csv = path.join(root, "資料.csv");
    await writeFile(csv, "名稱,內容\nA,共同字 特別字\nB,共同字");
    await writeFile(path.join(root, "活頁簿.xlsm"), xlsm);
    const info = await stat(csv);
    store.registerRoot(root);
    store.upsert({ path: csv, filename: "資料.csv", extension: ".csv", sizeBytes: info.size, modifiedAtMs: info.mtimeMs,
      status: "unsupported", errorCode: "UNSUPPORTED_EXTENSION", errorMessage: "舊版尚未支援", blocks: [] }, root);
    const report = await sync(root, store);
    assert.equal(report.found, 2); assert.equal(report.reprocessed, 1); assert.equal(store.counts().indexed, 2);
    assert.equal(search(store, "安全儲存格")[0]?.extension, ".xlsm");
    const answers: Array<string | null> = ["共同字", "/refine 特別字", "/status", "/quit"];
    const output: string[] = [];
    assert.equal(await runTui(store, { ansi: false, write: value => output.push(value), ask: async () => answers.shift() ?? null }, 1), 0);
    const rendered = output.join("\n");
    assert.match(rendered, new RegExp(`Seekah ${productVersion.replaceAll(".", "\\.")}`)); assert.match(rendered, /條件：共同字 → 特別字/u);
    assert.match(rendered, /索引狀態：/u);
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});
