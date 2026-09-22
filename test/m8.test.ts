import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile, rename, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { scan } from "../src/scanner.js";
import { actOnDocument, resolveDocument } from "../src/open-document.js";
import { parseDocument } from "../src/parser.js";
import { documentReference } from "../src/document-reference.js";

async function fixture(run: (a: string, b: string, temp: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m8-"));
  const a = path.join(temp, "A 文件"), b = path.join(temp, "B 文件");
  await mkdir(a); await mkdir(b);
  try { await run(a, b, temp); } finally { await rm(temp, { recursive: true, force: true }); }
}

test("M8 indexes two roots, filters before limit, and opens either root", () => fixture(async (a, b, temp) => {
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    await writeFile(path.join(a, "甲.txt"), "共通關鍵字");
    await writeFile(path.join(b, "共通關鍵字.txt"), "乙內容");
    await sync(a, store); const ref = search(store, "共通關鍵字")[0]!.reference;
    await sync(b, store);
    assert.equal(search(store, "共通關鍵字").length, 2);
    assert.equal(search(store, "共通關鍵字", 1, undefined, a)[0]?.reference, ref);
    assert.equal((await actOnDocument(store, ref, "open", true)).path.endsWith("甲.txt"), true);
    assert.equal((await sync(a, store)).parserCalls, 0);
    assert.equal((await sync(b, store)).parserCalls, 0);
    assert.equal(store.roots().length, 2);
  } finally { store.close(); }
}));

test("M8 deletions, ignores, rebuild and root removal cannot clear a sibling root", () => fixture(async (a, b, temp) => {
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    const fileA = path.join(a, "甲.txt"), fileB = path.join(b, "乙.txt");
    await writeFile(fileA, "甲內容"); await writeFile(fileB, "乙內容");
    await sync(a, store); await sync(b, store);
    const ref = search(store, "乙內容")[0]!.reference;
    await writeFile(path.join(a, ".localdocsearchignore"), "甲.txt\n");
    assert.equal((await sync(a, store)).removed, 1);
    assert.equal(search(store, "乙內容")[0]?.reference, ref);
    await rm(path.join(a, ".localdocsearchignore")); await sync(a, store, { rebuild: true });
    assert.equal(search(store, "乙內容")[0]?.reference, ref);
    await rm(fileA); assert.equal((await sync(a, store)).removed, 1);
    assert.equal(store.removeRoot(b), 1);
    assert.equal(await readFile(fileB, "utf8"), "乙內容");
    assert.equal(search(store, "乙內容").length, 0);
    assert.deepEqual(store.roots(), [a]);
  } finally { store.close(); }
}));

test("M8 aliases reuse roots and child paths sync as subtree", () => fixture(async (a, _b, temp) => {
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    await writeFile(path.join(a, "甲.txt"), "內容"); await sync(a, store);
    const alias = path.join(temp, "別名"); await symlink(a, alias, "junction");
    assert.equal((await sync(alias, store)).parserCalls, 0);
    assert.equal(store.roots().length, 1);
    const child = path.join(a, "child"); await mkdir(child);
    await writeFile(path.join(child, "子.txt"), "子內容");
    const subtree = await sync(child, store);
    assert.equal(subtree.operation, "subtree");
    assert.equal(store.roots().length, 1);
    assert.equal(store.roots()[0], a);
    assert.equal(search(store, "子內容").length, 1);
    assert.match(subtree.notices.join("\n"), /已包含於上層索引/);
  } finally { store.close(); }
}));

test("M8 incomplete rebuild retains unknown files and per-root successful time", () => fixture(async (a, b, temp) => {
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    await writeFile(path.join(a, "甲.txt"), "甲內容"); await writeFile(path.join(b, "乙.txt"), "乙內容");
    await sync(a, store); await sync(b, store);
    const time = store.getLastSyncReport(a).successfulAt;
    const incomplete: typeof scan = async root => ({ ...await scan(root), paths: [], errors: ["read failure"],
      diagnostics: [{ stage: "scan", path: root, code: "SCAN_READ_FAILED", message: "無法讀取" }] });
    assert.equal((await sync(a, store, { rebuild: true, scan: incomplete })).complete, false);
    assert.equal(search(store, "內容").length, 2);
    assert.equal(store.getLastSyncReport(a).successfulAt, time);
    assert.equal(store.getLastSyncReport(a).complete, false);
    assert.equal(store.getLastSyncReport(b).complete, true);
  } finally { store.close(); }
}));

