import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContextSessionSelection, runContext, type ContextIO } from "../src/context.js";
import { search } from "../src/search.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";

async function fixture(run: (root: string, store: IndexStore, output: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m14-"));
  const root = path.join(temp, "工作資料");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, path.join(temp, "跨查詢上下文.json")); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

function scripted(answers: (string | null)[], onAsk?: (prompt: string) => Promise<void>) {
  const output: string[] = [];
  const io: ContextIO = {
    interactive: true,
    write: text => output.push(text),
    ask: async prompt => { await onAsk?.(prompt); return answers.shift() ?? null; },
  };
  return { io, output };
}

async function absent(file: string) {
  await assert.rejects(stat(file), { code: "ENOENT" });
}

test("M14 combines a specification and BU chat selected through different queries", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "系統規格.txt"), "付款批次 規格條款 A");
  await writeFile(path.join(root, "BU聊天.md"), "對帳例外 BU 決議 B");
  await writeFile(path.join(root, "未選文件.txt"), "付款批次 不可匯出內容");
  await sync(root, store);
  const first = search(store, "付款批次").findIndex(result => result.path.endsWith("系統規格.txt")) + 1;
  const secondResults = search(store, "對帳例外");
  const second = secondResults.findIndex(result => result.path.endsWith("BU聊天.md")) + 1;
  const harness = scripted([String(first), "s 對帳例外", String(second), "b", "done", "yes"]);
  assert.equal(await runContext(store, { query: "付款批次", output }, harness.io), true);
  const data = JSON.parse(await readFile(output, "utf8"));
  assert.equal(data.schemaVersion, 4);
  assert.equal(data.matchMode, "phrase");
  assert.deepEqual(data.queries, ["付款批次", "對帳例外"]);
  assert.equal(data.query, "付款批次");
  assert.deepEqual(data.documents.map((document: { query: string }) => document.query), ["付款批次", "對帳例外"]);
  assert.ok(data.documents.every((document: { passages: { query: string }[]; query: string }) =>
    document.passages.every(passage => passage.query === document.query)));
  assert.doesNotMatch(await readFile(output, "utf8"), /不可匯出內容|未選文件/);
  assert.ok(harness.output.some(text => text.includes("跨查詢已選 2/20") && text.includes("BU聊天.md")));
}));

test("M14 global selection is deduplicated, bounded and removable atomically", () => fixture(async (root, store) => {
  for (let index = 0; index < 21; index++) await writeFile(path.join(root, `${index}.txt`), `共同詞 ${index}`);
  await writeFile(path.join(root, "雙命中.md"), "第一查詢 第二查詢");
  await sync(root, store);
  const first = search(store, "第一查詢", 100);
  const session = new ContextSessionSelection("第一查詢", first);
  session.toggle([1]);
  session.search("第二查詢", search(store, "第二查詢", 100));
  assert.match(session.render(), /\[x\] 1\./);
  session.toggle([1]);
  assert.equal(session.size, 0);
  session.search("共同詞", search(store, "共同詞", 100));
  session.toggle(Array.from({ length: 20 }, (_, index) => index + 1));
  assert.throws(() => session.toggle([21]), { code: "CONTEXT_SELECTION_LIMIT" });
  assert.equal(session.size, 20);
  const before = session.picked();
  assert.throws(() => session.remove([1, 99]), { code: "CONTEXT_BASKET_INVALID" });
  assert.deepEqual(session.picked(), before);
  session.remove([1, 2]);
  assert.equal(session.size, 18);
}));

test("M14 a search with no results preserves candidates and selected documents", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "規格.txt"), "存在查詢 可用內容");
  await sync(root, store);
  const harness = scripted(["1", "s 完全不存在", "b", "done", "yes"]);
  assert.equal(await runContext(store, { query: "存在查詢", output }, harness.io), true);
  assert.ok(harness.output.some(text => text.includes("沒有結果；保留目前候選與已選清單")));
  assert.equal(JSON.parse(await readFile(output, "utf8")).documents.length, 1);
}));

test("M14 markdown labels every selected query", () => fixture(async (root, store, output) => {
  const markdown = output.replace(/\.json$/, ".md");
  await writeFile(path.join(root, "規格.txt"), "規格詞 條款");
  await writeFile(path.join(root, "聊天.md"), "聊天詞 決議");
  await sync(root, store);
  await runContext(store, { query: "規格詞", output: markdown, format: "md" }, scripted(["1", "s 聊天詞", "1", "done", "yes"]).io);
  const text = await readFile(markdown, "utf8");
  assert.match(text, /查詢：規格詞；聊天詞/);
  assert.match(text, /選取查詢：規格詞/);
  assert.match(text, /選取查詢：聊天詞/);
  assert.match(text, /命中 1（內容；查詢：聊天詞）/);
}));

test("M14 verifies every query again after confirmation", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "規格.txt"), "規格詞 before");
  const chat = path.join(root, "聊天.md");
  await writeFile(chat, "聊天詞 before");
  await sync(root, store);
  const harness = scripted(["1", "s 聊天詞", "1", "done", "yes"], async prompt => {
    if (prompt.startsWith("確認")) await writeFile(chat, "聊天詞 changed after preview");
  });
  await assert.rejects(runContext(store, { query: "規格詞", output }, harness.io), { code: "CONTEXT_SOURCE_CHANGED" });
  await absent(output);
}));

test("M14 cancel after several searches never writes partial context", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "規格.txt"), "規格詞");
  await writeFile(path.join(root, "聊天.md"), "聊天詞");
  await sync(root, store);
  assert.equal(await runContext(store, { query: "規格詞", output }, scripted(["1", "s 聊天詞", "1", "q"]).io), false);
  await absent(output);
}));
