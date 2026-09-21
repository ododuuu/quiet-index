import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { matchingPassages, search } from "../src/search.js";
import { runContext, type ContextIO } from "../src/context.js";

async function fixture(run: (root: string, store: IndexStore, output: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m10-"));
  const root = path.join(temp, "中文 文件"); await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, path.join(temp, "上下文.json")); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}
function scripted(answers: (string | null)[]) {
  const output: string[] = [];
  const io: ContextIO = { interactive: true, write: text => output.push(text),
    ask: async () => answers.shift() ?? null };
  return { io, output };
}

test("M10 matchingPassages returns multiple content hits in ordinal order", () => fixture(async (root, store) => {
  await writeFile(path.join(root, "多段.txt"), "前言\n共同詞 第一段\n中間\n共同詞 第二段\n結尾 共同詞 第三段\n");
  await sync(root, store);
  const passages = matchingPassages(store, "共同詞", path.join(root, "多段.txt"), 2);
  assert.equal(passages.length, 2);
  assert.match(passages[0]!.snippet, /第一段/);
  assert.match(passages[1]!.snippet, /第二段/);
  assert.equal(matchingPassages(store, "共同詞", path.join(root, "多段.txt"), 10).length, 3);
}));

test("M10 JSON export keeps multiple passages in the current schema", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "多段.txt"), "共同詞 AAA\n共同詞 BBB\n");
  await sync(root, store);
  assert.equal(await runContext(store, { query: "共同詞", output, passages: 2 }, scripted(["1", "done", "yes"]).io), true);
  const context = JSON.parse(await readFile(output, "utf8"));
  assert.equal(context.schemaVersion, 4);
  assert.equal(context.matchMode, "phrase");
  assert.equal(context.documents[0].passages.length, 2);
  assert.match(context.documents[0].passages[0].snippet, /AAA/);
  assert.match(context.documents[0].passages[1].snippet, /BBB/);
  assert.equal(context.documents[0].snippet, context.documents[0].passages[0].snippet);
}));

test("M10 markdown export is paste-friendly and omits unselected files", () => fixture(async (root, store) => {
  const output = path.join(path.dirname(root), "上下文.md");
  await writeFile(path.join(root, "甲.txt"), "共同詞 要留下");
  await writeFile(path.join(root, "乙.txt"), "共同詞 不該出現的私密");
  await sync(root, store);
  const index = search(store, "共同詞").findIndex(result => result.path.endsWith("甲.txt")) + 1;
  assert.equal(await runContext(store, { query: "共同詞", output, format: "md" }, scripted([String(index), "done", "yes"]).io), true);
  const markdown = await readFile(output, "utf8");
  assert.match(markdown, /^# LocalDocSearch 上下文/m);
  assert.match(markdown, /要留下/);
  assert.match(markdown, /文件代碼：`/);
  assert.doesNotMatch(markdown, /不該出現的私密|乙\.txt/);
}));
