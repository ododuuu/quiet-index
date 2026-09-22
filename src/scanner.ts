import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadIgnoreRules, type IgnoreRules } from "./ignore.js";
import { coversPath, RootError } from "./root-plan.js";
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
  extraIgnoreFiles: string[];
}

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?: (update: ProgressUpdate) => void;
  extraIgnoreBases?: readonly string[];
  start?: string;
}

export async function scan(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const ignoreRules = await loadIgnoreRules(root);
  const extraRules: { base: string; rules: IgnoreRules }[] = [];
  const extraIgnoreFiles: string[] = [];
  for (const base of options.extraIgnoreBases ?? []) {
    const rules = await loadIgnoreRules(base);
    extraRules.push({ base, rules });
    if (rules.sourcePath) extraIgnoreFiles.push(rules.sourcePath);
  }
  const start = options.start ?? root;
  const result: ScanResult = { paths: [], errors: [], diagnostics: [],
    skipped: { builtin: 0, user: 0, unsupported: 0, link: 0 },
    ignoreFile: ignoreRules.sourcePath, ignorePatterns: [...ignoreRules.patterns, ...extraRules.flatMap(item => item.rules.patterns)],
    extraIgnoreFiles };
  const pending = [start];
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
      const ignoredByExtra = extraRules.some(item => coversPath(item.base, fullPath) && item.rules.matches(path.relative(item.base, fullPath), entry.isDirectory()));
      if ((entry.isDirectory() && ignoredDirectories.has(entry.name.toLowerCase())) || (entry.isFile() && entry.name.startsWith("~$"))) {
        result.skipped.builtin++;
      } else if (ignoreRules.matches(relativePath, entry.isDirectory()) || ignoredByExtra) {
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
  if (process.platform === "win32" && /^[A-Za-z]:(?![\\/])/u.test(input.trim())) {
    throw new RootError(`磁碟代號路徑不完整：${input}；請使用 ${input.trim().slice(0, 2)}\\ 表示該磁碟根目錄。`);
  }
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

export { RootError };
