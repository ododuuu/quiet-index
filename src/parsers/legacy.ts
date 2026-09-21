import { parseInWorker } from "./worker.js";
import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";

// 舊二進位格式可能含損壞的鏈結表；worker 讓同步解析也能被逾時終止。
export function parseLegacy(extension: ".doc" | ".xls", data: Uint8Array, timeoutMs = 30_000): Promise<TextBlock[]> {
  return parseInWorker(new URL("./legacy-worker.js", import.meta.url), { extension, data }, "LEGACY", timeoutMs);
}

export const docParser: DocumentParser = { extension: ".doc", parse: data => parseLegacy(".doc", data) };
export const xlsParser: DocumentParser = { extension: ".xls", parse: data => parseLegacy(".xls", data) };
