import type { DocumentParser } from "./contract.js";
import { parseInWorker } from "./worker.js";

export const msgParser: DocumentParser = {
  extension: ".msg",
  parse: data => parseInWorker(new URL("./msg-worker.js", import.meta.url), data, "MSG"),
};
