import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type fs from "node:fs";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { runWatch, shouldIgnoreWatchPath, resolveWatchDebounce, WatchError } from "../src/watch.js";
import { applyFileUpdate } from "../src/local-update.js";

test("M11 ignore rules skip editor and VCS noise", () => {
  assert.equal(shouldIgnoreWatchPath(".git/HEAD"), true);
  assert.equal(shouldIgnoreWatchPath("node_modules/pkg/index.js"), true);
  assert.equal(shouldIgnoreWatchPath(".localdocsearch/tmp"), true);
  assert.equal(shouldIgnoreWatchPath("~$草稿.docx"), true);
  assert.equal(shouldIgnoreWatchPath("合約.docx"), false);
});

test("M11 debounce bounds", () => {
  assert.equal(resolveWatchDebounce(undefined), 1500);
  assert.equal(resolveWatchDebounce(200), 200);
  assert.throws(() => resolveWatchDebounce(199), { code: "WATCH_DEBOUNCE_INVALID" });
  assert.throws(() => resolveWatchDebounce(60001), { code: "WATCH_DEBOUNCE_INVALID" });
});

test("M11 watch debounces and syncs the dirty root once", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m11-"));
  const root = path.join(temp, "docs"); await mkdir(root);
  await writeFile(path.join(root, "a.txt"), "第一版");
  const store = new IndexStore(path.join(temp, "index.db"));
  await sync(root, store);
  const registered = store.roots()[0]!;

  const syncCalls: string[] = [];
  const emitters = new Map<string, EventEmitter & { close(): void }>();
  const timers: Array<{ id: number; ms: number; fn: () => void }> = [];
  let timerId = 1;
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = resolve; });

  const fakeWatch = ((watchPath: fs.PathLike, opts: unknown, listener?: (event: fs.WatchEventType, filename: string | null) => void) => {
    const emitter = new EventEmitter() as EventEmitter & { close(): void };
    emitter.close = () => emitter.removeAllListeners();
    const cb = (typeof opts === "function" ? opts : listener) as (event: fs.WatchEventType, filename: string | null) => void;
    emitter.on("change", (event, filename) => cb(event as fs.WatchEventType, filename as string | null));
    emitters.set(String(watchPath), emitter);
    return emitter as unknown as fs.FSWatcher;
  }) as typeof fs.watch;

  const logs: string[] = [];
  let watching!: () => void;
  const ready = new Promise<void>(resolve => { watching = resolve; });
  const running = runWatch(store, [registered], {
    debounceMs: 200, rescanMs: 0,
    syncNow: false,
    verbose: true,
    watch: fakeWatch,
    sync: async (rootPath, indexStore, syncOptions) => {
      const report = await sync(rootPath, indexStore, syncOptions);
      syncCalls.push(rootPath);
      return report;
    },
    setTimer: (fn, ms) => {
      const id = timerId++;
      timers.push({ id, ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: id => {
      const index = timers.findIndex(item => item.id === (id as unknown as number));
      if (index >= 0) timers.splice(index, 1);
    },
  }, {
    write: text => {
      logs.push(text);
      if (text.startsWith("監看中：")) watching();
    },
    waitForStop: () => stopped,
  });

  await ready;
  await writeFile(path.join(root, "a.txt"), "第二版 關鍵字");
  const emitter = emitters.get(registered);
  assert.ok(emitter, "watcher should be registered");
  emitter.emit("change", "change", "a.txt");
  emitter.emit("change", "change", "a.txt");
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.ms, 200);
  const pending = timers.shift()!;
  const updated = new Promise<void>((resolve, reject) => {
    const start = Date.now();
    pending.fn();
    const check = () => {
      if (search(store, "關鍵字").length) resolve();
      else if (Date.now() - start > 5000) reject(new Error("local update did not become searchable"));
      else setImmediate(check);
    };
    check();
  });
  await updated;
  assert.equal(syncCalls.length, 0, "file events must not run a full-root sync");
  assert.equal(search(store, "關鍵字").length, 1);

  emitter.emit("change", "change", ".git/HEAD");
  assert.equal(timers.length, 0);

  stop();
  assert.equal(await running, 0);
  store.close();
  await rm(temp, { recursive: true, force: true });
  assert.match(logs.join("\n"), /監看中/);
});

