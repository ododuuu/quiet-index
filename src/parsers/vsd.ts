import type { DocumentParser } from "./contract.js";
import { parseInWorker } from "./worker.js";
export const vsdParser: DocumentParser = {
  extension: ".vsd",
  parse: data => parseInWorker(new URL("./vsd-worker.js", import.meta.url), data, "VSD"),
};
