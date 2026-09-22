import { appendFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { terminalText } from "./context.js";

export const AUTOUPDATE_LOG_LIMIT = 2 * 1024 * 1024;
export const AUTOUPDATE_LOG_FILES = 5;

export function autoupdateLogPath(dataDir: string, index = 0): string {
  return index === 0 ? path.join(dataDir, "autoupdate.log") : path.join(dataDir, `autoupdate.log.${index}`);
}

export interface AutoupdateLog {
  failed: boolean;
  write(line: string): void;
  rotate(): void;
}

function safeLine(value: string): string {
  return terminalText(value.replace(/\s+/g, " ").trim());
}

export function formatAutoupdateLogLine(fields: {
  at?: Date;
  phase: string;
  root?: string;
  path?: string;
  count?: number;
  elapsedMs?: number;
  code?: string;
  message?: string;
}): string {
  const parts = [`${(fields.at ?? new Date()).toISOString()}`, fields.phase];
  if (fields.root) parts.push(`root=${safeLine(fields.root)}`);
  if (fields.path) parts.push(`path=${safeLine(fields.path)}`);
  if (fields.count !== undefined) parts.push(`count=${fields.count}`);
  if (fields.elapsedMs !== undefined) parts.push(`elapsedMs=${fields.elapsedMs}`);
  if (fields.code) parts.push(`code=${fields.code}`);
  if (fields.message) parts.push(safeLine(fields.message));
  return parts.join(" ");
}

export function createAutoupdateLog(dataDir: string): AutoupdateLog {
  const current = autoupdateLogPath(dataDir);
  let failed = false;
  const sizeOf = (): number => {
    try { return statSync(current).size; } catch { return 0; }
  };
  let size = sizeOf();
  const rotate = () => {
    try {
      const last = autoupdateLogPath(dataDir, AUTOUPDATE_LOG_FILES - 1);
      try { unlinkSync(last); } catch { /* 沒有最舊檔 */ }
      for (let index = AUTOUPDATE_LOG_FILES - 2; index >= 1; index--) {
        try { renameSync(autoupdateLogPath(dataDir, index), autoupdateLogPath(dataDir, index + 1)); }
        catch { /* 該輪替檔不存在 */ }
      }
      try { renameSync(current, autoupdateLogPath(dataDir, 1)); }
      catch { /* 目前檔可能尚未建立 */ }
      writeFileSync(current, "", { encoding: "utf8", mode: 0o600 });
      size = 0;
    } catch {
      failed = true;
    }
  };
  return {
    get failed() { return failed; },
    set failed(value) { failed = value; },
    rotate,
    write(line: string) {
      try {
        const payload = `${line}\n`;
        const bytes = Buffer.byteLength(payload);
        if (size + bytes > AUTOUPDATE_LOG_LIMIT) rotate();
        if (failed) return;
        appendFileSync(current, payload, { encoding: "utf8" });
        size += bytes;
      } catch {
        failed = true;
      }
    },
  };
}
