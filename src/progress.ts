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
