import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { OfficePackage, attribute, children, descendants, first, hyperlinkRelationships, relationshipFile,
  searchableLinkTargets, tag, taggedText } from "./office.js";

function fieldTargets(node: Record<string, unknown>): string[] {
  const instructions = [
    ...descendants([node], "fldSimple").map(field => attribute(field, "instr") ?? ""),
    descendants([node], "instrText").map(field => taggedText([field], "instrText")).join(""),
  ];
  const targets: string[] = [];
  for (const instruction of instructions) {
    const match = /\bHYPERLINK\s+(?:"([^"]+)"|'([^']+)'|(\S+))/iu.exec(instruction);
    const target = match?.[1] ?? match?.[2] ?? match?.[3];
    if (target) targets.push(target);
  }
  return targets;
}

function paragraphText(node: Record<string, unknown>, hyperlinks: Map<string, string>): string {
  const visible = taggedText([node], "t").trim();
  const targets: string[] = [];
  for (const hyperlink of descendants([node], "hyperlink")) {
    const related = hyperlinks.get(attribute(hyperlink, "id") ?? "");
    if (related) targets.push(related);
    const anchor = attribute(hyperlink, "anchor");
    if (anchor) targets.push(`#${anchor}`);
  }
  targets.push(...fieldTargets(node));
  return [visible, ...searchableLinkTargets(targets).filter(target => !visible.includes(target))].filter(Boolean).join("\n");
}

export const docxParser: DocumentParser = {
  extension: ".docx",
  parse(data: Uint8Array): TextBlock[] {
    const pkg = new OfficePackage(data);
    const body = first(descendants(pkg.xml("word/document.xml"), "body"), "body");
    if (!body) return [];
    const hyperlinks = hyperlinkRelationships(pkg, relationshipFile("word/document.xml"));
    const blocks: TextBlock[] = [];
    let heading: string | null = null;
    let paragraphNumber = 0;
    let tableNumber = 0;
    for (const item of children(body)) {
      if (tag(item) === "p") {
        paragraphNumber++;
        const content = paragraphText(item, hyperlinks);
        if (!content) continue;
        const style = descendants([item], "pStyle")[0];
        if (style && /^(Heading[1-6]|Title|Subtitle)$/i.test(attribute(style, "val") ?? "")) heading = content;
        blocks.push({ ordinal: blocks.length, heading, content, locationKind: "section", locationValue: `第 ${paragraphNumber} 段` });
      } else if (tag(item) === "tbl") {
        tableNumber++;
        const rows = descendants([item], "tr");
        rows.forEach((row, rowIndex) => {
          descendants([row], "tc").forEach((cell, cellIndex) => {
            const content = descendants([cell], "p").map(paragraph => paragraphText(paragraph, hyperlinks)).filter(Boolean).join("\n");
            if (content) blocks.push({ ordinal: blocks.length, heading, content, locationKind: "section",
              locationValue: `表格 ${tableNumber}，第 ${rowIndex + 1} 列第 ${cellIndex + 1} 欄` });
          });
        });
      }
    }
    // 圖形與頁首頁尾的連結不一定有正文的 w:hyperlink 節點；補收 Word 各部件的目標網址。
    const indexedContent = new Set(blocks.flatMap(block => block.content.split("\n")));
    for (const file of pkg.names().filter(name => name.startsWith("word/") && name.endsWith(".rels"))) {
      const source = file.replace("/_rels/", "/").slice(0, -5);
      for (const target of hyperlinkRelationships(pkg, file).values()) {
        const missing = searchableLinkTargets([target]).filter(value => !indexedContent.has(value));
        if (!missing.length) continue;
        blocks.push({ ordinal: blocks.length, heading: null, content: missing.join("\n"), locationKind: "section",
          locationValue: `超連結目標（${source}）` });
        missing.forEach(value => indexedContent.add(value));
      }
    }
    return blocks;
  },
};