test("M8 migrates a legacy single-root database without reading source or changing IDs", () => fixture(async (a, _b, temp) => {
  const database = path.join(temp, "index.db");
  let store = new IndexStore(database);
  await writeFile(path.join(a, "甲.txt"), "遷移內容"); await sync(a, store);
  const ref = search(store, "遷移內容")[0]!.reference;
  const time = store.getLastSyncReport().successfulAt;
  store.close();
  const db = new DatabaseSync(database);
  db.exec("DROP TABLE document_roots; DROP TABLE roots; DELETE FROM metadata WHERE key='multi_root_version'"); db.close();
  await rename(a, a + " offline");
  store = new IndexStore(database);
  try {
    await store.upgrade();
    assert.deepEqual(store.roots(), [a]);
    assert.equal(search(store, "遷移內容", 20, undefined, a)[0]?.reference, ref);
    assert.equal(store.getLastSyncReport(a).successfulAt, time);
    assert.equal(store.removeRoot(a), 1);
  } finally { store.close(); }
  store = new IndexStore(database);
  try { assert.deepEqual(store.roots(), []); assert.equal(search(store, "遷移內容").length, 0); }
  finally { store.close(); }
}));

test("M8 action verifies file membership instead of most recently indexed root", () => fixture(async (a, b, temp) => {
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    const file = path.join(a, "甲.txt"); await writeFile(file, "內容"); await sync(a, store); await sync(b, store);
    const record = await parseDocument(file);
    store.upsert(record, b); // 模擬不一致的歸屬；動作仍須核對路徑界線。
    const row = store.getDocument(file)!;
    await assert.rejects(resolveDocument(store, documentReference(row.id, row.path)), { code: "ACTION_PATH_REJECTED" });
  } finally { store.close(); }
}));

test("M8 CLI batches offline roots, preserves search and supports removal", () => fixture(async (a, b, temp) => {
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temp, "cli-data") };
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env });
  await writeFile(path.join(a, "甲.txt"), "共同內文"); await writeFile(path.join(b, "乙.txt"), "共同內文");
  assert.equal(run("index", a).status, 0); assert.equal(run("index", b).status, 0);
  assert.match(run("roots").stdout, /已登錄根目錄：2/);
  assert.match(run("search", "共同內文").stdout, /回傳 2 份/);
  const filtered = run("search", "共同內文", "--root", a, "--limit", "1");
  assert.match(filtered.stdout, /甲.txt/); assert.doesNotMatch(filtered.stdout, /乙.txt/);
  assert.equal(run("search", "共同內文", "--root", temp).status, 3);
  assert.equal(run("search", "共同內文", "--root").status, 2);
  await rename(a, a + " offline"); await writeFile(path.join(b, "乙.txt"), "更新後內文");
  assert.equal(run("index").status, 3);
  assert.match(run("search", "更新後內文").stdout, /乙.txt/);
  assert.match(run("search", "共同內文").stdout, /甲.txt/);
  assert.match(run("status", "--issues").stdout, /ROOT_SYNC_FAILED/);
  assert.equal(run("rebuild").status, 3);
  assert.match(run("search", "共同內文").stdout, /甲.txt/);
  assert.equal(run("roots", "remove", a).status, 0);
  assert.match(run("roots").stdout, /已登錄根目錄：1/);
  assert.equal(run("roots", "remove", b).status, 0);
  assert.equal(await readFile(path.join(b, "乙.txt"), "utf8"), "更新後內文");
  assert.equal(run("index").status, 3);
  assert.equal(run("index", "").status, 2);
  assert.equal(run("rebuild", temp).status, 3);
  assert.match(run("roots").stdout, /已登錄根目錄：0/);
}));
