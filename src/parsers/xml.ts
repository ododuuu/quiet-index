import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { decodeSharedText, lineBlocks } from "./text-decode.js";

export const xmlParser: DocumentParser = {
  extension: ".xml",
  parse(data: Uint8Array): TextBlock[] {
    return lineBlocks(decodeSharedText(data, "xml").text);
  },
};
