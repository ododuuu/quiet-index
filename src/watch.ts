import { IndexBusyError } from "./write-lock.js";
import fs from "node:fs";
import path from "node:path";
import type { sync, SyncOptions, SyncReport } from "./sync.js";
import type { IndexStore } from "./store.js";
import type { ProgressUpdate } from "./progress.js";

export class WatchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "WatchError"; }
}

export interface WatchIO {
  write(text: string): void;
  waitForStop(): Promise<void>;
}

export interface WatchOptions {
  debounceMs?: number;
  rescanMs?: number;
  verbose?: boolean;
  syncNow?: boolean;
  watch?: typeof fs.watch;
  sync?: typeof sync;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

const IGNORED_SEGMENT = /(?:^|[\\/])(?:\.git|node_modules|\.localdocsearch)(?:[\\/]|$)/i;

export function shouldIgnoreWatchPath(relativeOrAbsolute: string): boolean {
  const normalized = relativeOrAbsolute.replace(/\\/g, "/");
  if (IGNORED_SEGMENT.test(normalized)) return true;
  const base = path.posix.basename(normalized);
  return base.startsWith("~$");
}

export function resolveWatchDebounce(ms: number | undefined): number {
  const value = ms ?? 1500;
  if (!Number.isSafeInteger(value) || value < 200 || value > 60_000) {
    throw new WatchError("WATCH_DEBOUNCE_INVALID", "--debounce 必須是 200～60000 的整數毫秒。");
  }
  return value;
}

export function resolveWatchRescan(ms: number | undefined): number {
  const value = ms ?? 300_000;
  if (!Number.isSafeInteger(value) || (value !== 0 && (value < 1000 || value > 3_600_000))) {
    throw new WatchError("WATCH_RESCAN_INVALID", "--rescan 必須是 1000～3600000 的整數毫秒，或 0 關閉。");
  }
  return value;
}

type RootState = {
  root: string;
  dirty: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  watcher?: fs.FSWatcher;
  failed: boolean;
  syncFailed: boolean;
  removed: boolean;
  rescanTimer: ReturnType<typeof setTimeout> | undefined;
};

export async function runWatch(
  store: IndexStore,
  roots: readonly string[],
  options: WatchOptions,
  io: WatchIO,
): Promise<number> {
  if (!roots.length) throw new WatchError("WATCH_NO_ROOTS", "沒有可監看的根目錄；請先執行 index <root>。");
  const debounceMs = resolveWatchDebounce(options.debounceMs);
  const rescanMs = resolveWatchRescan(options.rescanMs);
  const watchFn = options.watch ?? fs.watch;
  const syncFn = options.sync ?? (await import("./sync.js")).sync;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const syncOptions: SyncOptions = { requireRegistered: true, ...(options.onProgress ? { onProgress: options.onProgress } : {}) };
  const states = new Map<string, RootState>();
  const active = new Set<Promise<void>>();
  let stopping = false;
  let allFailed!: () => void;
  const failed = new Promise<void>(resolve => { allFailed = resolve; });
  const stop = Promise.resolve().then(() => io.waitForStop()).finally(() => { stopping = true; });

  const printReport = (report: SyncReport) => {
    io.write(`根目錄：${report.root}；更新 ${report.updated}、未變更 ${report.unchanged}、移除 ${report.removed}；耗時 ${report.elapsedMs} ms；完整：${report.complete ? "是" : "否"}`);
    if (options.verbose) {
      for (const notice of report.notices) io.write(`提示：${notice}`);
      for (const error of report.errors) io.write(`文件問題：${error}`);
    }
  };

  const runRoot = async (state: RootState) => {
    if (stopping || state.removed || (state.failed && !rescanMs)) return;
    if (!store.roots().includes(state.root)) {
      state.removed = true;
      if (state.timer) clearTimer(state.timer);
      if (state.rescanTimer) clearTimer(state.rescanTimer);
      state.watcher?.close();
      io.write(`已停止監看移除的根目錄：${state.root}`);
      if ([...states.values()].every(item => item.removed)) allFailed();
      return;
    }
    if (state.running) { state.dirty = true; return; }
    state.running = true;
    state.dirty = false;
    if (state.timer) clearTimer(state.timer);
    state.timer = undefined;
    if (state.rescanTimer) clearTimer(state.rescanTimer);
    state.rescanTimer = undefined;
    if (state.failed) attach(state);
    try {
      const report = await syncFn(state.root, store, syncOptions);
      state.syncFailed = !report.complete;
      printReport(report);
    } catch (error) {
      state.syncFailed = true;
      if (error instanceof IndexBusyError) {
        io.write(`INDEX_BUSY：${state.root}：稍後重試同步。`);
        state.dirty = true;
      } else {
        io.write(`監看同步失敗：${state.root}：根目錄同步失敗，保留既有索引`);
      }
    } finally {
      state.running = false;
      if (state.dirty) schedule(state);
      armRescan(state);
    }
  };

  const schedule = (state: RootState) => {
    if (stopping || state.removed || (state.failed && !rescanMs)) return;
    state.dirty = true;
    if (state.running) return;
    if (state.timer) clearTimer(state.timer);
    state.timer = setTimer(() => {
      state.timer = undefined;
      launch(state);
    }, debounceMs);
  };

  const armRescan = (state: RootState) => {
    if (!rescanMs || stopping || state.removed || state.running) return;
    if (state.rescanTimer) clearTimer(state.rescanTimer);
    state.rescanTimer = setTimer(() => {
      state.rescanTimer = undefined;
      if (options.verbose) io.write(`定期校正：${state.root}`);
      void launch(state);
    }, rescanMs);
  };

  const launch = (state: RootState): Promise<void> => {
    const task = runRoot(state);
    active.add(task);
    void task.finally(() => active.delete(task));
    return task;
  };

  for (const root of roots) {
    states.set(root, { root, dirty: false, running: false, timer: undefined, failed: false, syncFailed: false, removed: false, rescanTimer: undefined });
  }

  const failRoot = (state: RootState, error: unknown) => {
    if (state.failed || stopping) return;
    state.failed = true;
    if (state.timer) clearTimer(state.timer);
    state.timer = undefined;
    try { state.watcher?.close(); } catch { /* 已失效的監看器仍需清理 */ }
    io.write(`監看錯誤：${state.root}：${error instanceof Error ? error.message : "未知錯誤"}`);
    if (rescanMs) {
      io.write(`降級定期掃描：${state.root}（${rescanMs} ms 後校正並重試監看）`);
      armRescan(state);
    } else if ([...states.values()].every(item => item.failed || item.removed)) allFailed();
  };

  const attach = (state: RootState) => {
    const recovering = state.failed;
    try {
      const watcher = watchFn(state.root, { recursive: true }, (_event, filename) => {
        if (stopping || state.failed || state.removed) return;
        const label = filename ? String(filename) : "";
        if (label && shouldIgnoreWatchPath(label)) return;
        if (options.verbose) io.write(`變更：${state.root}${label ? path.sep + label : ""} @${now()}`);
        schedule(state);
      });
      state.watcher = watcher;
      state.failed = false;
      watcher.on("error", error => failRoot(state, error));
      io.write(`${recovering ? "監看恢復" : "監看中"}：${state.root}（防抖 ${debounceMs} ms）`);
    } catch (error) {
      // 已失效的監看器重試仍失敗時，不重複輸出相同降級訊息。
      if (!state.failed) failRoot(state, error);
    }
  };

  try {
    for (const state of states.values()) attach(state);
    if (!rescanMs && [...states.values()].every(state => state.failed)) {
      throw new WatchError("WATCH_ALL_FAILED", "所有根目錄都無法監看。");
    }

    if (options.syncNow !== false) {
      for (const state of states.values()) {
        if (stopping) break;
        if (state.failed && !rescanMs) continue;
        io.write(`啟動同步：${state.root}`);
        await launch(state);
      }
    }
    for (const state of states.values()) armRescan(state);
    io.write(rescanMs ? `定期校正間隔：${rescanMs} ms（同步完成後起算）。` : "定期校正已關閉。");
    io.write("按 Ctrl+C 結束監看。");
    await Promise.race([stop, failed]);
  } finally {
    stopping = true;
    for (const state of states.values()) {
      if (state.timer) clearTimer(state.timer);
      if (state.rescanTimer) clearTimer(state.rescanTimer);
      try { state.watcher?.close(); } catch { /* ignore */ }
    }
    await Promise.allSettled(active);
  }
  return [...states.values()].some(state => !state.removed && (state.failed || state.syncFailed)) ? 3 : 0;
}