test("M11 refuses empty roots", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m11-empty-"));
  const store = new IndexStore(path.join(temp, "index.db"));
  await assert.rejects(runWatch(store, [], { syncNow: false }, {
    write: () => {},
    waitForStop: async () => {},
  }), (error: WatchError) => error.code === "WATCH_NO_ROOTS");
  store.close();
  await rm(temp, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function lifecycle(t: test.TestContext) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-watch-life-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  await writeFile(path.join(root, "a.txt"), "watch lifecycle");
  const store = new IndexStore(path.join(temp, "index.db"));
  await sync(root, store);
  t.after(async () => { store.close(); await rm(temp, { recursive: true, force: true }); });
  const stop = deferred();
  const entered = deferred();
  const release = deferred();
  const ready = deferred();
  const watcher = new EventEmitter() as EventEmitter & { close(): void };
  let closed = false;
  watcher.close = () => { closed = true; };
  let calls = 0;
  let localCalls = 0;
  const timers = new Map<number, () => void>();
  let id = 0;
  const options = {
    rescanMs: 0,
    watch: ((_root: unknown, _opts: unknown, listener: (...args: unknown[]) => void) => {
      watcher.on("change", listener);
      return watcher;
    }) as unknown as typeof fs.watch,
    sync: (async (...args: Parameters<typeof sync>) => {
      calls++;
      if (calls === 1) { entered.resolve(); await release.promise; }
      return sync(...args);
    }) as typeof sync,
    applyFileUpdate: (async (...args: Parameters<typeof applyFileUpdate>) => {
      localCalls++;
      if (localCalls === 1) { entered.resolve(); await release.promise; }
      return applyFileUpdate(...args);
    }) as typeof applyFileUpdate,
    setTimer: (fn: () => void) => { timers.set(++id, fn); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer as unknown as number); },
  };
  const io = {
    write: (text: string) => { if (text.startsWith("按 Ctrl+C")) ready.resolve(); },
    waitForStop: () => stop.promise,
  };
  return { store, root, stop, entered, release, ready, watcher, options, io, timers,
    calls: () => calls, localCalls: () => localCalls, closed: () => closed };
}

test("M11 startup events survive initial sync and trigger one follow-up", async t => {
  const h = await lifecycle(t);
  const running = runWatch(h.store, [h.root], h.options, h.io);
  await h.entered.promise;
  h.watcher.emit("change", "change", "a.txt");
  h.watcher.emit("change", "rename", "b.txt");
  assert.equal(h.timers.size, 0, "events during sync only mark dirty");
  h.release.resolve();
  await h.ready.promise;
  assert.equal(h.timers.size, 1);
  const [id, callback] = [...h.timers][0]!;
  h.timers.delete(id); callback();
  h.stop.resolve();
  assert.equal(await running, 0);
  assert.equal(h.calls(), 1);
  assert.ok(h.localCalls() >= 1);
  assert.ok(h.closed());
});

test("M11 stop waits for active writes and prevents queued or late work", async t => {
  const h = await lifecycle(t);
  const running = runWatch(h.store, [h.root], { ...h.options, syncNow: false }, h.io);
  await h.ready.promise;
  h.watcher.emit("change", "change", "a.txt");
  const [id, callback] = [...h.timers][0]!;
  h.timers.delete(id); callback();
  await h.entered.promise;
  h.watcher.emit("change", "change", "a.txt");
  h.stop.resolve();
  let settled = false;
  void running.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(h.closed());
  assert.equal(settled, false);
  h.watcher.emit("change", "change", "a.txt");
  h.release.resolve();
  assert.equal(await running, 0);
  assert.equal(h.localCalls(), 1);
  assert.equal(h.calls(), 0);
  assert.equal(h.timers.size, 0);
});

test("M11 last watcher failure ends automatically with nonzero status", async t => {
  const h = await lifecycle(t);
  const running = runWatch(h.store, [h.root], { ...h.options, syncNow: false }, h.io);
  await h.ready.promise;
  h.watcher.emit("change", "change", "a.txt");
  h.watcher.emit("error", new Error("watch unavailable"));
  assert.equal(await running, 3);
  assert.ok(h.closed());
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls(), 0);
  h.stop.resolve();
});

test("M11 native watcher updates searchable text before graceful stop", { timeout: 15000 }, async t => {
  const h = await lifecycle(t);
  const initial = deferred();
  const updated = deferred();
  let reports = 0;
  const running = runWatch(h.store, [h.root], { debounceMs: 200, rescanMs: 0 }, {
    write: text => {
      if (!text.startsWith("根目錄：")) return;
      if (++reports === 1) initial.resolve();
      else if (search(h.store, "native watcher revision").length) updated.resolve();
    },
    waitForStop: () => h.stop.promise,
  });
  t.after(() => h.stop.resolve());
  try {
    await initial.promise;
    await writeFile(path.join(h.root, "a.txt"), "native watcher revision");
    await updated.promise;
    assert.equal(search(h.store, "native watcher revision").length, 1);
  } finally {
    h.stop.resolve();
    assert.equal(await running, 0);
  }
});

test("M11 partial watcher failure preserves the healthy root", async t => {
  const h = await lifecycle(t);
  const healthy = new EventEmitter() as EventEmitter & { close(): void };
  let healthyClosed = false;
  healthy.close = () => { healthyClosed = true; };
  const watch = ((root: string) => {
    if (root === "missing-root") throw new Error("unavailable");
    return healthy;
  }) as unknown as typeof fs.watch;
  const running = runWatch(h.store, ["missing-root", h.root], {
    ...h.options, watch, syncNow: false,
  }, h.io);
  await h.ready.promise;
  assert.equal(healthyClosed, false);
  h.stop.resolve();
  assert.equal(await running, 3);
  assert.equal(healthyClosed, true);
});

test("M11 all startup watcher failures reject without running sync", async t => {
  const h = await lifecycle(t);
  await assert.rejects(runWatch(h.store, [h.root], {
    ...h.options,
    watch: (() => { throw new Error("unavailable"); }) as typeof fs.watch,
  }, h.io), { code: "WATCH_ALL_FAILED" });
  assert.equal(h.calls(), 0);
  h.stop.resolve();
});
