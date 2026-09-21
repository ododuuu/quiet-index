import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";

export const textParser: DocumentParser = {
  extension: ".txt",
  parse(data: Uint8Array): TextBlock[] {
    const content = new TextDecoder("utf-8").decode(data);
    return content.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      return [{ ordinal: index, heading: null, content: line, locationKind: "line" as const, locationValue: `第 ${index + 1} 行` }];
    });
  },
};
