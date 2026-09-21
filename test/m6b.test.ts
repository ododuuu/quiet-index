import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile, mkdir, truncate } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import iconv from "iconv-lite";
import XLSX from "xlsx";
import { makeMsg, wrapRtf } from "./fixtures/msg.js";
import { parseDocument, MAX_FILE_BYTES } from "../src/parser.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search, parseTypes } from "../src/search.js";
import { parseInWorker } from "../src/parsers/worker.js";

async function temporary(run: (dir: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-m6b-中文 "));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("M6-B indexes Unicode subject, sender and To/Cc/Bcc separately from body", () => temporary(async dir => {
  const file = path.join(dir, "郵件.MSG");
  const bytes = makeMsg({ subject: "年度採購決議", body: "第一段正文\r\n第二段關鍵字", sender: "採購窗口", senderAddress: "/O=EXCHANGE/CN=sender", senderSmtp: "sender@example.invalid",
    recipients: [{ name: "收件甲", address: "a@example.invalid", type: 1 }, { name: "副本乙", address: "b@example.invalid", type: 2 }, { name: "密件丙", address: "/O=EXCHANGE/CN=hidden", smtp: "c@example.invalid", type: 3 }] });
  await writeFile(file, bytes);
  const document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorCode ?? "");
  assert.equal(document.blocks[0]?.heading, "年度採購決議");
  assert.equal(document.blocks[0]?.locationValue, "郵件主旨");
  assert.ok(document.blocks.some(block => block.content.includes("sender@example.invalid") && block.content.includes("/O=EXCHANGE") && block.locationValue === "郵件寄件者"));
  assert.ok(document.blocks.some(block => block.content.includes("副本乙") && block.locationValue.startsWith("郵件副本")));
  assert.ok(document.blocks.some(block => block.content.includes("c@example.invalid") && block.locationValue.startsWith("郵件密件副本")));
  assert.equal(document.blocks.at(-1)?.locationValue, "郵件正文（純文字）／段落 2");
  assert.ok((await readFile(file)).equals(bytes));
}));

test("M6-B prefers HTML body, decodes entities/links and isolates attachments", () => temporary(async dir => {
  const file = path.join(dir, "網頁.msg");
  await writeFile(file, makeMsg({ subject: "網頁信", body: "plain-duplicate-secret", html: '<h1>中文標題</h1><p>甲<b>乙</b> &amp; 丙</p><a href="https://example.invalid/msg-link">入口</a><script>script-secret</script><style>style-secret</style>', attachments: true }));
  const document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorCode ?? "");
  const text = document.blocks.map(block => block.content).join("\n");
  assert.match(text, /甲乙 & 丙/);
  assert.match(text, /msg-link/);
  assert.doesNotMatch(text, /secret|附件私密名稱/);
  assert.ok(document.blocks.slice(1).every(block => block.locationValue.startsWith("郵件正文（HTML）")));
}));

test("M6-B supports ANSI Big5 properties, binary HTML codepages and BOM priority", () => temporary(async dir => {
  const file = path.join(dir, "舊編碼.msg");
  await writeFile(file, makeMsg({ ansiCodepage: 950, subject: "繁體主旨", sender: "中文寄件者", htmlCodepage: 950, htmlBytes: iconv.encode("<p>繁體正文</p>", "cp950") }));
  let document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorCode ?? "");
  assert.equal(document.blocks[0]?.content, "繁體主旨");
  assert.equal(document.blocks.at(-1)?.content, "繁體正文");
  await writeFile(file, makeMsg({ htmlCodepage: 950, htmlBytes: Buffer.from("\ufeff<p>UTF8中文</p>") }));
  document = await parseDocument(file);
  assert.equal(document.blocks[0]?.content, "UTF8中文");
  await writeFile(file, makeMsg({ htmlBytes: iconv.encode('<meta charset="big5"><p>宣告中文</p>', "cp950") }));
  assert.equal((await parseDocument(file)).blocks[0]?.content, "宣告中文");
}));

