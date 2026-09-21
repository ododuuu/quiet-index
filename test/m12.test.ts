import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type fs from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { runWatch, resolveWatchRescan } from "../src/watch.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function setup(t: test.TestContext, unavailable = false) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m12-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  const file = path.join(root, "a.txt");
  await writeFile(file, "original text");
  const store = new IndexStore(path.join(temp, "index.db"));
  await sync(root, store);
  const stop = deferred();
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const logs: string[] = [];
  let nextId = 0;
  let attempts = 0;
  let closed = 0;
  let block: Promise<void> | undefined;
  let entered = deferred();
  let finished = deferred();
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const watchers: EventEmitter[] = [];
  const running = runWatch(store, [root], {
    rescanMs: 1000, debounceMs: 200, syncNow: false,
    watch: ((_root: unknown, _options: unknown, listener: (...args: unknown[]) => void) => {
      attempts++;
      if (unavailable) throw new Error("offline");
      const watcher = new EventEmitter() as EventEmitter & { close(): void };
      watcher.close = () => { closed++; };
      watcher.on("change", listener);
      watchers.push(watcher);
      return watcher;
    }) as unknown as typeof fs.watch,
    sync: async (...args) => {
      calls++; maxConcurrent = Math.max(maxConcurrent, ++concurrent);
      entered.resolve();
      try { if (block) await block; return await sync(...args); }
      finally { concurrent--; }
    },
    setTimer: (fn, ms) => {
      timers.set(++nextId, { fn, ms });
      return nextId as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: id => { timers.delete(id as unknown as number); },
  }, {
    waitForStop: () => stop.promise,
    write: line => {
      logs.push(line);
      if (line.startsWith("根目錄：") || line.startsWith("監看同步失敗：")) finished.resolve();
    },
  });
  t.after(async () => { stop.resolve(); await running; store.close(); await rm(temp, { recursive: true, force: true }); });
  await flush();
  const fire = () => {
    const entry = [...timers].find(([, timer]) => timer.ms === 1000);
    assert.ok(entry, "periodic timer is armed");
    timers.delete(entry[0]);
    entered = deferred(); finished = deferred();
    entry[1].fn();
  };
  return { root, file, store, temp, stop, timers, logs, running, watchers,
    attempts: () => attempts, closed: () => closed, calls: () => calls,
    maxConcurrent: () => maxConcurrent,
    available: () => { unavailable = false; },
    block: (promise: Promise<void>) => { block = promise; },
    entered: () => entered.promise,
    finished: async () => { await finished.promise; await flush(); },
    fire,
    tick: async () => { fire(); await finished.promise; await flush(); },
  };
}

test("M12 rescan defaults, bounds and CLI rejects invalid or repeated options", () => {
  assert.equal(resolveWatchRescan(undefined), 300000);
  for (const valid of [0, 1000, 3600000]) assert.equal(resolveWatchRescan(valid), valid);
  for (const invalid of [-1, 999, 3600001, NaN, 1.5]) {
    assert.throws(() => resolveWatchRescan(invalid), { code: "WATCH_RESCAN_INVALID" });
  }
  for (const args of [["--rescan"], ["--rescan", "999"], ["--rescan", "0", "--rescan", "1000"], ["--debounce", "200", "--debounce", "300"]]) {
    const result = spawnSync(process.execPath, ["dist/src/cli.js", "watch", ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stderr);
  }
});

test("M12 rescans missed modifications and deletions without re-parsing unchanged files", { timeout: 10000 }, async t => {
  const h = await setup(t);
  await h.tick();
  assert.equal(h.store.getLastSyncReport(h.root)?.summary?.parserCalls, 0);
  await writeFile(h.file, "missed notification new content");
  await h.tick();
  assert.equal(search(h.store, "new content").length, 1);
  await rm(h.file);
  await h.tick();
  assert.equal(search(h.store, "new content").length, 0);
  h.stop.resolve();
  assert.equal(await h.running, 0);
  assert.equal(h.timers.size, 0);
});

test("M12 offline fallback retains content and records failure, then recovers watcher and index", { timeout: 10000 }, async t => {
  const h = await setup(t, true);
  const moved = path.join(h.temp, "offline");
  const lastSuccess = h.store.getLastSyncReport(h.root)?.successfulAt;
  await rename(h.root, moved);
  await h.tick();
  assert.equal(search(h.store, "original text").length, 1);
  assert.equal(h.store.getLastSyncReport(h.root)?.complete, false);
  assert.equal(h.store.getLastSyncReport(h.root)?.successfulAt, lastSuccess);
  await rename(moved, h.root);
  await writeFile(h.file, "recovered content");
  h.available();
  await h.tick();
  assert.equal(search(h.store, "recovered content").length, 1);
  assert.equal(h.store.getLastSyncReport(h.root)?.complete, true);
  assert.match(h.logs.join("\n"), /降級定期掃描/);
  assert.match(h.logs.join("\n"), /監看恢復/);
  assert.ok(h.attempts() >= 3);
  h.stop.resolve();
  assert.equal(await h.running, 0);
});

test("M12 runtime watcher failure recovers on periodic correction", { timeout: 10000 }, async t => {
  const h = await setup(t);
  h.watchers[0]!.emit("error", new Error("lost watcher"));
  await h.tick();
  assert.equal(h.watchers.length, 2);
  assert.ok(h.closed() >= 1);
  h.stop.resolve();
  assert.equal(await h.running, 0);
});

test("M12 slow correction does not accumulate timers and stop drains active sync", { timeout: 10000 }, async t => {
  const h = await setup(t);
  const release = deferred();
  h.block(release.promise);
  h.fire();
  await h.entered();
  assert.equal(h.timers.size, 0);
  h.stop.resolve();
  await flush();
  release.resolve();
  assert.equal(await h.running, 0);
  assert.equal(h.maxConcurrent(), 1);
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 0);
});

test("M12 removed roots are not silently re-registered", { timeout: 10000 }, async t => {
  const h = await setup(t);
  h.store.removeRoot(h.root);
  h.fire();
  assert.equal(await h.running, 0);
  assert.deepEqual(h.store.roots(), []);
  assert.equal(h.calls(), 0);
  assert.equal(h.timers.size, 0);
});

test("M12 unresolved watcher failure is visible on stop", { timeout: 10000 }, async t => {
  const h = await setup(t, true);
  h.stop.resolve();
  assert.equal(await h.running, 3);
  assert.equal(h.timers.size, 0);
});

test("M12 events during correction merge into one follow-up with no overlapping sync", { timeout: 10000 }, async t => {
  const h = await setup(t);
  const release = deferred();
  h.block(release.promise);
  h.fire();
  await h.entered();
  h.watchers[0]!.emit("change", "change", "a.txt");
  h.watchers[0]!.emit("change", "change", "a.txt");
  assert.equal(h.timers.size, 0);
  release.resolve();
  await h.finished();
  assert.equal([...h.timers.values()].filter(timer => timer.ms === 200).length, 1);
  // 校正先到期時，已排程的事件同步會合併到同一次掃描。
  await h.tick();
  assert.equal(h.calls(), 2);
  assert.equal(h.maxConcurrent(), 1);
  assert.equal([...h.timers.values()].filter(timer => timer.ms === 200).length, 0);
});
