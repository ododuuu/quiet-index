import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, truncate } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { parseDocument, MAX_FILE_BYTES } from "../src/parser.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search, parseTypes } from "../src/search.js";
import { extractVsd, expandVsd } from "../src/parsers/vsd-binary.js";
import { parseInWorker } from "../src/parsers/worker.js";
import { makeVsd, vsdChunk, literalCompress } from "./fixtures/vsd.js";

async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lds-m6c-中文 "));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("M6-C extracts structured Chinese and nested shape text, excluding unrelated streams", () => {
  for (const compressed of [true, false]) {
    const blocks = extractVsd(makeVsd({ compressed }));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.content, "繁體中文流程\n核准採購");
    assert.match(blocks[0]!.locationValue, /頁面 ID 0／圖形 ID 7/);
  }
  const body = (text: string) => Buffer.concat([Buffer.alloc(8), Buffer.from(text, "utf16le")]);
  const chunks = Buffer.concat([
    vsdChunk(0x47, 9, Buffer.alloc(0)),
    vsdChunk(0x48, 10, Buffer.alloc(0), 2),
    vsdChunk(0x0e, 0, body("子圖形"), 3),
    vsdChunk(0x48, 11, Buffer.alloc(0), 2),
    vsdChunk(0x0e, 0, body("另一圖形\u001e欄位後文"), 3),
  ]);
  const blocks = extractVsd(makeVsd({ chunks }));
  assert.match(blocks[0]!.locationValue, /圖形 ID 10/);
  assert.match(blocks[1]!.locationValue, /圖形 ID 11/);
  assert.equal(blocks[1]!.content, "另一圖形\n欄位後文");
});

test("M6-C validates an upstream real VSD regression document", async () => {
  const bytes = await readFile("test/fixtures/libvisio-no-bgcolor.vsd");
  const blocks = extractVsd(bytes);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.content, "My hovercraft is full of eels.");
  assert.match(blocks[0]!.locationValue, /頁面 ID 4／圖形 ID 6/);
});

test("M6-C LZSS backreferences, wraparound, malformed tokens and output budget", () => {
  // literal A B C，接著從字典 0 複製六個字元（包含重疊來源）。
  assert.equal(expandVsd(Buffer.from([7, 65, 66, 67, 0xee, 0xf3])).toString(), "ABCABCABC");
  const bytes = Buffer.from("中文字".repeat(2000));
  assert.deepEqual(expandVsd(literalCompress(bytes)), bytes);
  assert.throws(() => expandVsd(literalCompress(bytes), 10), { code: "VSD_RESOURCE_LIMIT" });
  assert.throws(() => expandVsd(Buffer.from([0, 1])), { code: "VSD_FORMAT_ERROR" });
});

test("M6-C classifies versions, damage, cycles, invalid Unicode and empty direct text", () => temporary(async dir => {
  const file = path.join(dir, "流程.VSD");
  const cases: [Buffer, string, string | null][] = [
    [makeVsd({ version: 6 }), "unsupported", "VSD_VERSION_UNSUPPORTED"],
    [makeVsd({ corrupt: true }), "error", "VSD_FORMAT_ERROR"],
    [makeVsd({ cycle: true }), "error", "VSD_POINTER_CYCLE"],
    [Buffer.from("不是真正VSD"), "error", "VSD_FORMAT_ERROR"],
    [makeVsd({ text: "\ud800" }), "error", "VSD_TEXT_ENCODING_ERROR"],
    [makeVsd({ text: "" }), "no_text", null],
  ];
  for (const [bytes, status, code] of cases) {
    await writeFile(file, bytes);
    const record = await parseDocument(file);
    assert.equal(record.status, status, code ?? "empty");
    assert.equal(record.errorCode, code);
    assert.deepEqual(record.blocks, []);
    assert.ok((await readFile(file)).equals(bytes));
  }
}));

test("M6-C retains file size policy", () => temporary(async dir => {
  const file = path.join(dir, "大型.vsd");
  await writeFile(file, ""); await truncate(file, MAX_FILE_BYTES + 1);
  const record = await parseDocument(file);
  assert.equal(record.status, "too_large");
  assert.equal(record.errorCode, "FILE_TOO_LARGE");
  assert.deepEqual(record.blocks, []);
}));

