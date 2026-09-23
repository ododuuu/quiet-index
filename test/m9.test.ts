import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { parseDocument } from "../src/parser.js";
import { ContextSelection, runContext, writeContext, terminalText, type ContextIO } from "../src/context.js";

async function fixture(run: (root: string, store: IndexStore, output: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m9-"));
  const root = path.join(temp, "中文 文件"); await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, path.join(temp, "上下文.json")); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}
function scripted(answers: (string | null)[], onAsk?: (prompt: string) => Promise<void>) {
  const output: string[] = [];
  const io: ContextIO = { interactive: true, write: text => output.push(text),
    ask: async prompt => { await onAsk?.(prompt); return answers.shift() ?? null; } };
  return { io, output };
}
async function absent(file: string) { await assert.rejects(stat(file), { code: "ENOENT" }); }

test("M9 selection is stable across pages, bounded, and atomic on invalid input", () => fixture(async (root, store) => {
  for (let i = 0; i < 25; i++) await writeFile(path.join(root, `${i}.txt`), "共同內文");
  await sync(root, store);
  const selection = new ContextSelection(search(store, "共同內文", 100));
  assert.equal(selection.pages, 3);
  selection.toggle([1, 11]); selection.next(); assert.match(selection.render(), /\[x\] 11\./);
  selection.next(); selection.next(); assert.equal(selection.page, 2);
  selection.previous(); assert.equal(selection.page, 1);
  const previous = selection.picked();
  assert.throws(() => selection.toggle([2, 99]), { code: "CONTEXT_SELECTION_INVALID" });
  assert.deepEqual(selection.picked(), previous);
  selection.toggle([1, 11]); selection.toggle(Array.from({ length: 20 }, (_, index) => index + 1));
  assert.throws(() => selection.toggle([21]), { code: "CONTEXT_SELECTION_LIMIT" });
  assert.equal(selection.selected.size, 20);
}));

test("M9 exports only explicitly selected snippets after full preview and yes", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "甲.txt"), "共同詞 選取片段");
  await writeFile(path.join(root, "乙.txt"), "共同詞 未選取私密內容"); await sync(root, store);
  const results = search(store, "共同詞", 100);
  const index = results.findIndex(result => result.path.endsWith("甲.txt")) + 1;
  let confirmationSawPreview = false;
  const harness = scripted([String(index), "v", "done", "yes"], async prompt => {
    if (prompt.startsWith("確認")) {
      confirmationSawPreview = harness.output.some(text => text.includes("完整預覽") && text.includes("選取片段"));
      await absent(output);
    }
  });
  assert.equal(await runContext(store, { query: "共同詞", output }, harness.io), true);
  assert.equal(confirmationSawPreview, true);
  const raw = await readFile(output, "utf8");
  const context = JSON.parse(raw);
  assert.equal(context.documents.length, 1);
  assert.match(context.documents[0].path, /甲.txt$/);
  assert.equal(context.documents[0].snippet, results[index - 1]!.snippet);
  assert.doesNotMatch(raw, /未選取私密內容|乙.txt/);
  assert.match(context.documents[0].location, /第 1 行/);
}));

test("M9 supports prompted query and preselection without automatic consent", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "聊天.md"), "BU 討論匯出的測試文字"); await sync(root, store);
  const reference = search(store, "BU 討論")[0]!.reference;
  const harness = scripted(["BU 討論", "done", "no", "done", "yes"]);
  assert.equal(await runContext(store, { output, select: [reference, reference] }, harness.io), true);
  assert.equal(JSON.parse(await readFile(output, "utf8")).documents.length, 1);
  assert.ok(harness.output.filter(text => text.includes("完整預覽")).length >= 2);
}));

test("M9 cancellation, EOF, no results and noninteractive mode never create files", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "甲.txt"), "needle"); await sync(root, store);
  for (const answers of [["q"], [null], ["done", "q"], ["1", "done", null], ["1", "done", "q"]]) {
    assert.equal(await runContext(store, { query: "needle", output }, scripted(answers).io), false);
    await absent(output);
  }
  assert.equal(await runContext(store, { query: "no match", output }, scripted([]).io), false);
  await assert.rejects(runContext(store, { query: "needle", output }, { ...scripted([]).io, interactive: false }), { code: "CONTEXT_TERMINAL_REQUIRED" });
  await absent(output);
  await assert.rejects(runContext(store, { query: "needle", output, limit: 501 }, scripted([]).io), { code: "CONTEXT_OPTIONS_INVALID" });
}));

test("M9 source changed during confirmation aborts export", () => fixture(async (root, store, output) => {
  const file = path.join(root, "甲.txt"); await writeFile(file, "needle before"); await sync(root, store);
  const harness = scripted(["1", "done", "yes"], async prompt => {
    if (prompt.startsWith("確認")) await writeFile(file, "needle changed after preview");
  });
  await assert.rejects(runContext(store, { query: "needle", output }, harness.io), { code: "CONTEXT_SOURCE_CHANGED" });
  await absent(output);
}));

