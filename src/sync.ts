import { acquireWriteLock } from "./write-lock.js";
import { IgnoreConfigurationError } from "./ignore.js";
import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { parseDocument } from "./parser.js";
import { scan, validateRoot, RootError } from "./scanner.js";
import { canonicalizeRootInput, planRootOperation, resolveUserRootPath, runtimePathPlatform, type RootOperationKind } from "./root-plan.js";
import { emptyStatusCounts, supportedExtensions, type Diagnostic, type DocumentRecord, type SyncSummary } from "./model.js";
import type { IndexStore } from "./store.js";
import { throwIfAborted, yieldToEvents, type ProgressUpdate } from "./progress.js";

export interface SyncReport extends SyncSummary {
  root: string;
  errors: string[];
  notices: string[];
  diagnostics: Diagnostic[];
  ignoreFile: string | null;
  ignorePatterns: string[];
  complete: boolean;
  operation: RootOperationKind;
  mergedRoots: string[];
  retainedDocuments: number;
  coveringRoot: string | null;
  scanStart: string;
}

export interface SyncOptions {
  rebuild?: boolean;
  requireRegistered?: boolean;
  // 注入相同契約以測試零解析及讀檔失敗，不改變 CLI 行為。
  parse?: typeof parseDocument;
  scan?: typeof scan;
  signal?: AbortSignal;
  onProgress?: (update: ProgressUpdate) => void;
}

