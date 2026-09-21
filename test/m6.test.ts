import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, truncate } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import XLSX from "xlsx";
import { parseDocument, MAX_FILE_BYTES } from "../src/parser.js";
import { parseLegacy } from "../src/parsers/legacy.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search, parseTypes } from "../src/search.js";

// 合成最小 Word 97 OLE：UTF-16 piece table，無公司文件內容。
function docFile(encrypted = false): Buffer {
  const body = "中文採購契約\r第二段 Alpha 2026\r";
  const note = "註腳內容\r";
  const word = Buffer.alloc(4096);
  word.writeUInt16LE(0xa5ec, 0);
  word.writeUInt16LE(0x00c1, 2);
  word.writeUInt16LE(encrypted ? 0x0104 : 0x0004, 10);
  word.writeUInt32LE(1024, 0x18);
  word.writeUInt32LE(body.length, 0x4c);
  word.writeUInt32LE(note.length, 0x50);
  word.writeUInt32LE(21, 0x1a6);
  Buffer.from(body + note, "utf16le").copy(word, 1024);
  const table = Buffer.alloc(4096);
  table[0] = 2;
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(body.length + note.length, 9);
  table.writeUInt32LE(1024, 15);
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, "WordDocument", word);
  XLSX.CFB.utils.cfb_add(cfb, "0Table", table);
  return XLSX.CFB.write(cfb, { type: "buffer" }) as Buffer;
}

function xlsFile(): Buffer {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["採購明細", 1234.5], ["連結入口", true], [null, 3], [45292]]);
  sheet.B1!.z = "0.00";
  sheet.A4!.z = "yyyy-mm-dd";
  sheet.A2!.l = { Target: "https://example.invalid/legacy-link", Tooltip: "採購連結" };
  sheet.B3!.f = "1+2"; // 只讀快取的 3，不執行公式。
  XLSX.utils.book_append_sheet(book, sheet, "中文報價表");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["第二表內容"]]), "第二表");
  return XLSX.write(book, { type: "buffer", bookType: "biff8" }) as Buffer;
}

function mhtFile(encoding: "base64" | "quoted-printable", html = "<h1>網頁標題</h1><p>中文網頁契約 &amp; 條款</p><a href='https://example.invalid/mht-link'>入口</a>"): string {
  const bytes = Buffer.from(html);
  const encoded = encoding === "base64" ? bytes.toString("base64") : [...bytes].map(byte => `=${byte.toString(16).padStart(2, "0")}`).join("").replace(/(.{60})/g, "$1=\r\n");
  return `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="local-boundary"\r\n\r\n--local-boundary\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${encoded}\r\n--local-boundary\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="secret.txt"\r\n\r\nattachment-secret\r\n--local-boundary--\r\n`;
}

async function temporary(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-m6-中文 "));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("M6 DOC binary extracts Chinese body and footnotes with truthful locations", () => temporary(async directory => {
  const file = path.join(directory, "契約.doc");
  const original = docFile();
  await writeFile(file, original);
  const document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorMessage ?? "");
  assert.match(document.blocks[0]!.content, /中文採購契約/);
  assert.match(document.blocks[0]!.locationValue, /正文／擷取段落 1/);
  assert.ok(document.blocks.some(block => block.content.includes("註腳內容") && block.locationValue.includes("註腳")));
  assert.ok(document.blocks.every(block => block.locationKind !== "page"));
  assert.ok((await readFile(file)).equals(original));
}));

test("M6 XLS binary preserves Chinese cells, cached formulas, numbers and links", () => temporary(async directory => {
  const file = path.join(directory, "報價.xls");
  await writeFile(file, xlsFile());
  const document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorMessage ?? "");
  assert.equal(document.blocks[0]!.content, "採購明細");
  assert.equal(document.blocks[0]!.locationValue, "工作表「中文報價表」!A1");
  assert.equal(document.blocks[1]!.content, "1234.50");
  assert.ok(document.blocks.some(block => block.content === "2024-01-01"));
  assert.ok(document.blocks.some(block => block.content.includes("legacy-link") && block.locationValue.endsWith("!A2")));
  assert.ok(document.blocks.some(block => block.content === "3" && block.locationValue.endsWith("!B3")));
  assert.ok(document.blocks.some(block => block.content === "第二表內容"));
}));

test("M6 MHT decodes base64 and quoted-printable without indexing attachments", () => temporary(async directory => {
  for (const encoding of ["base64", "quoted-printable"] as const) {
    const file = path.join(directory, `${encoding}.mht`);
    await writeFile(file, mhtFile(encoding));
    const document = await parseDocument(file);
    assert.equal(document.status, "indexed", document.errorMessage ?? "");
    const text = document.blocks.map(block => block.content).join("\n");
    assert.match(text, /中文網頁契約 & 條款/);
    assert.match(text, /mht-link/);
    assert.doesNotMatch(text, /attachment-secret/);
  }
}));

