import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { classifyReprocess, TEXT_PARSE_VERSION } from "../src/model.js";
import { assertProfileIsAnonymous, reserveNewProfile } from "../src/profile.js";
import { formatProgressLine } from "../src/progress.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { completeTuiCommand, displayWidth, parseTuiInput, runTui } from "../src/tui.js";
import { productVersion } from "../src/version.js";

const cli = path.resolve("dist/src/cli.js");

async function fixture(run: (root: string, store: IndexStore, temp: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m36-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, temp); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

test("0.36 reprocess reasons stay on parse version 1 and do not treat VSD as text upgrade", () => {
  assert.equal(TEXT_PARSE_VERSION, 1);
  assert.equal(classifyReprocess({ rebuild: true, previous: null, extension: ".txt", sizeBytes: 1, modifiedAtMs: 1 }), "rebuild");
  assert.equal(classifyReprocess({ previous: null, extension: ".txt", sizeBytes: 1, modifiedAtMs: 1 }), "added");
  assert.equal(classifyReprocess({
    previous: { status: "indexed", parse_version: 1, size_bytes: 1, modified_at_ms: 1 },
    extension: ".txt", sizeBytes: 2, modifiedAtMs: 1,
  }), "source-changed");
  assert.equal(classifyReprocess({
    previous: { status: "error", parse_version: 1, size_bytes: 1, modified_at_ms: 1 },
    extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
  }), "error-retry");
  assert.equal(classifyReprocess({
    previous: { status: "indexed", parse_version: null, size_bytes: 1, modified_at_ms: 1 },
    extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
  }), "text-upgrade");
  assert.equal(classifyReprocess({
    previous: { status: "too_large", parse_version: null, size_bytes: 1, modified_at_ms: 1 },
    extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
  }), "unchanged");
  assert.equal(classifyReprocess({
    previous: { status: "unsupported", parse_version: null, size_bytes: 1, modified_at_ms: 1 },
    extension: ".vsd", sizeBytes: 1, modifiedAtMs: 1,
  }), "unsupported-retry");
  assert.equal(classifyReprocess({
    previous: { status: "indexed", parse_version: 1, size_bytes: 1, modified_at_ms: 1 },
    extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
  }), "unchanged");
});

test("0.36 progress names check phase, keeps heartbeat data and hides paths unless verbose", () => {
  const line = formatProgressLine({
    stage: "read", message: "檢查文件", current: 2, total: 10, checked: 2, skipped: 1, committed: 1,
    parserCalls: 1, failed: 0, phase: "讀取／解析", phaseStartedMs: 0, path: "/secret/a.txt",
    slow: { extension: ".txt", bytes: 10, phase: "讀取／解析", elapsedMs: 6000, reason: "新增" },
  }, { elapsedMs: 7000, nowMs: 1500, verbose: false });
  assert.match(line, /檢查進度/);
  assert.match(line, /已檢查 2、略過 1、已提交 1、parser 1、失敗 0/);
  assert.match(line, /慢檔 \.txt/);
  assert.doesNotMatch(line, /secret/);
  assert.match(formatProgressLine({ stage: "cancelled", message: "操作已取消" }, { elapsedMs: 1 }), /操作已取消/);
  assert.doesNotMatch(formatProgressLine({ stage: "cancelled", message: "操作已取消" }, { elapsedMs: 1 }), /100\.00%/);
});

test("0.36 terminal width treats CJK as two columns and completion does not hijack prose", () => {
  assert.equal(displayWidth("中文A"), 5);
  assert.equal(displayWidth("a"), 1);
  assert.deepEqual(completeTuiCommand("/he"), ["/help "]);
  assert.deepEqual(completeTuiCommand("中文"), []);
  assert.equal(parseTuiInput("./help").kind, "command");
  assert.equal(parseTuiInput("help").kind, "search");
  assert.equal(parseTuiInput("./notes").kind, "search");
  assert.equal(parseTuiInput("/madeup").kind, "unknown");
  assert.equal(parseTuiInput("/search ./help").kind, "command");
});

test("0.36 index reuses upgraded text, retries unsupported once, and keeps document id", () => fixture(async (root, store) => {
  const txt = path.join(root, "筆記.txt");
  const csv = path.join(root, "表.csv");
  await writeFile(txt, "沿用索引");
  await writeFile(csv, "名稱,值\n甲,乙");
  store.registerRoot(root);
  const info = await stat(csv);
  store.upsert({ path: csv, filename: "表.csv", extension: ".csv", sizeBytes: info.size, modifiedAtMs: info.mtimeMs,
    status: "unsupported", errorCode: "UNSUPPORTED_EXTENSION", errorMessage: null, blocks: [] }, root);
  const first = await sync(root, store);
  const id = store.getDocument(txt)!.id;
  assert.equal(first.reasonsAttempted["unsupported-retry"], 1);
  assert.equal(first.reasonsAttempted["text-upgrade"], 0);
  assert.equal(first.parserCalls, 2);
  assert.equal(store.mappingIndexReady(), true);
  assert.match(store.explainBlockLookup(), /document_payload_blocks_block_id/);
  assert.doesNotMatch(store.explainBlockLookup(), /SCAN document_payload_blocks/);
  let parsed = 0;
  const second = await sync(root, store, { parse: async file => { parsed++; return (await import("../src/parser.js")).parseDocument(file); } });
  assert.equal(parsed, 0);
  assert.equal(second.parserCalls, 0);
  assert.equal(second.unchanged, 2);
  assert.equal(second.reasonsCommitted.unchanged, 0);
  assert.equal(store.getDocument(txt)!.id, id);
  assert.equal(store.getDocument(txt)!.parse_version, 1);
}));

test("0.36 metadata-only files do not call the parser when only size changes", () => fixture(async (root, store) => {
  const bin = path.join(root, "畫面.mov");
  await writeFile(bin, "abcd");
  await sync(root, store);
  await writeFile(bin, "abcdef");
  let parsed = 0;
  const report = await sync(root, store, { parse: async file => { parsed++; return (await import("../src/parser.js")).parseDocument(file); } });
  assert.equal(parsed, 0);
  assert.equal(report.parserCalls, 0);
  assert.equal(report.reasonsAttempted["source-changed"], 1);
  assert.equal(store.getDocument(bin)?.size_bytes, 6);
}));

test("0.36 read-only legacy schema without parse_version stays readable", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m36-old-"));
  const database = path.join(temp, "index.db");
  const file = path.join(temp, "old.txt");
  try {
    const db = new DatabaseSync(database);
    db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
        extension TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_at_ms REAL NOT NULL,
        indexed_at_ms INTEGER NOT NULL, status TEXT NOT NULL, error_code TEXT, error_message TEXT);
      INSERT INTO documents (path, filename, extension, size_bytes, modified_at_ms, indexed_at_ms, status)
      VALUES ('${file.replaceAll("'", "''")}', 'old.txt', '.txt', 1, 1, 1, 'indexed');`);
    db.close();
    const store = new IndexStore(database, { readOnly: true });
    assert.equal(store.getDocument(file)?.parse_version ?? null, null);
    assert.equal(store.textUpgradePending().byExtension.find(item => item.extension === ".txt")?.count, 1);
    const status = store.formatStatus();
    assert.equal(status.textUpgradePending, 1);
    assert.equal(status.mappingIndexReady, false);
    store.close();
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("0.36 profile is anonymous, refuses overwrite, and is excluded from the index", () => fixture(async (root, store, temp) => {
  await writeFile(path.join(root, "a.txt"), "profile-body-secret");
  const profile = path.join(root, "report.json");
  reserveNewProfile(profile);
  assert.throws(() => reserveNewProfile(profile), /覆寫/);
  const report = await sync(root, store, { excludePaths: [profile, `${profile}.tmp`] });
  assert.equal(store.getDocument(profile), undefined);
  const built = (await import("../src/profile.js")).buildIndexProfile({
    status: "complete", found: report.found, checked: report.checked, updated: report.updated,
    unchanged: report.unchanged, removed: report.removed, parserCalls: report.parserCalls,
    failedDocuments: report.failedDocuments, reasonsAttempted: report.reasonsAttempted,
    reasonsCommitted: report.reasonsCommitted, formats: report.formats, sourceBytes: report.sourceBytes,
    blocks: 1, payloads: 1, mappings: 1, phasesMs: report.phasesMs, reservoir: report.sample,
    peakRssBytes: report.peakRssBytes, slowest: report.slowest,
  });
  assertProfileIsAnonymous(built);
  assert.equal(JSON.stringify(built).includes("profile-body-secret"), false);
  assert.equal(JSON.stringify(built).includes(root), false);
  const cliProfile = path.join(temp, "out.json");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temp, "data") };
  const run = spawnSync(process.execPath, [cli, "index", root, "--profile", cliProfile], { encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const saved = JSON.parse(await readFile(cliProfile, "utf8")) as { status: string; productVersion: string };
  assert.equal(saved.status, "complete");
  assert.equal(saved.productVersion, productVersion);
  assert.equal(JSON.stringify(saved).includes(root), false);
  const again = spawnSync(process.execPath, [cli, "index", root, "--profile", cliProfile], { encoding: "utf8", env });
  assert.equal(again.status, 2);
  assert.match(again.stderr, /覆寫/);
}));

test("0.36 CLI reuses one data directory and TUI quits without copying on /quit during confirm", () => fixture(async (root, store, temp) => {
  await writeFile(path.join(root, "共用.txt"), "同一個庫");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temp, "shared") };
  const first = spawnSync(process.execPath, [cli, "index", root], { encoding: "utf8", env });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /將建立新索引|既有索引/);
  assert.match(first.stdout, /索引位置：/);
  assert.match(first.stdout, /增量/);
  const second = spawnSync(process.execPath, [cli, "index", root], { encoding: "utf8", env });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /既有索引/);
  assert.match(second.stdout, /未變更略過=1/);
  assert.match(second.stdout, /解析器呼叫 0 次/);
  const status = spawnSync(process.execPath, [cli, "status"], { encoding: "utf8", env });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /儲存格式升級/);
  assert.match(status.stdout, /文字解析升級待處理/);
  await sync(root, store);
  const answers = ["同一個庫", "/select 1", "/context", "/quit"];
  const output: string[] = [];
  const copied: string[] = [];
  const code = await runTui(store, {
    ansi: true, write: value => output.push(value), ask: async () => answers.shift() ?? null, stopReason: () => "eof",
    size: () => ({ columns: 100, rows: 32 }),
  }, 5, async value => { copied.push(value); });
  assert.equal(code, 0);
  assert.equal(copied.length, 0);
  assert.match(output.join("\n"), /Seekah/);
  const smallOut: string[] = [];
  assert.equal(await runTui(store, {
    ansi: false, write: value => smallOut.push(value), ask: async () => "/quit", size: () => ({ columns: 40, rows: 12 }),
  }), 0);
  assert.match(smallOut.join("\n"), /\/help/);
  const sigint = await runTui(store, {
    ansi: true, write() {}, ask: async () => null, stopReason: () => "sigint", size: () => ({ columns: 80, rows: 24 }),
  });
  assert.equal(sigint, 130);
}));

