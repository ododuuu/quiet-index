import type fs from "node:fs";
import type { sync } from "./sync.js";
import type { IndexStore } from "./store.js";
import type { ProgressUpdate } from "./progress.js";
import {
  LiveUpdateEngine, WatchError, resolveWatchDebounce, resolveWatchRescan,
  type LiveIO, type LiveUpdateOptions,
} from "./live-update.js";
import { shouldIgnoreWatchPath } from "./watch-path.js";
import { acquireLiveLease, LiveBusyError } from "./live-lease.js";
import {
  createInstanceId, createInstanceToken, readStateFile, removeStateFile,
  startControlServer, writeStateFile, type ControlServer,
} from "./autoupdate-control.js";
import { canonicalIndexPath } from "./live-lease.js";
import { applyFileDelete, applyFileUpdate } from "./local-update.js";

export { WatchError, resolveWatchDebounce, resolveWatchRescan };
export { shouldIgnoreWatchPath };

export interface WatchIO extends LiveIO {}

export interface WatchOptions {
  debounceMs?: number;
  rescanMs?: number;
  verbose?: boolean;
  syncNow?: boolean;
  watch?: typeof fs.watch;
  sync?: typeof sync;
  applyFileUpdate?: typeof applyFileUpdate;
  applyFileDelete?: typeof applyFileDelete;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  onProgress?: (update: ProgressUpdate) => void;
  enableControl?: boolean;
}

export async function runWatch(
  store: IndexStore,
  roots: readonly string[],
  options: WatchOptions,
  io: WatchIO,
): Promise<number> {
  if (!roots.length) throw new WatchError("WATCH_NO_ROOTS", "沒有可監看的根目錄；請先執行 index <root>。");
  const debounceMs = resolveWatchDebounce(options.debounceMs);
  const rescanMs = resolveWatchRescan(options.rescanMs);
  const instanceId = createInstanceId();
  const startedAt = new Date().toISOString();
  const liveOptions: LiveUpdateOptions = {
    mode: "foreground",
    debounceMs,
    reconcileMs: rescanMs,
    instanceId,
    startedAt,
    ...(options.verbose ? { verbose: true } : {}),
    ...(options.syncNow !== undefined ? { syncNow: options.syncNow } : {}),
    ...(options.watch ? { watch: options.watch } : {}),
    ...(options.sync ? { sync: options.sync } : {}),
    ...(options.applyFileUpdate ? { applyFileUpdate: options.applyFileUpdate } : {}),
    ...(options.applyFileDelete ? { applyFileDelete: options.applyFileDelete } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };
  const engine = new LiveUpdateEngine(store, roots, liveOptions, io);
  let releaseLease: (() => void) | undefined;
  let server: ControlServer | undefined;
  try {
    try {
      releaseLease = acquireLiveLease(store.databasePath);
    } catch (error) {
      if (error instanceof LiveBusyError) {
        const state = readStateFile(store.databasePath);
        throw new WatchError("WATCH_INSTANCE_ACTIVE", state
          ? `相同索引已有持續更新實例（${state.mode} ${state.instanceId}）。背景程序請先 autoupdate stop；前景監看請在原終端 Ctrl+C。`
          : "相同索引已有持續更新實例正在執行。");
      }
      throw error;
    }
    if (options.enableControl !== false) {
      const token = createInstanceToken();
      const canonical = canonicalIndexPath(store.databasePath);
      server = await startControlServer({
        databasePath: store.databasePath,
        token,
        instanceId,
        mode: "foreground",
        getStatus: () => engine.snapshot(),
        onStop: () => {},
        allowRemoteStop: false,
      });
      writeStateFile({
        schemaVersion: 1,
        databasePath: canonical,
        instanceId,
        pid: process.pid,
        token,
        endpoint: server.endpoint,
        startedAt,
        settings: { debounceMs, reconcileMs: rescanMs },
        mode: "foreground",
      });
    }
    return await engine.run();
  } finally {
    if (server) await server.close();
    if (options.enableControl !== false) removeStateFile(store.databasePath);
    releaseLease?.();
  }
}
