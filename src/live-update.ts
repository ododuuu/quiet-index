import fs from "node:fs";
import path from "node:path";
import { acquireWriteLock, IndexBusyError } from "./write-lock.js";
import { IGNORE_FILE, IgnoreConfigurationError } from "./ignore.js";
import type { IndexStore } from "./store.js";
import { sync, type SyncOptions, type SyncReport } from "./sync.js";
import { applyPathChange, applyFileDelete, applyFileUpdate, isIgnoreFile, WRITER_BACKOFF_MS, type LocalUpdateOptions } from "./local-update.js";
import { coversPath, samePath } from "./root-plan.js";
import { RootError } from "./scanner.js";
import { OperationCancelledError, type ProgressUpdate } from "./progress.js";
import { shouldIgnoreWatchPath } from "./watch-path.js";
import type { LiveMode, LivePhase, LiveRootStatus, LiveStatus, RootWatchState } from "./autoupdate-control.js";

export const DEFAULT_DEBOUNCE_MS = 1500;
export const DEFAULT_WATCH_RESCAN_MS = 300_000;
export const DEFAULT_RECONCILE_MS = 21_600_000;
export const QUEUE_LIMIT = 10_000;
export const HEARTBEAT_MS = 10_000;
export const ROOT_REFRESH_MS = 10_000;
export const WATCHER_RETRY_MS = [60_000, 300_000, 900_000] as const;

export interface LiveIO {
  write(text: string): void;
  waitForStop(): Promise<void>;
}

export interface LiveUpdateOptions {
  mode: LiveMode;
  debounceMs?: number;
  reconcileMs?: number;
  verbose?: boolean;
  syncNow?: boolean;
  watch?: typeof fs.watch;
  sync?: typeof sync;
  applyFileUpdate?: typeof applyFileUpdate;
  applyFileDelete?: typeof applyFileDelete;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (update: ProgressUpdate) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  instanceId?: string;
  startedAt?: string;
}

type RootState = {
  root: string;
  pending: Set<string>;
  reconcile: boolean;
  dirty: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  watcher?: fs.FSWatcher;
  failed: boolean;
  offline: boolean;
  syncFailed: boolean;
  removed: boolean;
  rescanTimer: ReturnType<typeof setTimeout> | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  retryAttempt: number;
  busyAttempt: number;
  lastError?: string;
  lastEventAt?: string;
  lastLocalUpdateAt?: string;
  lastReconcileAt?: string;
};

export class WatchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "WatchError"; }
}

export function resolveWatchDebounce(ms: number | undefined): number {
  const value = ms ?? DEFAULT_DEBOUNCE_MS;
  if (!Number.isSafeInteger(value) || value < 200 || value > 60_000) {
    throw new WatchError("WATCH_DEBOUNCE_INVALID", "--debounce 必須是 200～60000 的整數毫秒。");
  }
  return value;
}

export function resolveWatchRescan(ms: number | undefined): number {
  const value = ms ?? DEFAULT_WATCH_RESCAN_MS;
  if (!Number.isSafeInteger(value) || (value !== 0 && (value < 1000 || value > 3_600_000))) {
    throw new WatchError("WATCH_RESCAN_INVALID", "--rescan 必須是 1000～3600000 的整數毫秒，或 0 關閉。");
  }
  return value;
}

export function resolveAutoupdateReconcile(ms: number | undefined): number {
  const value = ms ?? DEFAULT_RECONCILE_MS;
  if (!Number.isSafeInteger(value) || value < 900_000 || value > 86_400_000) {
    throw new WatchError("AUTOUPDATE_RECONCILE_INVALID", "--reconcile 必須是 900000～86400000 的整數毫秒。");
  }
  return value;
}

function absorb(pending: Set<string>, candidate: string): void {
  for (const existing of pending) {
    if (samePath(existing, candidate) || coversPath(existing, candidate)) return;
  }
  for (const existing of [...pending]) {
    if (coversPath(candidate, existing)) pending.delete(existing);
  }
  pending.add(candidate);
}

