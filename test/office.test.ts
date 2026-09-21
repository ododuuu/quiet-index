import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseDocument } from "../src/parser.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";

function officeZip(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
}

const docx = officeZip({
  "word/document.xml": `<w:document><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>專案決策</w:t></w:r></w:p>
    <w:p><w:r><w:t>中文段落</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="rIdHyper"><w:r><w:t>合約入口</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:fldSimple w:instr='HYPERLINK "file:///C:/Guides/field-key.docx"'><w:r><w:t>操作手冊</w:t></w:r></w:fldSimple></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格內容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`,
  "word/_rels/document.xml.rels": `<Relationships><Relationship Id="rIdHyper" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/contracts/alpha-key" TargetMode="External"/></Relationships>`,
});

const docxWithOtherLinks = officeZip({
  "word/document.xml": `<w:document><w:body>
    <w:p><w:r><w:t>圖形入口</w:t></w:r><w:drawing><a:hlinkClick r:id="rIdDrawing"/></w:drawing></w:p>
    <w:p><w:r><w:instrText>HYPERLINK "file:///C:/Project/</w:instrText></w:r><w:r><w:instrText>split-field-key.docx"</w:instrText></w:r><w:r><w:t>檔案位置</w:t></w:r></w:p>
  </w:body></w:document>`,
  "word/_rels/document.xml.rels": `<Relationships>
    <Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/drawing/drawing-url-key" TargetMode="External"/>
    <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/should-not-index" TargetMode="External"/>
  </Relationships>`,
  "word/header1.xml": `<w:hdr><w:p><w:hyperlink r:id="rIdHeader"><w:r><w:t>頁首入口</w:t></w:r></w:hyperlink></w:p></w:hdr>`,
  "word/_rels/header1.xml.rels": `<Relationships><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/header/header-url-key" TargetMode="External"/></Relationships>`,
});

const pptx = officeZip({
  "ppt/presentation.xml": `<p:presentation><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>`,
  "ppt/slides/slide1.xml": `<p:sld><p:sp><a:p><a:r><a:t>第二頁文字</a:t></a:r></a:p></p:sp></p:sld>`,
  "ppt/slides/slide2.xml": `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><a:p><a:r><a:t>第一頁標題</a:t></a:r></a:p></p:sp></p:sld>`,
  "ppt/slides/_rels/slide2.xml.rels": `<Relationships><Relationship Id="rId3" Target="../notesSlides/notesSlide2.xml"/></Relationships>`,
  "ppt/notesSlides/notesSlide2.xml": `<p:notes><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><a:p><a:r><a:t>講者備註中文</a:t></a:r></a:p></p:sp></p:notes>`,
});

const xlsx = officeZip({
  "xl/workbook.xml": `<workbook><sheets><sheet name="資料表" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>共享中文</t></si><si><r><t>多</t></r><r><t>段文字</t></r></si></sst>`,
  "xl/styles.xml": `<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>&#x5167;&#x5d4c;&#x6587;&#x5b57;</t></is></c><c r="C1" t="b"><v>1</v></c><c r="D1" s="1"><v>45292</v></c><c r="E1" t="s"><v>1</v></c><c r="F1" t="inlineStr"><is><t>連結顯示</t></is></c></row></sheetData><hyperlinks><hyperlink ref="F1" r:id="rIdHyper" tooltip="試算表連結提示"/></hyperlinks></worksheet>`,
  "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Id="rIdHyper" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/sheets/xlsx-link-key" TargetMode="External"/></Relationships>`,
});

test("DOCX extracts headings, paragraphs and table cells", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-office-"));
  try {
    const file = path.join(directory, "報告.docx");
    await writeFile(file, docx);
    const document = await parseDocument(file);
    assert.equal(document.status, "indexed");
    assert.equal(document.blocks.length, 5);
    assert.equal(document.blocks[1]?.heading, "專案決策");
    assert.match(document.blocks[2]!.content, /alpha-key/);
    assert.match(document.blocks[3]!.content, /field-key/);
    assert.match(document.blocks[4]!.locationValue, /表格 1/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("DOCX searches drawing and header hyperlink URLs and split field URLs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-office-links-"));
  const store = new IndexStore(path.join(directory, "index.db"));
  try {
    await writeFile(path.join(directory, "連結.docx"), docxWithOtherLinks);
    const report = await sync(directory, store);
    assert.equal(report.found, 1);
    assert.equal(store.counts().indexed, 1);
    assert.equal(search(store, "drawing-url-key")[0]?.extension, ".docx");
    assert.equal(search(store, "header-url-key")[0]?.extension, ".docx");
    assert.equal(search(store, "split-field-key")[0]?.extension, ".docx");
    assert.equal(search(store, "should-not-index").length, 0);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("PPTX uses presentation order and extracts speaker notes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-office-"));
  try {
    const file = path.join(directory, "簡報.pptx");
    await writeFile(file, pptx);
    const document = await parseDocument(file);
    assert.equal(document.status, "indexed");
    assert.match(document.blocks[0]!.content, /第一頁標題/);
    assert.equal(document.blocks[0]!.locationValue, "投影片 1");
    assert.match(document.blocks[1]!.content, /講者備註中文/);
    assert.equal(document.blocks[2]!.locationValue, "投影片 2");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("XLSX extracts shared, inline, boolean and date cells", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-office-"));
  try {
    const file = path.join(directory, "試算表.xlsx");
    await writeFile(file, xlsx);
    const document = await parseDocument(file);
    assert.equal(document.status, "indexed");
    assert.deepEqual(document.blocks.map(block => block.content), ["共享中文", "內嵌文字", "TRUE", "2024-01-01", "多段文字", "連結顯示\nhttps://example.com/sheets/xlsx-link-key\n試算表連結提示"]);
    assert.equal(document.blocks[0]!.locationValue, "工作表「資料表」!A1");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Office documents flow through indexing and corrupt files do not stop others", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-office-"));
  const store = new IndexStore(path.join(os.tmpdir(), `lds-office-${process.pid}-${Date.now()}.db`));
  try {
    await writeFile(path.join(directory, "報告.docx"), docx);
    await writeFile(path.join(directory, "簡報.pptx"), pptx);
    await writeFile(path.join(directory, "試算表.xlsx"), xlsx);
    await writeFile(path.join(directory, "損壞.docx"), "不是 ZIP");
    const report = await sync(directory, store);
    assert.equal(report.found, 4);
    assert.equal(store.counts().indexed, 3);
    assert.equal(store.counts().error, 1);
    assert.equal(search(store, "表格內容")[0]!.extension, ".docx");
    assert.equal(search(store, "alpha-key")[0]!.extension, ".docx");
    assert.equal(search(store, "field-key")[0]!.extension, ".docx");
    assert.equal(search(store, "講者備註中文")[0]!.location, "投影片 1（講者備註）");
    assert.equal(search(store, "共享中文")[0]!.location, "工作表「資料表」!A1");
    assert.equal(search(store, "xlsx-link-key")[0]!.location, "工作表「資料表」!F1");
    assert.equal(search(store, "損壞.docx")[0]!.rank, 4);
  } finally {
    const databasePath = store.databasePath;
    store.close();
    await rm(databasePath, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