test("M6-B extracts uncompressed and LZFu RTF Chinese text", () => temporary(async dir => {
  const file = path.join(dir, "RTF.msg");
  for (const compressed of [false, true]) {
    await writeFile(file, makeMsg({ rtf: wrapRtf(String.raw`{\rtf1\ansi\ansicpg1252\uc1 \u20013?\u25991? RTFbody\par second line}`, compressed) }));
    const document = await parseDocument(file);
    assert.equal(document.status, "indexed", document.errorCode ?? "");
    assert.match(document.blocks.map(block => block.content).join("\n"), /中文 RTFbody/);
    assert.match(document.blocks[0]!.locationValue, /RTF/);
  }
}));

test("M6-B recovers RTF encapsulated HTML without HTML control text", () => temporary(async dir => {
  const file = path.join(dir, "封裝.msg");
  await writeFile(file, makeMsg({ rtf: wrapRtf(String.raw`{\rtf1\ansi\ansicpg1252\fromhtml1 {\*\htmltag1 <html><body><p>encapsulated-body</p><a href="https://example.invalid/rtf-link">link</a></body></html>}}`, true) }));
  const document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorCode ?? "");
  assert.match(document.blocks.map(block => block.content).join("\n"), /encapsulated-body/);
  assert.match(document.blocks.map(block => block.content).join("\n"), /rtf-link/);
  assert.equal(document.blocks[0]?.locationValue, "郵件正文（RTF→HTML）／段落 1");
}));

test("M6-B rejects corrupt, non-mail, protected and oversized RTF without partial text", () => temporary(async dir => {
  const excessive = wrapRtf(String.raw`{\rtf1 body}`);
  excessive.writeUInt32LE(21 * 1024 * 1024, 4);
  const foreign = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(foreign, "WordDocument", Buffer.from("fake"));
  const cases: [string, Buffer, string][] = [
    ["壞檔", Buffer.from("secret-bad-content"), "MSG_FORMAT_ERROR"],
    ["其他OLE", Buffer.from(XLSX.CFB.write(foreign, { type: "buffer" })), "MSG_FORMAT_ERROR"],
    ["聯絡人", makeMsg({ subject: "private-subject", messageClass: "IPM.Contact" }), "MSG_ITEM_UNSUPPORTED"],
    ["受保護", makeMsg({ subject: "private-subject", messageClass: "IPM.Note.SMIME" }), "MSG_SMIME_UNSUPPORTED"],
    ["超大RTF", makeMsg({ subject: "private-subject", rtf: excessive }), "MSG_RTF_LIMIT"],
    ["壞RTF", makeMsg({ subject: "private-subject", rtf: Buffer.from("bad-rtf") }), "MSG_RTF_INVALID"],
    ["巨大bin", makeMsg({ rtf: wrapRtf(String.raw`{\rtf1\fromhtml1\bin4000000000 }`) }), "MSG_RTF_INVALID"],
  ];
  for (const [name, data, code] of cases) {
    const file = path.join(dir, name + ".msg");
    await writeFile(file, data);
    const document = await parseDocument(file);
    assert.equal(document.status, "error", name);
    assert.equal(document.errorCode, code, name);
    assert.deepEqual(document.blocks, [], name);
    assert.doesNotMatch(document.errorMessage ?? "", /secret|private/);
  }
}));

test("M6-B distinguishes empty mail, metadata-only, blank HTML fallback and file limits", () => temporary(async dir => {
  const file = path.join(dir, "空白.msg");
  await writeFile(file, makeMsg());
  assert.equal((await parseDocument(file)).status, "no_text");
  await writeFile(file, makeMsg({ subject: "僅有主旨" }));
  assert.equal((await parseDocument(file)).status, "indexed");
  await writeFile(file, makeMsg({ html: "<html><body> </body></html>", body: "純文字備援", rtf: Buffer.from("bad-but-unused") }));
  assert.equal((await parseDocument(file)).blocks[0]?.content, "純文字備援");
  await truncate(file, MAX_FILE_BYTES + 1);
  assert.equal((await parseDocument(file)).status, "too_large");
}));