test("M9 same-metadata index changes and source deletion cannot export an old preview", () => fixture(async (root, store, output) => {
  const file = path.join(root, "甲.txt"); await writeFile(file, "needle before"); await sync(root, store);
  const original = await parseDocument(file);
  const harness = scripted(["1", "done", "yes"], async prompt => {
    if (prompt.startsWith("確認")) store.upsert({ ...original, blocks: [{ ...original.blocks[0]!, content: "needle replaced" }] }, root);
  });
  await assert.rejects(runContext(store, { query: "needle", output }, harness.io), { code: "CONTEXT_INDEX_CHANGED" });
  await absent(output);
  const deleted = scripted(["1", "done", "yes"], async prompt => { if (prompt.startsWith("確認")) await rm(file); });
  await assert.rejects(runContext(store, { query: "needle", output }, deleted.io), { code: "ACTION_SOURCE_UNAVAILABLE" });
  await absent(output);
}));

test("M9 never overwrites existing files, including a creation race at confirmation", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "甲.txt"), "needle"); await sync(root, store);
  await writeFile(output, "existing");
  await assert.rejects(runContext(store, { query: "needle", output }, scripted([]).io), { code: "CONTEXT_OUTPUT_EXISTS" });
  assert.equal(await readFile(output, "utf8"), "existing"); await rm(output);
  const harness = scripted(["1", "done", "yes"], async prompt => { if (prompt.startsWith("確認")) await writeFile(output, "another writer"); });
  await assert.rejects(runContext(store, { query: "needle", output }, harness.io), { code: "CONTEXT_OUTPUT_EXISTS" });
  assert.equal(await readFile(output, "utf8"), "another writer");
  await assert.rejects(writeContext(path.join(root, "missing", "out.json"), "{}"), { code: "CONTEXT_OUTPUT_UNAVAILABLE" });
  await assert.rejects(writeContext(path.join(root, "oversize.json"), "x".repeat(256 * 1024 + 1)), { code: "CONTEXT_OUTPUT_LIMIT" });
}));

test("M9 rejects preselection outside filters and labels filename-only context", () => fixture(async (root, store, output) => {
  await writeFile(path.join(root, "needle.txt"), "unrelated private body");
  await writeFile(path.join(root, "needle.md"), "other private body"); await sync(root, store);
  const reference = search(store, "needle", 20, [".txt"])[0]!.reference;
  await assert.rejects(runContext(store, { query: "needle", output, types: [".md"], select: [reference] }, scripted([]).io), { code: "CONTEXT_REFERENCE_MISSING" });
  const harness = scripted(["done", "yes"]);
  await runContext(store, { query: "needle", output, types: [".txt"], select: [reference] }, harness.io);
  const context = JSON.parse(await readFile(output, "utf8"));
  assert.equal(context.documents[0].filenameOnly, true);
  assert.equal(context.documents[0].snippet, "needle.txt");
  assert.equal(context.documents[0].location, null);
  assert.doesNotMatch(await readFile(output, "utf8"), /private body/);
}));

test("M9 terminal control characters are visible data and exported JSON round-trips", () => fixture(async (root, store, output) => {
  assert.equal(terminalText("a\u001b[2J\u202eb"), "a\\u001b[2J\\u202eb");
  await writeFile(path.join(root, "甲.txt"), 'needle \u001b[2J literal \\u000a "quoted"'); await sync(root, store);
  const harness = scripted(["1", "done", "yes"]);
  await runContext(store, { query: "needle", output }, harness.io);
  assert.ok(harness.output.every(text => !text.includes("\u001b")));
  const preview = harness.output.find(text => text.startsWith("完整預覽"))!;
  const json = preview.slice(preview.indexOf("{\n"), preview.lastIndexOf("\n輸出："));
  assert.deepEqual(JSON.parse(json), JSON.parse(await readFile(output, "utf8")));
}));

test("M9 CLI validates options and refuses piped consent", () => fixture(async (root, _store, output) => {
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(root, "data") };
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env, input: "1\ndone\nyes\n" });
  await writeFile(path.join(root, "甲.txt"), "needle"); assert.equal(run("index", root).status, 0);
  assert.match(run("--help").stdout, /context/);
  for (const args of [["context", "needle"], ["context", "needle", "--out", output, "--limit", "501"],
    ["context", "needle", "--out", output, "--select", "1"], ["context", "needle", "--out", output, "--yes"]]) assert.equal(run(...args).status, 2);
  const result = run("context", "needle", "--out", output);
  assert.equal(result.status, 3); assert.match(result.stderr, /CONTEXT_TERMINAL_REQUIRED/);
  await absent(output);
}));

for (const launcher of ["docsearch.cmd", "seekah.cmd"]) {
test(`M9 Windows ${launcher} runs help without changing working directory`, { skip: process.platform !== "win32" }, async () => {
  const command = path.resolve(launcher);
  const env = { ...process.env, LOCALDOCSEARCH_CMD_TEST: command };
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-cmd-"));
  const wrapper = path.join(temp, "run.cmd");
  try {
    // 將 call 放入批次檔，避免 Node 將含空白／括號的絕對路徑再經
    // cmd.exe /c 的外層命令列解析一次；產品 launcher 本身仍由任意 cwd 執行。
    await writeFile(wrapper, "@echo off\r\ncall \"%LOCALDOCSEARCH_CMD_TEST%\" --help\r\nexit /b %errorlevel%\r\n");
    const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", wrapper],
      { encoding: "utf8", cwd: os.tmpdir(), env, timeout: 5000 });
    assert.equal(result.error, undefined, `cmd 啟動不應失敗或逾時：${result.error?.message ?? ""}`);
    assert.equal(result.status, 0, `cmd launcher status=${result.status ?? "null"}, signal=${result.signal ?? "none"}`);
    assert.match(result.stdout, /Seekah/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
}
