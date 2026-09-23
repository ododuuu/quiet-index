import { closeSync, openSync, renameSync, writeFileSync, constants } from "node:fs";
import path from "node:path";
import { reprocessReasons, type ReprocessReason } from "./model.js";
import { productVersion } from "./version.js";

export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_MAX_BYTES = 1024 * 1024;

export interface SlowFileProfile {
  seq: number;
  extension: string;
  bytes: number;
  reason: ReprocessReason;
  elapsedMs: number;
  errorCode: string | null;
}

export interface IndexProfile {
  schemaVersion: number;
  productVersion: string;
  node: string;
  platform: string;
  arch: string;
  status: "complete" | "cancelled" | "failed";
  found: number;
  checked: number;
  updated: number;
  unchanged: number;
  removed: number;
  parserCalls: number;
  failedDocuments: number;
  reasonsAttempted: Record<ReprocessReason, number>;
  reasonsCommitted: Record<ReprocessReason, number>;
  formats: Record<string, number>;
  sourceBytes: number;
  blocks: number;
  payloads: number;
  mappings: number;
  phasesMs: Record<string, number>;
  phaseOverlap: "serial-stages-within-documents";
  documentTiming: { p50: number; p95: number; max: number; sampleCount: number; population: number; method: string };
  peakRssBytes: number;
  rssMethod: string;
  slowest: SlowFileProfile[];
  note: string;
}

export interface TimingReservoir {
  values: number[];
  seen: number;
  max: number;
  limit: number;
}

export function createTimingReservoir(limit = 20000): TimingReservoir {
  return { values: [], seen: 0, max: 0, limit };
}

export function addTimingSample(reservoir: TimingReservoir, elapsedMs: number): void {
  reservoir.seen++;
  if (elapsedMs > reservoir.max) reservoir.max = elapsedMs;
  if (reservoir.values.length < reservoir.limit) reservoir.values.push(elapsedMs);
  else {
    const slot = Math.floor(Math.random() * reservoir.seen);
    if (slot < reservoir.limit) reservoir.values[slot] = elapsedMs;
  }
}

export function percentileNearestRank(samples: readonly number[], fraction: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function reserveNewProfile(filePath: string): void {
  if (!filePath.trim() || filePath.startsWith("--")) throw new Error("--profile 需要一個新的檔案路徑。");
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved).replace(/[\u0000-\u001f\u007f]/gu, "�");
  let fd: number;
  try {
    fd = openSync(resolved, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "未知錯誤";
    const shellHelp = [
      'CMD：--profile "%USERPROFILE%\\Desktop\\lds-profile.json"',
      'PowerShell：--profile "$env:USERPROFILE\\Desktop\\lds-profile.json"',
    ].join("\n");
    const literalHint = /(?:\$env:[^/\\]+|%[^%/\\]+%)/iu.test(filePath)
      ? "\n偵測到未展開的環境變數字面值；可能混用了 CMD 與 PowerShell 語法，程式不會自行展開。"
      : "";
    if (code === "EEXIST") {
      throw new Error(`--profile 拒絕覆寫既有檔案；請改用新路徑。輸出父目錄：${parent}（${code}）。\n${shellHelp}${literalHint}`);
    }
    throw new Error(`profile 輸出目錄不存在或無法存取：${parent}（${code}）；尚未開始寫入索引。\n${shellHelp}${literalHint}`);
  }
  closeSync(fd);
}

export function rememberSlowFile(slowest: SlowFileProfile[], item: SlowFileProfile, limit = 20): void {
  slowest.push(item);
  slowest.sort((a, b) => b.elapsedMs - a.elapsedMs);
  if (slowest.length > limit) slowest.length = limit;
}

export function buildIndexProfile(input: {
  status: IndexProfile["status"];
  found: number;
  checked: number;
  updated: number;
  unchanged: number;
  removed: number;
  parserCalls: number;
  failedDocuments: number;
  reasonsAttempted: Record<ReprocessReason, number>;
  reasonsCommitted: Record<ReprocessReason, number>;
  formats: Record<string, number>;
  sourceBytes: number;
  blocks: number;
  payloads: number;
  mappings: number;
  phasesMs: Record<string, number>;
  reservoir: TimingReservoir;
  peakRssBytes: number;
  slowest: SlowFileProfile[];
}): IndexProfile {
  const method = input.reservoir.seen <= input.reservoir.values.length
    ? "最近序位法；樣本為本次全部文件耗時"
    : `最近序位法；水庫抽樣 ${input.reservoir.values.length}/${input.reservoir.seen}，未保留路徑`;
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    productVersion,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    status: input.status,
    found: input.found,
    checked: input.checked,
    updated: input.updated,
    unchanged: input.unchanged,
    removed: input.removed,
    parserCalls: input.parserCalls,
    failedDocuments: input.failedDocuments,
    reasonsAttempted: input.reasonsAttempted,
    reasonsCommitted: input.reasonsCommitted,
    formats: input.formats,
    sourceBytes: input.sourceBytes,
    blocks: input.blocks,
    payloads: input.payloads,
    mappings: input.mappings,
    phasesMs: input.phasesMs,
    phaseOverlap: "serial-stages-within-documents",
    documentTiming: {
      p50: percentileNearestRank(input.reservoir.values, 0.5),
      p95: percentileNearestRank(input.reservoir.values, 0.95),
      max: input.reservoir.max,
      sampleCount: input.reservoir.values.length,
      population: input.reservoir.seen,
      method,
    },
    peakRssBytes: input.peakRssBytes,
    rssMethod: "process.memoryUsage().rss 於每份文件後取最大值",
    slowest: input.slowest.map(item => ({ ...item })),
    note: "匿名本機診斷。不含路徑、檔名、正文、查詢、環境變數或憑證。強制終止不保證報告完整。",
  };
}

export function writeIndexProfile(filePath: string, profile: IndexProfile): void {
  let body = `${JSON.stringify(profile, null, 2)}\n`;
  if (Buffer.byteLength(body) > PROFILE_MAX_BYTES) {
    const reduced: IndexProfile = { ...profile, slowest: profile.slowest.slice(0, 5), formats: {}, note: `${profile.note} 報告超過 1 MiB，已截短格式分布與慢檔。` };
    body = `${JSON.stringify(reduced, null, 2)}\n`;
  }
  if (Buffer.byteLength(body) > PROFILE_MAX_BYTES) {
    body = `${JSON.stringify({ schemaVersion: profile.schemaVersion, status: profile.status, note: "報告超過 1 MiB，僅保留狀態。" })}\n`;
  }
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, body, { mode: 0o600 });
  renameSync(temporary, filePath);
}

export function profilePaths(filePath: string): string[] {
  return [filePath, `${filePath}.tmp`];
}

const FORBIDDEN_PROFILE_KEYS: Record<string, true> = {
  path: true,
  filename: true,
  content: true,
  snippet: true,
  query: true,
  env: true,
  secret: true,
  token: true,
  password: true,
};

export function assertProfileIsAnonymous(value: unknown): void {
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_PROFILE_KEYS[key] === true) throw new Error(`profile 含禁止欄位 ${key}`);
      visit(child);
    }
  };
  visit(value);
  for (const reason of reprocessReasons) {
    if (!(reason in ((value as IndexProfile).reasonsAttempted ?? {}))) throw new Error(`profile 缺少原因 ${reason}`);
  }
}