test("M6-B indexes, filters, updates, removes, retries and searches using independent CLI", () => temporary(async dir => {
  const root = path.join(dir, "郵件 來源");
  await mkdir(root);
  const file = path.join(root, "採購.MSG");
  const store = new IndexStore(path.join(dir, "test.db"));
  try {
    await writeFile(file, makeMsg({ subject: "年度主旨", body: "郵件正文搜尋詞", senderSmtp: "contact@example.invalid" }));
    await writeFile(path.join(root, "說明.txt"), "郵件正文搜尋詞");
    await sync(root, store);
    assert.equal(search(store, "郵件正文搜尋詞").length, 2);
    assert.equal(search(store, "郵件正文搜尋詞", 20, parseTypes(".MSG,msg")).length, 1);
    assert.equal(search(store, "年度主旨")[0]?.rank, 2);
    assert.equal(search(store, "contact@example.invalid")[0]?.location, "郵件寄件者");
    assert.equal((await sync(root, store)).parserCalls, 0);
    await writeFile(file, makeMsg({ body: "修改後的郵件內容" }));
    assert.equal((await sync(root, store)).parserCalls, 1);
    assert.equal(search(store, "修改後的郵件內容").length, 1);
    const broken = path.join(root, "損壞.msg");
    await writeFile(broken, "broken-secret");
    await sync(root, store);
    assert.equal(search(store, "損壞.msg")[0]?.status, "error");
    assert.equal((await sync(root, store)).parserCalls, 1);
    await rm(broken);
    assert.equal((await sync(root, store)).removed, 1);
  } finally { store.close(); }
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(dir, "索引") };
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env });
  assert.equal(run("index", root).status, 0);
  const found = run("search", "修改後的郵件內容", "--type", "MSG");
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /採購.MSG/);
  assert.match(found.stdout, /郵件正文（純文字）/);
  assert.match(run("--help").stdout, /\.msg/);
}));

test("M6-B worker deadline is isolated and parsing remains available", async () => {
  const url = new URL("../src/parsers/msg-worker.js", import.meta.url);
  await assert.rejects(parseInWorker(url, makeMsg({ body: "正文" }), "MSG", 0), { code: "MSG_TIMEOUT" });
  const blocks = await parseInWorker(url, makeMsg({ body: "正常正文" }), "MSG");
  assert.equal(blocks[0]?.content, "正常正文");
});

test("M6-B validates RTF checksum and excludes image/object/metadata payloads", () => temporary(async dir => {
  const file = path.join(dir, "純RTF.msg");
  const rtf = String.raw`{\rtf1\ansi\ansicpg950\uc1 visible{\pict 616263}{\object object-secret}{\info{\title meta-secret}}{\*\unknown ignored-secret}\par \'a4\'a4\'a4\'e5}`;
  await writeFile(file, makeMsg({ rtf: wrapRtf(rtf, true) }));
  let document = await parseDocument(file);
  assert.equal(document.status, "indexed", document.errorCode ?? "");
  const text = document.blocks.map(block => block.content).join("\n");
  assert.match(text, /visible/);
  assert.match(text, /中文/);
  assert.doesNotMatch(text, /616263|secret/);
  const corrupt = wrapRtf(rtf, true);
  corrupt[12] = corrupt[12]! ^ 1;
  await writeFile(file, makeMsg({ subject: "不可當完整索引", rtf: corrupt }));
  document = await parseDocument(file);
  assert.equal(document.errorCode, "MSG_RTF_INVALID");
  assert.deepEqual(document.blocks, []);
}));

test("M6-B fallback recipient names, default ANSI and unsupported HTML charset", () => temporary(async dir => {
  const file = path.join(dir, "備援.msg");
  await writeFile(file, makeMsg({ subject: "備援收件者", extra: { "__substg1.0_0E04001F": Buffer.from("顯示收件者\0", "utf16le") } }));
  assert.ok((await parseDocument(file)).blocks.some(block => block.content === "顯示收件者" && block.locationValue === "郵件收件者"));
  await writeFile(file, makeMsg({ extra: { "__substg1.0_1000001E": Buffer.from([0x63, 0x61, 0x66, 0xe9, 0]) } }));
  assert.equal((await parseDocument(file)).blocks[0]?.content, "café");
  await writeFile(file, makeMsg({ htmlBytes: Buffer.from("<p>unreadable</p>"), htmlCodepage: 999999 }));
  assert.equal((await parseDocument(file)).errorCode, "MSG_ENCODING_UNSUPPORTED");
  await writeFile(file, makeMsg({ htmlBytes: Buffer.from("<p>unreadable</p>"), htmlCodepage: 999999, body: "可讀純文字備援" }));
  assert.equal((await parseDocument(file)).blocks[0]?.content, "可讀純文字備援");
}));
