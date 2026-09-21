import { Worker } from "node:worker_threads";
import type { TextBlock } from "../model.js";

export function parseInWorker(url: URL, input: unknown, prefix: string, timeoutMs = 30_000): Promise<TextBlock[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, {
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (error?: Error, blocks?: TextBlock[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(blocks!);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error("文件解析逾時"), { code: `${prefix}_TIMEOUT` })), timeoutMs);
    worker.once("message", (result: { blocks?: TextBlock[]; code?: string }) => {
      if (result.blocks) finish(undefined, result.blocks);
      else finish(Object.assign(new Error("無法解析文件"), { code: result.code ?? `${prefix}_PARSE_ERROR` }));
    });
    worker.once("error", () => finish(Object.assign(new Error("文件解析程序失敗"), { code: `${prefix}_WORKER_ERROR` })));
    worker.once("exit", () => finish(Object.assign(new Error("文件解析程序結束"), { code: `${prefix}_WORKER_EXIT` })));
  });
}