test("0.36 real PTY settles Ctrl+C and EOF", { skip: process.platform === "win32" ? "Windows PTY harness 需在本機手動複驗" : false }, async () => {
  const python = spawnSync("python3", ["-c", "import pty"], { encoding: "utf8" });
  if (python.status !== 0) return;
  const harness = path.resolve("scripts/pty-tui-check.py");
  const envDir = path.join(os.tmpdir(), `lds-pty-${Date.now()}`);
  const docs = path.join(envDir, "docs");
  await mkdir(docs, { recursive: true });
  await writeFile(path.join(docs, "a.txt"), "pty");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(envDir, "data") };
  const indexed = spawnSync(process.execPath, [cli, "index", docs], { encoding: "utf8", env });
  assert.equal(indexed.status, 0, indexed.stderr);
  const interrupt = spawnSync("python3", [harness, process.execPath, cli, "int"], { encoding: "utf8", env, timeout: 8000 });
  assert.equal(interrupt.status, 0, `${interrupt.stderr}\n${interrupt.stdout}`);
  assert.match(interrupt.stderr, /EXIT:130/);
  assert.match(interrupt.stdout, /說明|\/help/);
  assert.match(interrupt.stdout, /\u001b\[\?1049l/);
  const eof = spawnSync("python3", [harness, process.execPath, cli, "eof"], { encoding: "utf8", env, timeout: 8000 });
  assert.equal(eof.status, 0, `${eof.stderr}\n${eof.stdout}`);
  assert.match(eof.stderr, /EXIT:0/);
  assert.match(eof.stdout, /\u001b\[\?1049l/);
});
