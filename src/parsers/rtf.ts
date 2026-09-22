import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { decodeRtf } from "./rtf-core.js";
import { htmlBlocks } from "./web.js";

export const rtfParser: DocumentParser = {
  extension: ".rtf",
  async parse(data: Uint8Array): Promise<TextBlock[]> {
    const result = await decodeRtf(data);
    const contents = result.mode === "html"
      ? htmlBlocks(result.text).map(block => block.content)
      : result.text.split(/\r\n|[\r\n]/u).map(line => line.trim()).filter(Boolean);
    return contents.map((content, ordinal) => ({
      ordinal, heading: null, content, locationKind: "section", locationValue: `段落 ${ordinal + 1}`,
    }));
  },
};
