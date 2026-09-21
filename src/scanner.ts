import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadIgnoreRules } from "./ignore.js";
import type { Diagnostic, SkippedCounts } from "./model.js";
import { throwIfAborted, type ProgressUpdate } from "./progress.js";

const ignoredDirectories = new Set([".git", "node_modules", ".localdocsearch"]);

export interface ScanResult {
  paths: string[];
  errors: string[];
  diagnostics: Diagnostic[];
  skipped: SkippedCounts;
  ignoreFile: string | null;
  ignorePatterns: string[];
}

export async function scan(root: string, options: { signal?: AbortSignal; onProgress?: (update: ProgressUpdate) => void } = {}): Promise<ScanResult> {
  const ignoreRules = await loadIgnoreRules(root);
  const result: ScanResult = { paths: [], errors: [], diagnostics: [],
    skipped: { builtin: 0, user: 0, unsupported: 0, link: 0 },
    ignoreFile: ignoreRules.sourcePath, ignorePatterns: ignoreRules.patterns };
  const pending = [root];
  while (pending.length > 0) {
    throwIfAborted(options.signal);
    const directory = pending.pop()!;
    options.onProgress?.({ stage: "scan", message: `掃描目錄；已找到 ${result.paths.length} 份檔案`, current: result.paths.length, path: directory });
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      const diagnostic: Diagnostic = { stage: "scan", path: directory, code: "SCAN_READ_FAILED", message: "無法讀取目錄" };
      result.diagnostics.push(diagnostic);
      result.errors.push(`${directory}: ${diagnostic.message}`);
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath);
      if ((entry.isDirectory() && ignoredDirectories.has(entry.name.toLowerCase())) || (entry.isFile() && entry.name.startsWith("~$"))) {
        result.skipped.builtin++;
      } else if (ignoreRules.matches(relativePath, entry.isDirectory())) {
        result.skipped.user++;
      } else if (entry.isSymbolicLink()) {
        // 包含 Windows junction，不 stat 目標，避免循環或越過根目錄。
        result.skipped.link++;
      } else if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile()) {
        result.paths.push(fullPath);
      }
    }
  }
  result.paths.sort();
  return result;
}

export async function validateRoot(input: string): Promise<string> {
  const root = path.resolve(input);
  let info;
  try {
    info = await stat(root);
  } catch {
    throw new RootError(`找不到根目錄：${root}`);
  }
  if (!info.isDirectory()) throw new RootError(`指定路徑不是目錄：${root}`);
  return root;
}

export class RootError extends Error {}