test("M6-C migrates old filename-only rows and maintains filters and incremental lifecycle", () => temporary(async dir => {
  const root = path.join(dir, "來源"); await mkdir(root);
  const file = path.join(root, "流程.VSD"); await writeFile(file, makeVsd());
  await writeFile(path.join(root, "流程.txt"), "核准採購");
  await writeFile(path.join(root, "略過.vsdx"), "不支援");
  const store = new IndexStore(path.join(dir, "test.db"));
  try {
    await sync(root, store);
    const old = await parseDocument(file);
    store.upsert({ ...old, blocks: [], status: "unsupported", errorCode: "VSD_CONTENT_UNSUPPORTED" });
    const upgrade = await sync(root, store);
    assert.equal(upgrade.reprocessed, 1);
    assert.equal(upgrade.skipped.unsupported, 0);
    assert.equal(upgrade.complete, true);
    const hits = search(store, "核准採購", 20, parseTypes(".VSD,vsd"));
    assert.equal(hits.length, 1); assert.equal(hits[0]?.status, "indexed");
    assert.equal(search(store, "不能索引").length, 0);
    assert.equal((await sync(root, store)).parserCalls, 0);
    await writeFile(file, makeVsd({ text: "新的流程內容不同長度" }));
    assert.equal((await sync(root, store)).reprocessed, 1);
    assert.equal(search(store, "核准採購", 20, [".vsd"]).length, 0);
    assert.equal(search(store, "新的流程", 20, [".vsd"]).length, 1);
    assert.equal((await sync(root, store, { rebuild: true })).found, 3);
    await writeFile(path.join(root, ".localdocsearchignore"), "*.VSD\n");
    assert.equal((await sync(root, store)).removed, 1);
    await rm(path.join(root, ".localdocsearchignore"));
    assert.equal((await sync(root, store)).added, 1);
    await rm(file); assert.equal((await sync(root, store)).removed, 1);
  } finally { store.close(); }
}));

test("M6-C CLI searches direct text and explains unsupported version", () => temporary(async dir => {
  const root = path.join(dir, "來源"); await mkdir(root);
  await writeFile(path.join(root, "架構.VSD"), makeVsd());
  await writeFile(path.join(root, "舊版本.vsd"), makeVsd({ version: 5 }));
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(dir, "索引") };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  assert.match(run("--help"), /VSD v11/);
  assert.match(run("index", root), /此 VSD 版本或結構尚不支援/);
  assert.match(run("search", "核准採購", "--type", "vsd"), /圖形 ID 7/);
  assert.match(run("search", "舊版本", "--type", "vsd"), /unsupported/);
  assert.match(run("status"), /VSD_VERSION_UNSUPPORTED/);
}));

test("M6-C worker deadline does not poison subsequent parsing", async () => {
  const url = new URL("../src/parsers/vsd-worker.js", import.meta.url);
  await assert.rejects(parseInWorker(url, makeVsd(), "VSD", 0), { code: "VSD_TIMEOUT" });
  assert.equal((await parseInWorker(url, makeVsd(), "VSD"))[0]?.content, "繁體中文流程\n核准採購");
});

test("M6-C does not retain partial text when a later chunk is malformed", () => temporary(async dir => {
  const file = path.join(dir, "中途損壞.vsd");
  const good = vsdChunk(0x0e, 0, Buffer.concat([Buffer.alloc(8), Buffer.from("不可留下半份文字", "utf16le")]), 2);
  await writeFile(file, makeVsd({ chunks: Buffer.concat([good, Buffer.from([14, 0, 0])]) }));
  const record = await parseDocument(file);
  assert.equal(record.status, "error"); assert.deepEqual(record.blocks, []);
}));

test("M6-C reports no directly stored text without claiming an empty drawing", () => temporary(async dir => {
  await writeFile(path.join(dir, "空文字.vsd"), makeVsd({ text: "" }));
  const store = new IndexStore(path.join(dir, "index.db"));
  try {
    const report = await sync(dir, store);
    assert.equal(report.statuses.no_text, 1);
    assert.ok(report.notices.some(notice => notice.includes("未展開 master")));
    assert.equal(search(store, "空文字")[0]?.status, "no_text");
    assert.equal((await sync(dir, store)).parserCalls, 0);
  } finally { store.close(); }
}));
