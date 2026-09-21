import { parentPort, workerData } from "node:worker_threads";
import { extractVsd } from "./vsd-binary.js";
if (parentPort) {
  try { parentPort.postMessage({ blocks: extractVsd(workerData) }); }
  catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "VSD_FORMAT_ERROR";
    parentPort.postMessage({ code: /^VSD_[A-Z_]+$/.test(code) ? code : "VSD_FORMAT_ERROR" });
  }
}