export class LiveUpdateEngine {
  private readonly states = new Map<string, RootState>();
  private readonly active = new Set<Promise<void>>();
  private readonly readyQueue: string[] = [];
  private stopping = false;
  private running = false;
  private phase: LivePhase = "starting";
  private lastHeartbeatAt: string;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEvent?: { at: string; root: string };
  private lastLocalUpdate?: { at: string; root: string; path: string };
  private lastReconcile?: { at: string; root: string; complete: boolean };
  private readonly recentErrors: string[] = [];
  private allFailed!: () => void;
  private readonly failed: Promise<void>;
  readonly abort: AbortController;
  logError = false;

  constructor(
    private readonly store: IndexStore,
    roots: readonly string[],
    private readonly options: LiveUpdateOptions,
    private readonly io: LiveIO,
  ) {
    this.lastHeartbeatAt = new Date(this.now()).toISOString();
    this.abort = new AbortController();
    this.failed = new Promise<void>(resolve => { this.allFailed = resolve; });
    for (const root of roots) this.states.set(root, this.newState(root));
    options.signal?.addEventListener("abort", () => this.requestStop(), { once: true });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get debounceMs(): number {
    return resolveWatchDebounce(this.options.debounceMs);
  }

  private get reconcileMs(): number {
    return this.options.mode === "background"
      ? resolveAutoupdateReconcile(this.options.reconcileMs)
      : resolveWatchRescan(this.options.reconcileMs);
  }

  private get setTimer(): (fn: () => void, ms: number) => ReturnType<typeof setTimeout> {
    return this.options.setTimer ?? setTimeout;
  }

  private get clearTimer(): (id: ReturnType<typeof setTimeout>) => void {
    return this.options.clearTimer ?? clearTimeout;
  }

  private log(line: string): void {
    this.io.write(line);
    this.options.onLog?.(line);
  }

  private rememberError(code: string, message: string): void {
    this.recentErrors.push(`${code}: ${message}`);
    if (this.recentErrors.length > 20) this.recentErrors.shift();
  }

  private newState(root: string): RootState {
    return {
      root, pending: new Set(), reconcile: false, dirty: false, running: false,
      timer: undefined, failed: false, offline: false, syncFailed: false, removed: false,
      rescanTimer: undefined, retryTimer: undefined, retryAttempt: 0, busyAttempt: 0,
    };
  }

  snapshot(): LiveStatus {
    const roots: LiveRootStatus[] = [...this.states.values()].map(state => ({
      path: state.root,
      watch: this.watchState(state),
      pending: state.pending.size + (state.reconcile ? 1 : 0),
      ...(state.lastError ? { lastError: state.lastError } : {}),
    }));
    return {
      schemaVersion: 1,
      instanceId: this.options.instanceId ?? "",
      pid: process.pid,
      mode: this.options.mode,
      startedAt: this.options.startedAt ?? this.lastHeartbeatAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      phase: this.phase,
      settings: { debounceMs: this.debounceMs, reconcileMs: this.reconcileMs },
      ready: this.phase !== "starting",
      roots,
      pendingCount: roots.reduce((sum, item) => sum + item.pending, 0),
      ...(this.lastEvent ? { lastEvent: this.lastEvent } : {}),
      ...(this.lastLocalUpdate ? { lastLocalUpdate: this.lastLocalUpdate } : {}),
      ...(this.lastReconcile ? { lastReconcile: this.lastReconcile } : {}),
      recentErrors: [...this.recentErrors],
      ...(this.logError ? { logError: "AUTOUPDATE_LOG_ERROR" as const } : {}),
    };
  }

  private watchState(state: RootState): RootWatchState {
    if (state.removed) return "removed";
    if (state.offline) return "offline";
    if (state.failed) return "degraded";
    return "active";
  }

  requestStop(): void {
    this.stopping = true;
    this.phase = "stopping";
    this.abort.abort();
    this.allFailed();
  }

  private enqueueReady(root: string): void {
    if (this.stopping) return;
    if (!this.readyQueue.includes(root)) this.readyQueue.push(root);
    this.pump();
  }

  private pump(): void {
    if (this.stopping || this.running) return;
    const root = this.readyQueue.shift();
    if (!root) {
      this.phase = "idle";
      return;
    }
    const state = this.states.get(root);
    if (!state || state.removed) {
      this.pump();
      return;
    }
    this.launch(state);
  }

  private launch(state: RootState): Promise<void> {
    this.running = true;
    const task = this.runRoot(state);
    this.active.add(task);
    void task.finally(() => {
      this.active.delete(task);
      this.running = false;
      if (!this.stopping) this.pump();
    });
    return task;
  }

  private printReport(report: SyncReport): void {
    this.log(`根目錄：${report.root}；更新 ${report.updated}、未變更 ${report.unchanged}、移除 ${report.removed}；耗時 ${report.elapsedMs} ms；完整：${report.complete ? "是" : "否"}`);
    if (this.options.verbose) {
      for (const notice of report.notices) this.log(`提示：${notice}`);
      for (const error of report.errors) this.log(`文件問題：${error}`);
    }
  }

  private printLocal(root: string, updated: number, unchanged: number, removed: number, elapsedMs: number, complete: boolean): void {
    this.log(`根目錄：${root}；更新 ${updated}、未變更 ${unchanged}、移除 ${removed}；耗時 ${elapsedMs} ms；完整：${complete ? "是" : "否"}`);
  }

  private syncFn(): typeof sync {
    return this.options.sync ?? sync;
  }

  private async runRoot(state: RootState): Promise<void> {
    if (this.stopping || state.removed || (state.failed && this.reconcileMs === 0)) return;
    if (!this.store.roots().includes(state.root)) {
      this.dropRoot(state, true);
      return;
    }
    if (state.running) { state.dirty = true; return; }
    this.running = true;
    state.running = true;
    state.dirty = false;
    if (state.timer) this.clearTimer(state.timer);
    state.timer = undefined;
    if (state.rescanTimer) this.clearTimer(state.rescanTimer);
    state.rescanTimer = undefined;
    if (state.failed) this.attach(state);
    const reconcile = state.reconcile;
    const pending = [...state.pending];
    if (reconcile) {
      state.reconcile = false;
      state.pending.clear();
    } else if (!pending.length) {
      state.running = false;
      this.armRescan(state);
      return;
    }
    const inner: LocalUpdateOptions = {
      lockHeld: true,
      ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
      ...(this.options.now ? { now: this.options.now } : {}),
      signal: this.abort.signal,
    };
    const syncOptions: SyncOptions = {
      requireRegistered: true,
      lockHeld: true,
      signal: this.abort.signal,
      ...(this.options.onProgress ? { onProgress: this.options.onProgress } : {}),
    };
    const started = this.now();
    let writerBusy = false;
    let release: (() => void) | undefined;
    try {
      try {
        release = acquireWriteLock(this.store.databasePath);
      } catch (error) {
        if (error instanceof IndexBusyError) {
          this.log(`INDEX_BUSY：${state.root}：稍後重試同步。`);
          writerBusy = true;
          state.dirty = true;
          if (reconcile) state.reconcile = true;
          else for (const item of pending) absorb(state.pending, item);
          return;
        }
        throw error;
      }
      if (!this.store.roots().includes(state.root)) {
        this.dropRoot(state, true);
        return;
      }
      if (reconcile) {
        this.phase = "reconciling";
        const report = await this.syncFn()(state.root, this.store, syncOptions);
        state.syncFailed = !report.complete;
        this.printReport(report);
        this.lastReconcile = { at: new Date(this.now()).toISOString(), root: state.root, complete: report.complete };
        state.lastReconcileAt = this.lastReconcile.at;
      } else {
        this.phase = "updating";
        let updated = 0, unchanged = 0, removed = 0, complete = true;
        for (const filePath of pending) {
          if (this.stopping) break;
          if (state.reconcile) { state.dirty = true; break; }
          const classified = await this.applyOne(state, filePath, inner, syncOptions);
          updated += classified.updated;
          unchanged += classified.unchanged;
          removed += classified.removed;
          complete = complete && classified.complete;
          if (classified.path) {
            this.lastLocalUpdate = { at: new Date(this.now()).toISOString(), root: state.root, path: classified.path };
            state.lastLocalUpdateAt = this.lastLocalUpdate.at;
          }
        }
        state.pending = new Set([...state.pending].filter(item => !pending.includes(item)));
        this.printLocal(state.root, updated, unchanged, removed, Math.round((this.now() - started) * 100) / 100, complete);
        if (!complete) state.syncFailed = true;
      }
      state.busyAttempt = 0;
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        state.dirty = true;
      } else if (error instanceof IndexBusyError) {
        this.log(`INDEX_BUSY：${state.root}：稍後重試同步。`);
        writerBusy = true;
        state.dirty = true;
        if (reconcile) state.reconcile = true;
        else for (const item of pending) absorb(state.pending, item);
      } else if (error instanceof RootError || error instanceof IgnoreConfigurationError) {
        state.syncFailed = true;
        state.offline = true;
        this.log(`監看同步失敗：${state.root}：根目錄同步失敗，保留既有索引`);
        this.rememberError("ROOT_SYNC_FAILED", error.message);
      } else {
        state.syncFailed = true;
        this.log(`監看同步失敗：${state.root}：根目錄同步失敗，保留既有索引`);
        this.rememberError("LIVE_UPDATE_FAILED", error instanceof Error ? error.message : "未知錯誤");
      }
    } finally {
      release?.();
      state.running = false;
      this.refreshRoots();
      if (writerBusy) this.scheduleBusy(state);
      else {
        if (state.dirty || state.pending.size || state.reconcile) this.schedule(state);
        this.armRescan(state);
      }
    }
  }

