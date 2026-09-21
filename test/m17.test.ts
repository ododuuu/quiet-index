import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { documentReference } from "../src/document-reference.js";
import { actOnDocument } from "../src/open-document.js";
import { parseDocument } from "../src/parser.js";
import { scan } from "../src/scanner.js";
import { parseTypes, search } from "../src/search.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";

async function fixture(run: (root: string, store: IndexStore, temp: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m17-"));
  const root = path.join(temp, "資料清冊");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, temp); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

test("M17 records unsupported and extensionless files without reading their contents", () => fixture(async (root, store) => {
  const text = path.join(root, "說明.txt");
  const image = path.join(root, "活動照片.JPG");
  const archive = path.join(root, "歷史封存.zip");
  const extensionless = path.join(root, "LICENSE");
  await writeFile(text, "可搜尋正文");
  await writeFile(image, "不可成為命中的圖片假正文");
  await writeFile(archive, "不可成為命中的壓縮檔假正文");
  await writeFile(extensionless, "不可成為命中的無副檔名假正文");

  let parserCalls = 0;
  const report = await sync(root, store, { parse: async file => {
    parserCalls++;
    assert.equal(file, text);
    return parseDocument(file);
  } });
  assert.equal(report.found, 4);
  assert.equal(report.parserCalls, 1);
  assert.equal(parserCalls, 1);
  assert.equal(report.statuses.indexed, 1);
  assert.equal(report.statuses.unsupported, 3);
  assert.deepEqual(store.counts(), { indexed: 1, no_text: 0, unsupported: 3, too_large: 0, encrypted: 0, error: 0 });
  assert.equal(store.documentIssues().length, 0);
  assert.equal(search(store, "可搜尋正文").length, 1);
  assert.equal(search(store, "圖片假正文").length, 0);
  assert.equal(search(store, "活動照片", 20, parseTypes("jpg"))[0]?.status, "unsupported");
  assert.equal(search(store, "歷史封存", 20, parseTypes("ZIP"))[0]?.filenameOnly, true);
  assert.equal(search(store, "LICENSE")[0]?.extension, "");

  const row = store.getDocument(image)!;
  let launches = 0;
  const target = await actOnDocument(store, documentReference(row.id, row.path), "open", true, async () => { launches++; });
  assert.equal(path.basename(target.path), path.basename(image));
  assert.equal(launches, 0);
}));

test("M17 incrementally updates and removes metadata-only files without parser calls", () => fixture(async (root, store) => {
  const file = path.join(root, "設計圖.dwg");
  await writeFile(file, "binary-one");
  const neverParse: typeof parseDocument = async () => { throw new Error("metadata-only 不可進解析器"); };
  assert.equal((await sync(root, store, { parse: neverParse })).parserCalls, 0);
  const unchanged = await sync(root, store, { parse: neverParse });
  assert.equal(unchanged.unchanged, 1);
  assert.equal(unchanged.parserCalls, 0);

  await writeFile(file, "binary-two-with-a-different-size");
  const future = new Date(Date.now() + 2000);
  await utimes(file, future, future);
  const changed = await sync(root, store, { parse: neverParse });
  assert.equal(changed.reprocessed, 1);
  assert.equal(changed.statuses.unsupported, 1);
  assert.equal(changed.parserCalls, 0);

  await rm(file);
  const removed = await sync(root, store, { parse: neverParse });
  assert.equal(removed.removed, 1);
  assert.equal(store.getDocument(file), undefined);
}));

test("M17 keeps excluded paths and links out of the file inventory", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m17-scan-"));
  try {
    const hidden = path.join(temp, "private");
    await mkdir(hidden);
    await writeFile(path.join(hidden, "秘密.bin"), "secret");
    await writeFile(path.join(temp, ".localdocsearchignore"), "private/\n");
    await writeFile(path.join(temp, "可見.dat"), "visible");
    await symlink(temp, path.join(temp, "cycle"), process.platform === "win32" ? "junction" : "dir");
    const result = await scan(temp);
    assert.deepEqual(result.paths.map(value => path.basename(value)), [".localdocsearchignore", "可見.dat"]);
    assert.equal(result.skipped.user, 1);
    assert.equal(result.skipped.link, 1);
    assert.equal(result.skipped.unsupported, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("M17 CLI reports all files and filters metadata-only extensions", () => fixture(async (root, _store, temp) => {
  await writeFile(path.join(root, "一般文字.txt"), "正文");
  await writeFile(path.join(root, "封面圖片.jpg"), "not parsed");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temp, "cli-data") };
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env });
  const indexed = run("index", root);
  assert.equal(indexed.status, 0, indexed.stderr);
  assert.match(indexed.stdout, /找到 2 份一般檔案/);
  assert.match(indexed.stdout, /unsupported=1/);
  const result = run("search", "封面圖片", "--type", "jpg");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /封面圖片\.jpg/);
  assert.match(result.stdout, /unsupported/);
}));
