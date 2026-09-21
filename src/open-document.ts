import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { documentReference } from "./document-reference.js";
import type { IndexStore } from "./store.js";

export class DocumentActionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DocumentActionError"; }
}
export type DocumentAction = "open" | "reveal";
export interface LaunchPlan { executable: string; args: string[]; env: NodeJS.ProcessEnv }
export async function resolveDocument(store: IndexStore, reference: string) {
  const match = /^([1-9]\d*)-([0-9a-f]{16})$/.exec(reference);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new DocumentActionError("ACTION_REFERENCE_INVALID", "文件代碼格式錯誤，請從搜尋結果複製。");
  const row = store.getDocumentById(Number(match[1]));
  const root = row ? store.documentRoot(row.id) : null;
  if (!row || !root || documentReference(row.id, row.path) !== reference) throw new DocumentActionError("ACTION_REFERENCE_STALE", "文件代碼已失效，請重新搜尋。");
  const relative = path.relative(root, row.path);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new DocumentActionError("ACTION_PATH_REJECTED", "文件不在所屬根目錄。");
  }
  try {
    // 使用者明確指定的根目錄可有別名；其下各層不得在索引後換成連結。
    let current = await realpath(root);
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new DocumentActionError("ACTION_LINK_REJECTED", "來源路徑已變成連結，請重新索引並確認位置。");
    }
    const info = await lstat(current);
    if (!info.isFile()) throw new DocumentActionError("ACTION_NOT_FILE", "來源已不是一般檔案。");
    await access(current, constants.R_OK);
    return { path: current, changed: row.size_bytes !== info.size || row.modified_at_ms !== info.mtimeMs };
  } catch (error) {
    if (error instanceof DocumentActionError) throw error;
    throw new DocumentActionError("ACTION_SOURCE_UNAVAILABLE", "來源不存在或無法讀取，請確認權限並重新索引。");
  }
}

export function launchPlan(action: DocumentAction, filePath: string, platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env): LaunchPlan {
  if (platform === "darwin") return { executable: "/usr/bin/open", args: action === "reveal" ? ["-R", filePath] : [filePath], env: { ...environment } };
  if (platform !== "win32") throw new DocumentActionError("ACTION_PLATFORM_UNSUPPORTED", "此平台尚不支援開啟；可用 --dry-run 查看來源路徑。");
  if (!path.win32.isAbsolute(filePath) || /["\x00-\x1f]/.test(filePath)) throw new DocumentActionError("ACTION_PATH_REJECTED", "來源路徑無法交由 Windows 開啟。");
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows";
  // 固定程式文字；文件路徑透過環境變數傳值，特殊字元不會成為 PowerShell 程式。
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $start = New-Object System.Diagnostics.ProcessStartInfo",
    "  $start.UseShellExecute = $true",
    action === "open"
      ? "  $start.FileName = $env:LOCALDOCSEARCH_ACTION_PATH"
      : "  $start.FileName = [IO.Path]::Combine($env:SystemRoot, 'explorer.exe'); $start.Arguments = '/select,\"' + $env:LOCALDOCSEARCH_ACTION_PATH + '\"'",
    "  [void][System.Diagnostics.Process]::Start($start)",
    "  exit 0",
    "} catch { exit 1 }",
  ].join("\n");
  return { executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    env: { ...environment, SystemRoot: systemRoot, LOCALDOCSEARCH_ACTION_PATH: filePath } };
}

export function executeLaunch(plan: LaunchPlan, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(plan.executable, plan.args, { env: plan.env, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 16384 }, error => {
      if (error) reject(new DocumentActionError("ACTION_LAUNCH_FAILED", "無法送出開啟請求；請確認預設程式、系統政策與來源位置。"));
      else resolve();
    });
  });
}

export async function actOnDocument(store: IndexStore, reference: string, action: DocumentAction, dryRun = false,
  launch: (plan: LaunchPlan) => Promise<void> = executeLaunch) {
  const target = await resolveDocument(store, reference);
  if (!dryRun) await launch(launchPlan(action, target.path));
  return target;
}
