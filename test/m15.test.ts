import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClipboardError, clipboardPlan } from "../src/clipboard.js";
import { runContext, type ContextIO } from "../src/context.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";

async function fixture(run: (root: string, store: IndexStore) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m15-"));
  const root = path.join(temp, "文件");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store); } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

function scripted(answers: (string | null)[]) {
  const output: string[] = [];
  const io: ContextIO = { interactive: true, write: value => output.push(value), ask: async () => answers.shift() ?? null };
  return { io, output };
}

test("M15 copies confirmed Markdown to an injected clipboard writer", () => fixture(async (root, store) => {
  await writeFile(path.join(root, "規格.txt"), "付款批次 中文規格");
  await sync(root, store);
  const harness = scripted(["1", "done", "yes"]);
  const copied: string[] = [];
  assert.equal(await runContext(store, { query: "付款批次", clipboard: true }, harness.io, async text => { copied.push(text); }), true);
  assert.equal(copied.length, 1);
  assert.match(copied[0]!, /^# Seekah 上下文/m);
  assert.match(copied[0]!, /中文規格/);
  assert.ok(harness.output.some(value => value.includes("剪貼簿歷程")));
  assert.ok(harness.output.some(value => value.includes("未傳送至外部服務")));
}));

test("M15 never touches clipboard before yes and propagates a fixed failure", () => fixture(async (root, store) => {
  await writeFile(path.join(root, "資料.txt"), "needle content");
  await sync(root, store);
  let calls = 0;
  const writer = async () => { calls++; };
  assert.equal(await runContext(store, { query: "needle", clipboard: true }, scripted(["1", "done", "q"]).io, writer), false);
  assert.equal(calls, 0);
  await assert.rejects(runContext(store, { query: "needle", clipboard: true }, scripted(["1", "done", "yes"]).io,
    async () => { throw new ClipboardError("CONTEXT_CLIPBOARD_FAILED", "固定錯誤"); }), { code: "CONTEXT_CLIPBOARD_FAILED" });
}));

test("M15 clipboard plans avoid shell interpolation and set Windows UTF-8 stdin", () => {
  const mac = clipboardPlan("darwin", { TEST_VALUE: "x" });
  assert.equal(mac.executable, "/usr/bin/pbcopy");
  assert.deepEqual(mac.args, []);
  const windows = clipboardPlan("win32", { SystemRoot: "C:\\Windows" });
  assert.equal(windows.executable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(windows.args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  const script = Buffer.from(windows.args[4]!, "base64").toString("utf16le");
  assert.match(script, /InputEncoding/);
  assert.match(script, /Set-Clipboard/);
  assert.doesNotMatch(script, /LOCALDOCSEARCH|付款|needle/);
  assert.throws(() => clipboardPlan("linux"), { code: "CONTEXT_CLIPBOARD_UNSUPPORTED" });
});

test("M15 CLI requires exactly one context destination", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8" });
  assert.equal(run("context", "needle").status, 2);
  assert.equal(run("context", "needle", "--out", "x.json", "--clipboard").status, 2);
  const clipboard = run("context", "needle", "--clipboard");
  assert.equal(clipboard.status, 3);
});
