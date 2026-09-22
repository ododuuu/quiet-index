import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { OfficeFileError, OfficePackage, attribute, children, descendants, searchableLinkTargets, tag, text, type XmlNode } from "./office.js";

function visibleText(node: XmlNode): string {
  const body = text(node).replace(/\s+/gu, " ").trim();
  const links = searchableLinkTargets(descendants([node], "a").map(link => attribute(link, "href") ?? ""));
  return [...new Set([body, ...links].filter(Boolean))].join("\n");
}

export const odtParser: DocumentParser = {
  extension: ".odt",
  parse(data: Uint8Array): TextBlock[] {
    const pkg = new OfficePackage(data);
    const manifest = pkg.optionalXml("META-INF/manifest.xml");
    if (manifest && descendants(manifest, "encryption-data").length) {
      throw new OfficeFileError("ODT_ENCRYPTED", "ODT 內容已加密");
    }
    const content = pkg.xml("content.xml");
    const blocks: TextBlock[] = [];
    let currentHeading: string | null = null;
    const add = (value: string, location: string, heading = currentHeading) => {
      if (!value.trim()) return;
      blocks.push({ ordinal: blocks.length, heading, content: value, locationKind: "section", locationValue: location });
    };
    const visit = (nodes: XmlNode[]): void => {
      for (const node of nodes) {
        const name = tag(node);
        if (name === "h") {
          const value = visibleText(node);
          if (value) { currentHeading = value.split("\n")[0]!; add(value, `標題 ${blocks.length + 1}`, currentHeading); }
        } else if (name === "p") {
          add(visibleText(node), `段落 ${blocks.length + 1}`);
        } else if (name === "table-row") {
          const cells = children(node).filter(child => ["table-cell", "covered-table-cell"].includes(tag(child) ?? ""));
          const values = cells.map(visibleText);
          if (values.some(value => value.trim())) add(values.join(" | "), `表格列 ${blocks.length + 1}`);
        } else if (!["table-cell", "covered-table-cell"].includes(name ?? "")) {
          visit(children(node));
        }
      }
    };
    visit(content);
    return blocks;
  },
};
