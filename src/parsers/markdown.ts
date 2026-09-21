import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";

export const markdownParser: DocumentParser = {
  extension: ".md",
  parse(data: Uint8Array): TextBlock[] {
    const content = new TextDecoder("utf-8").decode(data);
    const blocks: TextBlock[] = [];
    let heading: string | null = null;
    let section: string[] = [];
    let start = 1;
    const flush = () => {
      const text = section.join("\n").trim();
      if (text) blocks.push({ ordinal: blocks.length, heading, content: text, locationKind: "section", locationValue: `第 ${start} 行` });
      section = [];
    };
    content.split(/\r?\n/).forEach((line, index) => {
      const match = /^#{1,6}\s+(.+)$/.exec(line);
      if (match) {
        flush();
        heading = match[1]!.trim();
        start = index + 1;
        section.push(line);
      } else {
        if (section.length === 0) start = index + 1;
        section.push(line);
      }
    });
    flush();
    return blocks;
  },
};
