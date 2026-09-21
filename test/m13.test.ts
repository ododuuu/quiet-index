import assert from "node:assert/strict";
import test from "node:test";
import { once, EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import type fs from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IndexStore } from "../src/store.js";
import { acquireWriteLock, IndexBusyError } from "../src/write-lock.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { runWatch } from "../src/watch.js";

async function fixture(t: test.TestContext) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m13-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  await writeFile(path.join(root, "a.txt"), "committed original content");
  const data = path.join(temp, "data");
  const store = new IndexStore(path.join(data, "LocalDocSearch", "index.db"));
  await sync(root, store);
  t.after(async () => { store.close(); await rm(temp, { recursive: true, force: true }); });
  return { root, store, temp, data };
}

async function holder(databasePath: string) {
  const code = `
    import { acquireWriteLock } from ${JSON.stringify(new URL("../src/write-lock.js", import.meta.url).href)};
    const release = acquireWriteLock(process.argv[1]);
    console.log("READY");
    process.stdin.resume();
    process.stdin.on("data", () => { release(); process.exit(0); });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, databasePath], { stdio: ["pipe", "pipe", "pipe"] });
  const result = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => String(chunk)),
    once(child, "exit").then(([code]) => { throw new Error(`holder exited ${code}`); }),
  ]);
  assert.match(result, /READY/);
  return child;
}

async function terminate(child: ReturnType<typeof spawn>, force = false) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (force) child.kill("SIGKILL");
  else child.stdin!.write("release\n");
  await exited;
}

test("M13 another process blocks sync, rebuild and removal while reads stay available", { timeout: 30000 }, async t => {
  const h = await fixture(t);
  const child = await holder(h.store.databasePath);
  try {
    const previous = h.store.getLastSyncReport(h.root);
    for (const rebuild of [false, true]) {
      const started = performance.now();
      await assert.rejects(sync(h.root, h.store, { rebuild }), { code: "INDEX_BUSY" });
      assert.ok(performance.now() - started < 1000, "寫入鎖競爭應在一秒內回報 INDEX_BUSY");
    }
    const removeStarted = performance.now();
    assert.throws(() => h.store.removeRoot(h.root), { code: "INDEX_BUSY" });
    assert.ok(performance.now() - removeStarted < 1000, "移除根目錄應在一秒內回報 INDEX_BUSY");
    assert.equal(search(h.store, "original").length, 1);
    assert.deepEqual(h.store.getLastSyncReport(h.root), previous);
    const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: h.data };
    for (const args of [["index", h.root], ["rebuild"], ["roots", "remove", h.root]]) {
      const result = spawnSync(process.execPath, ["dist/src/cli.js", ...args], { env, encoding: "utf8", timeout: 5000 });
      assert.equal(result.error, undefined, `CLI 寫入鎖競爭不應逾時：${result.error?.message ?? ""}`);
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, /INDEX_BUSY/);
    }
    for (const args of [["search", "original"], ["status"]]) {
      const result = spawnSync(process.execPath, ["dist/src/cli.js", ...args], { env, encoding: "utf8", timeout: 5000 });
      assert.equal(result.error, undefined, `CLI 讀取不應逾時：${result.error?.message ?? ""}`);
      assert.equal(result.status, 0, result.stderr);
    }
  } finally { await terminate(child); }
  await sync(h.root, h.store);
});

test("M13 OS releases a killed holder without deleting coordination files", { timeout: 10000 }, async t => {
  const h = await fixture(t);
  const child = await holder(h.store.databasePath);
  await terminate(child, true);
  await writeFile(path.join(h.root, "a.txt"), "after abrupt process exit");
  const report = await sync(h.root, h.store);
  assert.equal(report.updated, 1);
  assert.equal(search(h.store, "abrupt").length, 1);
});

test("M13 errors release the lock and different indexes remain independent", async t => {
  const h = await fixture(t);
  await assert.rejects(sync(h.root, h.store, { scan: async () => { throw new Error("test failure"); } }));
  const release = acquireWriteLock(h.store.databasePath);
  try {
    assert.throws(() => acquireWriteLock(h.store.databasePath), IndexBusyError);
    const other = new IndexStore(path.join(h.temp, "other.db"));
    try { assert.equal((await sync(h.root, other)).updated, 1); } finally { other.close(); }
  } finally { release(); release(); }
  assert.equal((await sync(h.root, h.store)).unchanged, 1);
});

test("M13 symlink database aliases share the same writer lock", { skip: process.platform === "win32" }, async t => {
  const h = await fixture(t);
  const alias = path.join(h.temp, "alias.db");
  await symlink(h.store.databasePath, alias);
  const release = acquireWriteLock(h.store.databasePath);
  try { assert.throws(() => acquireWriteLock(alias), { code: "INDEX_BUSY" }); }
  finally { release(); }
});

test("M13 registered-only sync cannot recreate a removed root", async t => {
  const h = await fixture(t);
  h.store.removeRoot(h.root);
  await assert.rejects(sync(h.root, h.store, { requireRegistered: true }), /已移除/);
  await assert.rejects(sync(h.root, h.store, { rebuild: true }), /已移除/);
  assert.deepEqual(h.store.roots(), []);
  await sync(h.root, h.store);
  assert.equal(h.store.roots().length, 1);
});

test("M13 watch retries busy writes even with periodic correction disabled", { timeout: 10000 }, async t => {
  const h = await fixture(t);
  const release = acquireWriteLock(h.store.databasePath);
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = resolve; });
  const before = h.store.getLastSyncReport(h.root);
  let sawBusy = false;
  const watcher = new EventEmitter() as EventEmitter & { close(): void };
  watcher.close = () => {};
  const running = runWatch(h.store, [h.root], {
    rescanMs: 0, debounceMs: 200,
    watch: (() => watcher) as unknown as typeof fs.watch,
  }, {
    waitForStop: () => stopped,
    write: line => {
      if (line.startsWith("INDEX_BUSY")) {
        sawBusy = true;
        assert.deepEqual(h.store.getLastSyncReport(h.root), before);
        release();
      }
      if (line.startsWith("根目錄：")) stop();
    },
  });
  try { assert.equal(await running, 0); assert.equal(sawBusy, true); }
  finally { release(); stop(); }
});

test("M13 the lock spans scanning through final index commit", { timeout: 10000 }, async t => {
  const h = await fixture(t);
  const { scan } = await import("../src/scanner.js");
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await writeFile(path.join(h.root, "a.txt"), "new content after scan");
  const pending = sync(h.root, h.store, { scan: async root => {
    entered(); await gate; return scan(root);
  } });
  await started;
  try {
    assert.throws(() => h.store.removeRoot(h.root), { code: "INDEX_BUSY" });
    await assert.rejects(sync(h.root, h.store), { code: "INDEX_BUSY" });
    assert.equal(search(h.store, "original").length, 1);
  } finally { resume(); await pending; }
  assert.equal(search(h.store, "after scan").length, 1);
  assert.equal(h.store.removeRoot(h.root), 1);
});
