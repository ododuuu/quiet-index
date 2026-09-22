export type ProgressStage = "recover" | "upgrade" | "scan" | "read" | "parse" | "compress" | "write" | "complete" | "cancelled";

export interface ProgressUpdate {
  stage: ProgressStage;
  message: string;
  current?: number;
  total?: number;
  path?: string;
}

export class OperationCancelledError extends Error {
  readonly code = "OPERATION_CANCELLED";
  constructor() {
    super("操作已取消；已提交的索引進度會保留。下一次執行將從安全位置接續。");
    this.name = "OperationCancelledError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationCancelledError();
}

export function yieldToEvents(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

const IMMEDIATE_STAGES = new Set<ProgressStage>(["recover", "complete", "cancelled"]);

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toFixed(1)} 秒`;
}

export function formatPercent(current: number, total: number, done: boolean): string {
  if (total <= 0) return "無文件";
  if (done) return "100.00%";
  return `${Math.min((current / total) * 100, 99.99).toFixed(2)}%`;
}

export function formatProgressLine(
  update: ProgressUpdate,
  options: { elapsedMs: number; verbose?: boolean } = { elapsedMs: 0 },
): string {
  const elapsed = formatElapsed(options.elapsedMs);
  const location = options.verbose && update.path ? `；${update.path.replace(/[\u0000-\u001f\u007f]/g, "?")}` : "";
  if (update.stage === "cancelled") return `${update.message}${location}`;
  if (update.stage === "scan" && update.total === undefined) {
    return `掃描中；已發現 ${update.current ?? 0} 份；耗時 ${elapsed}${location}`;
  }
  if (update.current !== undefined && update.total !== undefined) {
    const done = update.stage === "complete";
    const percent = formatPercent(update.current, update.total, done);
    if (update.total === 0) return `沒有找到文件；${update.message}；耗時 ${elapsed}`;
    return `文件處理 ${percent}（${update.current}／${update.total}）；${update.message}${location}`;
  }
  return `${update.message}；耗時 ${elapsed}${location}`;
}

export interface ProgressReporterOptions {
  isTTY?: boolean;
  verbose?: boolean;
  write?: (text: string, inPlace: boolean) => void;
  now?: () => number;
  ttyIntervalMs?: number;
  nonTtyIntervalMs?: number;
}

export interface ProgressReporter {
  update(update: ProgressUpdate): void;
  close(): void;
}

export function createProgressReporter(options: ProgressReporterOptions = {}): ProgressReporter {
  const isTTY = options.isTTY ?? false;
  const verbose = options.verbose ?? false;
  const now = options.now ?? Date.now;
  const ttyInterval = options.ttyIntervalMs ?? 1000;
  const nonTtyInterval = options.nonTtyIntervalMs ?? 5000;
  const started = now();
  let latest: ProgressUpdate | undefined;
  let lastWritten = 0;
  let hasWritten = false;
  let hanging = false;
  const write = options.write ?? ((text, inPlace) => {
    if (inPlace) {
      process.stderr.write(`\r${text}\x1b[K`);
      hanging = true;
    } else {
      if (hanging) {
        process.stderr.write("\n");
        hanging = false;
      }
      process.stderr.write(`${text}\n`);
    }
  });
  const render = (update: ProgressUpdate) => {
    const line = formatProgressLine(update, { elapsedMs: now() - started, verbose });
    const inPlace = isTTY && update.stage !== "complete" && update.stage !== "cancelled";
    write(line, inPlace);
    if (!inPlace) hanging = false;
    lastWritten = now();
    hasWritten = true;
  };
  const intervalMs = isTTY ? ttyInterval : nonTtyInterval;
  const timer = setInterval(() => {
    if (latest && now() - lastWritten >= intervalMs) render(latest);
  }, intervalMs);
  timer.unref();
  return {
    update(update) {
      latest = update;
      if (IMMEDIATE_STAGES.has(update.stage) || !hasWritten || now() - lastWritten >= intervalMs) {
        render(update);
      }
    },
    close() {
      clearInterval(timer);
      if (hanging) {
        process.stderr.write("\n");
        hanging = false;
      }
    },
  };
}
