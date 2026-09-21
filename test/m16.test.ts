import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runContext, type ContextIO } from "../src/context.js";
import { matchingPassages, search } from "../src/search.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";

async function fixture(run: (root: string, store: IndexStore, output: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m16-"));
  const root = path.join(temp, "文件");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, path.join(temp, "context.json")); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

function scripted(answers: string[]) {
  const output: string[] = [];
  const io: ContextIO = { interactive: true, write: value => output.push(value), ask: async () => answers.shift() ?? null };
  return { io, output };
}

test("M16 all-terms finds words across blocks while phrase mode stays unchanged", () => fixture(async (root, store) => {
  await writeFile(path.join(root, "付款規格.txt"), "付款批次規格\n對帳發生例外\n核准流程");
  await writeFile(path.join(root, "缺詞.txt"), "付款與對帳，但沒有第三個詞");
  await sync(root, store);
  assert.equal(search(store, "付款 例外 核准").length, 0);
  const hits = search(store, "付款 例外 核准", 20, undefined, undefined, "all-terms");
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.path, /付款規格\.txt$/);
  assert.equal(hits[0]!.reason, "內容（全部關鍵字）");
  assert.match(hits[0]!.snippet, /付款|例外|核准/);
}));

test("M16 all-terms normalizes whitespace, deduplicates terms and preserves ranking", () => fixture(async (root, store) => {
  await writeFile(path.join(root, "甲 乙.txt"), "無關");
  await writeFile(path.join(root, "標題.md"), "# 甲乙標題\n內容");
  await writeFile(path.join(root, "內容.txt"), "甲與乙");
  await sync(root, store);
  const hits = search(store, "  甲\t乙  甲 ", 20, undefined, undefined, "all-terms");
  assert.deepEqual(hits.map(hit => path.basename(hit.path)), ["甲 乙.txt", "標題.md", "內容.txt"]);
  assert.deepEqual(hits.map(hit => hit.rank), [3, 2, 1]);
  assert.equal(search(store, "甲", 20, undefined, undefined, "all-terms").length, search(store, "甲").length);
}));

test("M16 passages prefer uncovered terms and context revalidates in all-terms mode", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "跨段.txt"), "甲甲甲 第一段\n甲乙 第二段\n丙 第三段");
  await sync(root, store);
  const file = path.join(root, "跨段.txt");
  const passages = matchingPassages(store, "甲 乙 丙", file, 2, "all-terms");
  assert.equal(passages.length, 2);
  assert.match(passages[0]!.snippet, /甲乙/);
  assert.match(passages[1]!.snippet, /丙/);
  const harness = scripted(["1", "done", "yes"]);
  assert.equal(await runContext(store, { query: "甲 乙 丙", output, allTerms: true, passages: 2 }, harness.io), true);
  const data = JSON.parse(await readFile(output, "utf8"));
  assert.equal(data.documents.length, 1);
  assert.equal(data.schemaVersion, 4);
  assert.equal(data.matchMode, "all-terms");
  assert.ok(harness.output.some(value => value.includes("查詢：全部關鍵字")));
}));

test("M16 CLI exposes all-terms only on search and context", () => fixture(async (root, _store) => {
  const data = path.join(path.dirname(root), "data");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: data };
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env });
  await writeFile(path.join(root, "文件.txt"), "付款內容與例外說明");
  assert.equal(run("index", root).status, 0);
  const result = run("search", "付款 例外", "--all-terms");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /文件\.txt/);
  assert.equal(run("search", "付款 例外").stdout.includes("文件.txt"), false);
  assert.equal(run("status", "--all-terms").status, 2);
}));