export async function sync(rootInput: string, store: IndexStore, options: SyncOptions = {}): Promise<SyncReport> {
  const release = acquireWriteLock(store.databasePath);
  try {
    options.onProgress?.({ stage: "upgrade", message: "檢查索引格式" });
    await store.upgrade({ lockHeld: true, ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    throwIfAborted(options.signal);
    if ((options.requireRegistered || options.rebuild) && !store.roots().includes(resolveUserRootPath(rootInput))) {
      const merged = store.findMergedParent(resolveUserRootPath(rootInput));
      if (merged) {
        throw new RootError(options.rebuild
          ? `該路徑已合併至上層索引：${merged}；重建請指定有效根目錄，避免隱式擴大範圍。`
          : `該路徑已合併至上層索引：${merged}；請改對上層根目錄操作。`);
      }
      throw new RootError("根目錄已移除或尚未登錄，請重新選擇位置。");
    }
    return await syncLocked(rootInput, store, options);
  } catch (error) {
    if (error instanceof RootError || error instanceof IgnoreConfigurationError) {
      const registered = store.roots().find(root => root === resolveUserRootPath(rootInput));
      if (registered) store.recordSync(registered, false, [error.message], [], undefined,
        [{ stage: "scan", path: registered, code: "ROOT_SYNC_FAILED", message: "根目錄無法同步，保留既有索引" }]);
    }
    throw error;
  } finally { release(); }
}

async function syncLocked(rootInput: string, store: IndexStore, options: SyncOptions): Promise<SyncReport> {
  const started = performance.now();
  const canon = runtimePathPlatform() === "win32" ? canonicalizeRootInput(rootInput, "win32") : { path: rootInput };
  options.onProgress?.({ stage: "scan", message: "開始掃描根目錄", path: canon.path });
  const resolved = await validateRoot(canon.path);
  let actual: string;
  try { actual = await realpath(resolved); } catch { actual = resolved; }
  const existing = await Promise.all(store.roots().map(async registered => {
    let canonical: string;
    try { canonical = await realpath(registered); } catch { canonical = path.resolve(registered); }
    return { registered, actual: canonical };
  }));
  const plan = planRootOperation({ resolved, actual }, existing);
  let retainedDocuments = 0;
  if (plan.kind === "merge") {
    retainedDocuments = store.mergeChildRoots(plan.registeredRoot, plan.mergedRoots).transferred;
  }
  const root = plan.registeredRoot;
  const extraIgnoreBases = store.ignoreBases(root);
  const scanStart = plan.subtree ?? root;
  const found = options.scan
    ? await options.scan(root, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(extraIgnoreBases.length ? { extraIgnoreBases } : {}),
      ...(scanStart !== root ? { start: scanStart } : {}),
    })
    : await scan(root, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(extraIgnoreBases.length ? { extraIgnoreBases } : {}),
      ...(scanStart !== root ? { start: scanStart } : {}),
    });
  // 使用者可能把索引資料目錄放在被掃描根目錄內；LocalDocSearch 自己的資料庫
  // 與 WAL／協調檔不是來源文件，納入會造成每次同步都修改自己的輸入。
  const databasePath = path.resolve(store.databasePath);
  const internalPaths = new Set([
    databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`,
    `${databasePath}.writer.sqlite`, `${databasePath}.writer.sqlite-wal`, `${databasePath}.writer.sqlite-shm`, `${databasePath}.writer.sqlite-journal`,
  ]);
  const sourcePaths = found.paths.filter(filePath => !internalPaths.has(path.resolve(filePath)));
  found.skipped.builtin += found.paths.length - sourcePaths.length;
  found.paths = sourcePaths;
  const notices: string[] = [];
  if (canon.rewrittenFrom !== undefined) notices.push(`已將根目錄 ${canon.rewrittenFrom} 視為 ${canon.path}`);
  if (plan.kind === "merge") {
    notices.push(`合併根目錄範圍：新增 ${root}，合併既有子根 ${plan.mergedRoots.length} 個，保留文件 ${retainedDocuments} 份。`);
    for (const child of plan.mergedRoots) notices.push(`合併：${child}`);
  } else if (plan.kind === "subtree") {
    notices.push(`已包含於上層索引：${plan.subtree} 屬於 ${root}；僅同步指定子樹，不新增重疊登錄。`);
  }
  for (const file of found.extraIgnoreFiles ?? []) notices.push(`沿用排除作用域：${file}`);
  const report: SyncReport = { root, found: found.paths.length, updated: 0, added: 0, reprocessed: 0,
    unchanged: 0, removed: 0, parserCalls: 0, statuses: emptyStatusCounts(), skipped: found.skipped,
    readErrors: found.diagnostics.length, elapsedMs: 0, diagnostics: [...found.diagnostics],
    ignoreFile: found.ignoreFile, ignorePatterns: found.ignorePatterns,
    errors: [...found.errors], notices, complete: found.errors.length === 0,
    operation: plan.kind, mergedRoots: plan.mergedRoots, retainedDocuments,
    coveringRoot: plan.kind === "subtree" ? root : null, scanStart };
  if (plan.kind !== "subtree") store.registerRoot(root);
  if (options.rebuild && found.errors.length === 0) store.clearDocuments(root);
  const knownPaths = new Set(found.paths);
  let processed = 0;
  for (const filePath of found.paths) {
    throwIfAborted(options.signal);
    options.onProgress?.({ stage: "read", message: "處理索引文件", current: processed, total: found.paths.length, path: filePath });
    let stage: Diagnostic["stage"] = "read";
    try {
      const info = await stat(filePath);
      const previous = store.getDocument(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const retryUnsupported = previous?.status === "unsupported" && supportedExtensions.has(extension);
      if (!options.rebuild && previous && previous.status !== "error" && !retryUnsupported && previous.size_bytes === info.size && previous.modified_at_ms === info.mtimeMs) {
        report.unchanged++;
        continue;
      }
      let document: DocumentRecord;
      if (supportedExtensions.has(extension)) {
        report.parserCalls++;
        options.onProgress?.({ stage: "parse", message: "解析文件內容", current: processed, total: found.paths.length, path: filePath });
        document = await (options.parse ?? parseDocument)(filePath);
      } else {
        document = {
          path: filePath,
          filename: path.basename(filePath),
          extension,
          sizeBytes: info.size,
          modifiedAtMs: info.mtimeMs,
          status: "unsupported",
          errorCode: null,
          errorMessage: null,
          blocks: [],
        };
      }
      stage = "store";
      options.onProgress?.({ stage: "write", message: "寫入文件索引", current: processed, total: found.paths.length, path: filePath });
      store.upsert(document, root);
      report.updated++;
      if (previous || options.rebuild) report.reprocessed++;
      else report.added++;
      report.statuses[document.status]++;
      if (document.status === "unsupported" && document.errorMessage) report.notices.push(`${filePath}: ${document.errorMessage}`);
      if (document.status === "error" || document.status === "encrypted") {
        const diagnostic: Diagnostic = { stage: "parse", path: filePath,
          code: document.errorCode ?? "PARSE_ERROR",
          message: document.status === "encrypted" ? "文件已加密，僅可搜尋檔名" : "無法解析文件，僅可搜尋檔名" };
        // readFile 的系統錯誤與格式解析失敗分開處理，避免讀取不完整時移除既有文件。
        if (["EACCES", "EPERM", "ENOENT", "EIO", "EBUSY", "EISDIR", "EMFILE", "ENFILE"].includes(diagnostic.code)) {
          diagnostic.stage = "read";
          report.readErrors++;
          report.complete = false;
        }
        report.diagnostics.push(diagnostic);
        report.errors.push(`${filePath}: ${diagnostic.message}`);
      }
      if (document.status === "no_text" && document.extension === ".vsd") report.notices.push(`${filePath}: VSD 沒有可擷取的直接文字（未展開 master、動態欄位或 OCR）`);
      if (document.status === "no_text" && document.extension === ".pdf") report.notices.push(`${filePath}: PDF 沒有可擷取的文字層（掃描影像不支援 OCR）`);
    } catch {
      const diagnostic: Diagnostic = { stage, path: filePath,
        code: stage === "store" ? "INDEX_WRITE_FAILED" : "FILE_READ_FAILED",
        message: stage === "store" ? "無法更新文件索引" : "無法讀取文件" };
      report.diagnostics.push(diagnostic);
      report.errors.push(`${filePath}: ${diagnostic.message}`);
      if (stage === "read") report.readErrors++;
      report.complete = false;
    }
    processed++;
    if (processed % 100 === 0) await yieldToEvents();
  }
  if (report.complete) {
    report.removed = store.removeMissing(knownPaths, root, plan.kind === "subtree" ? scanStart : undefined);
  }
  report.elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  if (plan.kind !== "subtree") {
    const { root: _root, errors, notices: _notices, complete, diagnostics, ignoreFile: _ignoreFile, ignorePatterns: _ignorePatterns,
      operation: _operation, mergedRoots: _mergedRoots, retainedDocuments: _retainedDocuments, coveringRoot: _coveringRoot, scanStart: _scanStart, ...summary } = report;
    store.recordSync(root, complete, errors, report.notices, summary, diagnostics);
  }
  options.onProgress?.({ stage: "complete", message: "索引同步完成", current: found.paths.length, total: found.paths.length, path: root });
  return report;
}