test("M6 HTML decodes Big5 and entities and excludes scripts, styles and comments", () => temporary(async directory => {
  const file = path.join(directory, "舊網頁.htm");
  await writeFile(file, Buffer.concat([Buffer.from('<meta charset="big5"><h1>'), Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]), Buffer.from('</h1><p>ab<b>cd</b> &amp; ef</p><script>script-secret</script><style>style-secret</style><!--comment-secret--><a href="https://example.invalid/url-key">link</a>')]));
  const document = await parseDocument(file);
  const text = document.blocks.map(block => block.content).join("\n");
  assert.equal(document.status, "indexed");
  assert.match(text, /中文/);
  assert.match(text, /abcd & ef/);
  assert.match(text, /url-key/);
  assert.doesNotMatch(text, /secret/);
}));

test("M6 malformed, encrypted, no-text and over-limit formats retain filename search", () => temporary(async directory => {
  const store = new IndexStore(path.join(directory, "index.db"));
  try {
    await writeFile(path.join(directory, "加密.doc"), docFile(true));
    for (const type of ["doc", "xls", "mht"]) await writeFile(path.join(directory, `損壞.${type}`), "not this format");
    await writeFile(path.join(directory, "空白.html"), "<script>ignored</script>");
    await writeFile(path.join(directory, "過大.xls"), "");
    await truncate(path.join(directory, "過大.xls"), MAX_FILE_BYTES + 1);
    await writeFile(path.join(directory, "正常.adoc"), "= 標題\n\n採購正文\ninclude::does-not-exist[]");
    const report = await sync(directory, store);
    assert.equal(report.found, 7);
    assert.equal(search(store, "加密.doc")[0]?.status, "encrypted");
    assert.equal(search(store, "損壞").length, 3);
    assert.ok(search(store, "損壞").every(result => result.status === "error"));
    assert.equal(search(store, "空白.html")[0]?.status, "no_text");
    assert.equal(search(store, "過大.xls")[0]?.status, "too_large");
    assert.equal(search(store, "採購正文")[0]?.location, "第 3 行");
    assert.equal(search(store, "does-not-exist").length, 1);
  } finally { store.close(); }
}));

test("M6 added formats integrate with aliases, filters, unchanged indexing and CLI", () => temporary(async directory => {
  const root = path.join(directory, "來源");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(root);
  const db = path.join(directory, "index.db");
  const store = new IndexStore(db);
  try {
    for (const ext of ["html", "htm", "xhtml"]) await writeFile(path.join(root, `網頁.${ext}`), "<p>alias-key</p>");
    for (const ext of ["mht", "mhtml"]) await writeFile(path.join(root, `封存.${ext}`), mhtFile("base64", "<p>alias-key</p>"));
    await writeFile(path.join(root, "文件.DOC"), docFile());
    await writeFile(path.join(root, "資料.xls"), xlsFile());
    await writeFile(path.join(root, "說明.adoc"), "alias-key");
    const first = await sync(root, store);
    assert.equal(first.found, 8);
    assert.equal(store.counts().indexed, 8);
    assert.equal(search(store, "alias-key", 20, parseTypes(".MHTML,htm,ADOC")).length, 3);
    assert.equal((await sync(root, store)).parserCalls, 0);
    await writeFile(path.join(root, "網頁.htm"), "<p>updated-key</p>");
    await rm(path.join(root, "網頁.xhtml"));
    const changed = await sync(root, store);
    assert.equal(changed.parserCalls, 1);
    assert.equal(changed.removed, 1);
    assert.equal(search(store, "updated-key")[0]?.extension, ".htm");
  } finally { store.close(); }
  const cli = path.resolve("dist/src/cli.js");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(directory, "cli-data") };
  const indexed = spawnSync(process.execPath, [cli, "index", root], { env, encoding: "utf8" });
  assert.equal(indexed.status, 0, indexed.stderr);
  const found = spawnSync(process.execPath, [cli, "search", "中文採購契約", "--type", "doc"], { env, encoding: "utf8" });
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /文件.DOC/);
  assert.match(found.stdout, /正文／擷取段落/);
}));

test("M6 legacy worker can be terminated on deadline", async () => {
  await assert.rejects(parseLegacy(".doc", docFile(), 0), { code: "LEGACY_TIMEOUT" });
  assert.ok((await parseLegacy(".doc", docFile())).length > 0);
});


test("M6 XLS FILEPASS and MHTML legacy charset/plain text are handled", () => temporary(async directory => {
  const encrypted = path.join(directory, "保護.xls");
  // BIFF8 BOF + XOR FilePass：不提供密碼，不嘗試解密。
  await writeFile(encrypted, Buffer.from("0908100000060500bb0dcc0700000000060000002f0006000000000000000a000000", "hex"));
  const document = await parseDocument(encrypted);
  assert.equal(document.status, "encrypted", document.errorMessage ?? "");
  const mht = path.join(directory, "中文.mhtml");
  await writeFile(mht, 'MIME-Version: 1.0\r\nContent-Type: text/html; charset=big5\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>=A4=A4=A4=E5</p>');
  assert.equal((await parseDocument(mht)).blocks[0]?.content, "中文");
  await writeFile(mht, 'Content-Type: text/plain; charset=utf-8\r\n\r\n純文字備援');
  assert.equal((await parseDocument(mht)).blocks[0]?.content, "純文字備援");
}));