  private async applyOne(
    state: RootState,
    filePath: string,
    localOpts: LocalUpdateOptions,
    syncOptions: SyncOptions,
  ): Promise<{ updated: number; unchanged: number; removed: number; complete: boolean; path: string }> {
    let info: fs.Stats | undefined;
    try {
      info = await fs.promises.lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const del = await (this.options.applyFileDelete ?? applyFileDelete)(filePath, state.root, this.store, localOpts);
        return { updated: 0, unchanged: 0, removed: del.removed, complete: del.complete, path: filePath };
      }
      const change = await applyPathChange(filePath, state.root, this.store, localOpts);
      return { updated: change.updated, unchanged: change.unchanged, removed: change.removed, complete: change.complete, path: filePath };
    }
    if (info.isSymbolicLink()) return { updated: 0, unchanged: 0, removed: 0, complete: true, path: filePath };
    if (info.isDirectory()) {
      const report = await this.syncFn()(filePath, this.store, { ...syncOptions, requireRegistered: false });
      this.lastReconcile = { at: new Date(this.now()).toISOString(), root: state.root, complete: report.complete };
      return { updated: report.updated, unchanged: report.unchanged, removed: report.removed, complete: report.complete, path: filePath };
    }
    const update = await (this.options.applyFileUpdate ?? applyFileUpdate)(filePath, state.root, this.store, localOpts);
    return { updated: update.updated, unchanged: update.unchanged, removed: update.removed, complete: update.complete, path: filePath };
  }

  private scheduleBusy(state: RootState): void {
    if (this.stopping || state.removed) return;
    const delay = WRITER_BACKOFF_MS[Math.min(state.busyAttempt, WRITER_BACKOFF_MS.length - 1)]!;
    state.busyAttempt++;
    if (state.timer) this.clearTimer(state.timer);
    state.timer = this.setTimer(() => {
      state.timer = undefined;
      this.enqueueReady(state.root);
    }, delay);
  }

  private schedule(state: RootState): void {
    if (this.stopping || state.removed || (state.failed && this.reconcileMs === 0)) return;
    state.dirty = true;
    if (state.running) return;
    if (state.timer) this.clearTimer(state.timer);
    state.timer = this.setTimer(() => {
      state.timer = undefined;
      this.enqueueReady(state.root);
    }, this.debounceMs);
  }

  private armRescan(state: RootState): void {
    if (!this.reconcileMs || this.stopping || state.removed || state.running) return;
    if (state.rescanTimer) this.clearTimer(state.rescanTimer);
    state.rescanTimer = this.setTimer(() => {
      state.rescanTimer = undefined;
      if (this.options.verbose || this.options.mode === "background") this.log(`定期校正：${state.root}`);
      state.reconcile = true;
      this.enqueueReady(state.root);
    }, this.reconcileMs);
  }

  private armWatcherRetry(state: RootState): void {
    if (this.options.mode !== "background" || this.stopping || state.removed) return;
    if (state.retryTimer) this.clearTimer(state.retryTimer);
    const delay = WATCHER_RETRY_MS[Math.min(state.retryAttempt, WATCHER_RETRY_MS.length - 1)]!;
    state.retryAttempt++;
    state.retryTimer = this.setTimer(() => {
      state.retryTimer = undefined;
      this.attach(state);
    }, delay);
  }

  private dropRoot(state: RootState, announce: boolean): void {
    state.removed = true;
    if (state.timer) this.clearTimer(state.timer);
    if (state.rescanTimer) this.clearTimer(state.rescanTimer);
    if (state.retryTimer) this.clearTimer(state.retryTimer);
    state.pending.clear();
    try { state.watcher?.close(); } catch { /* ignore */ }
    if (announce) {
      const parent = this.store.findMergedParent(state.root);
      this.log(parent
        ? `已停止監看已合併的根目錄：${state.root}；請以新根 ${parent} 重新啟動監看。`
        : `已停止監看移除的根目錄：${state.root}`);
    }
    if ([...this.states.values()].every(item => item.removed)) this.allFailed();
  }

  private failRoot(state: RootState, error: unknown): void {
    if (state.failed || this.stopping) return;
    state.failed = true;
    state.lastError = error instanceof Error ? error.message : "未知錯誤";
    if (state.timer) this.clearTimer(state.timer);
    state.timer = undefined;
    try { state.watcher?.close(); } catch { /* 已失效的監看器仍需清理 */ }
    this.log(`監看錯誤：${state.root}：${state.lastError}`);
    this.rememberError("WATCH_ERROR", state.lastError);
    if (this.reconcileMs) {
      this.log(`降級定期掃描：${state.root}（${this.reconcileMs} ms 後校正並重試監看）`);
      this.armRescan(state);
      this.armWatcherRetry(state);
    } else if ([...this.states.values()].every(item => item.failed || item.removed)) this.allFailed();
  }

  private attach(state: RootState): void {
    const recovering = state.failed;
    const watchFn = this.options.watch ?? fs.watch;
    try {
      const watcher = watchFn(state.root, { recursive: true }, (_event, filename) => {
        if (this.stopping || state.failed || state.removed) return;
        this.handleEvent(state, filename);
      });
      state.watcher = watcher;
      state.failed = false;
      state.offline = false;
      state.retryAttempt = 0;
      watcher.on("error", error => this.failRoot(state, error));
      this.log(`${recovering ? "監看恢復" : "監看中"}：${state.root}（防抖 ${this.debounceMs} ms）`);
      if (recovering && this.options.mode === "background") {
        state.reconcile = true;
        this.schedule(state);
      }
    } catch (error) {
      try {
        const info = fs.statSync(state.root);
        if (!info.isDirectory()) state.offline = true;
      } catch { state.offline = true; }
      if (!state.failed) this.failRoot(state, error);
    }
  }

  private handleEvent(state: RootState, filename: string | Buffer | null | undefined): void {
    const label = filename ? String(filename) : "";
    if (label && shouldIgnoreWatchPath(label)) return;
    const at = new Date(this.now()).toISOString();
    state.lastEventAt = at;
    this.lastEvent = { at, root: state.root };
    if (this.options.verbose) this.log(`變更：${state.root}${label ? path.sep + label : ""} @${this.now()}`);
    if (!label) {
      this.markReconcile(state);
      this.schedule(state);
      return;
    }
    const abs = path.resolve(state.root, label);
    if (!coversPath(state.root, abs) && !samePath(state.root, abs)) return;
    if (samePath(abs, state.root) || isIgnoreFile(abs) || path.basename(abs) === IGNORE_FILE) {
      this.markReconcile(state);
      this.schedule(state);
      return;
    }
    absorb(state.pending, abs);
    if (state.pending.size > QUEUE_LIMIT) this.markReconcile(state);
    this.schedule(state);
  }

  private markReconcile(state: RootState): void {
    state.reconcile = true;
    state.pending.clear();
  }

  refreshRoots(): void {
    if (this.stopping) return;
    const live = this.store.roots();
    for (const state of this.states.values()) {
      if (!live.includes(state.root) && !state.removed) this.dropRoot(state, true);
    }
    if (this.options.mode !== "background") return;
    for (const root of live) {
      if (this.states.has(root)) continue;
      const state = this.newState(root);
      this.states.set(root, state);
      this.attach(state);
      state.reconcile = true;
      this.schedule(state);
    }
  }

  private armHeartbeat(): void {
    if (this.options.mode !== "background" || this.stopping) return;
    if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.setTimer(() => {
      this.lastHeartbeatAt = new Date(this.now()).toISOString();
      this.armHeartbeat();
    }, HEARTBEAT_MS);
  }

  private armRootRefresh(): void {
    if (this.options.mode !== "background" || this.stopping) return;
    if (this.refreshTimer) this.clearTimer(this.refreshTimer);
    this.refreshTimer = this.setTimer(() => {
      this.refreshRoots();
      this.armRootRefresh();
    }, ROOT_REFRESH_MS);
  }

  async run(): Promise<number> {
    if (!this.states.size) throw new WatchError("WATCH_NO_ROOTS", "沒有可監看的根目錄；請先執行 index <root>。");
    const stop = Promise.resolve().then(() => this.io.waitForStop()).finally(() => { this.stopping = true; this.phase = "stopping"; });
    try {
      for (const state of this.states.values()) this.attach(state);
      if (!this.reconcileMs && [...this.states.values()].every(state => state.failed)) {
        throw new WatchError("WATCH_ALL_FAILED", "所有根目錄都無法監看。");
      }
      this.phase = "idle";
      this.lastHeartbeatAt = new Date(this.now()).toISOString();
      this.armHeartbeat();
      this.armRootRefresh();
      if (this.options.syncNow !== false) {
        for (const state of this.states.values()) {
          if (this.stopping) break;
          if (state.failed && !this.reconcileMs) continue;
          this.log(`啟動同步：${state.root}`);
          state.reconcile = true;
          this.running = true;
          try { await this.runRoot(state); }
          finally { this.running = false; }
        }
      }
      for (const state of this.states.values()) this.armRescan(state);
      this.log(this.reconcileMs ? `定期校正間隔：${this.reconcileMs} ms（同步完成後起算）。` : "定期校正已關閉。");
      if (this.options.mode === "foreground") this.log("按 Ctrl+C 結束監看。");
      await Promise.race([stop, this.failed]);
    } finally {
      this.stopping = true;
      this.phase = "stopping";
      if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
      if (this.refreshTimer) this.clearTimer(this.refreshTimer);
      for (const state of this.states.values()) {
        if (state.timer) this.clearTimer(state.timer);
        if (state.rescanTimer) this.clearTimer(state.rescanTimer);
        if (state.retryTimer) this.clearTimer(state.retryTimer);
        try { state.watcher?.close(); } catch { /* ignore */ }
      }
      await Promise.allSettled(this.active);
    }
    return [...this.states.values()].some(state => !state.removed && (state.failed || state.syncFailed)) ? 3 : 0;
  }
}

export async function runLiveUpdate(
  store: IndexStore,
  roots: readonly string[],
  options: LiveUpdateOptions,
  io: LiveIO,
): Promise<number> {
  return new LiveUpdateEngine(store, roots, options, io).run();
}
