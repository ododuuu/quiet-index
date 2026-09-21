import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { OfficeFileError, OfficePackage, attribute, descendants, hyperlinkRelationships, relationships, relationshipFile,
  resolvePart, searchableLinkTargets, taggedText } from "./office.js";

const dateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function formatNumber(raw: string, format: string | null, date1904: boolean): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || !format) return raw;
  const clean = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  if (/[ymdhHsS]/.test(clean)) {
    const origin = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const date = new Date(origin + value * 86_400_000);
    if (Number.isFinite(date.getTime())) {
      const iso = date.toISOString();
      return /[hHsS]/.test(clean) ? iso.slice(0, 19).replace("T", " ") : iso.slice(0, 10);
    }
  }
  if (clean.includes("%")) return `${(value * 100).toFixed((clean.split(".")[1]?.match(/0/g) ?? []).length)}%`;
  const decimalPattern = clean.split(";")[0]?.split(".")[1]?.match(/^0+/)?.[0];
  if (decimalPattern !== undefined) {
    const formatted = value.toFixed(decimalPattern.length);
    if (clean.includes(",")) {
      const [whole, fraction] = formatted.split(".");
      return `${Number(whole).toLocaleString("en-US")}${fraction === undefined ? "" : `.${fraction}`}`;
    }
    return formatted;
  }
  if (clean.includes(",") && /^[-+]?#,##0/.test(clean)) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return raw;
}

function cellFormats(pkg: OfficePackage): Map<number, string> {
  const styles = pkg.optionalXml("xl/styles.xml");
  const result = new Map<number, string>();
  if (!styles) return result;
  const custom = new Map<number, string>();
  for (const node of descendants(styles, "numFmt")) {
    const id = Number(attribute(node, "numFmtId"));
    const code = attribute(node, "formatCode");
    if (Number.isInteger(id) && code) custom.set(id, code);
  }
  const xfs = descendants(styles, "cellXfs")[0];
  if (!xfs) return result;
  descendants([xfs], "xf").forEach((node, index) => {
    const id = Number(attribute(node, "numFmtId"));
    const format = custom.get(id) ?? (dateFormats.has(id) ? "yyyy-mm-dd" : null);
    if (format) result.set(index, format);
  });
  return result;
}

function cellText(cell: Record<string, unknown>, sharedStrings: string[], formats: Map<number, string>, date1904: boolean): string {
  const kind = attribute(cell, "t");
  if (kind === "inlineStr") return taggedText(descendants([cell], "is"), "t");
  const raw = taggedText([cell], "v");
  if (!raw) return "";
  if (kind === "s") return sharedStrings[Number(raw)] ?? "";
  if (kind === "b") return raw === "1" ? "TRUE" : "FALSE";
  if (kind === "str" || kind === "e") return raw;
  const style = Number(attribute(cell, "s") ?? "0");
  return formatNumber(raw, formats.get(style) ?? null, date1904);
}

export const xlsxParser: DocumentParser = {
  extension: ".xlsx",
  parse(data: Uint8Array): TextBlock[] {
    const pkg = new OfficePackage(data);
    const workbook = pkg.xml("xl/workbook.xml");
    const workbookRels = relationships(pkg, relationshipFile("xl/workbook.xml"));
    const shared = pkg.optionalXml("xl/sharedStrings.xml");
    const sharedStrings = shared ? descendants(shared, "si").map(node => taggedText([node], "t")) : [];
    const formats = cellFormats(pkg);
    const date1904 = ["1", "true"].includes(attribute(descendants(workbook, "workbookPr")[0] ?? {}, "date1904") ?? "");
    const blocks: TextBlock[] = [];
    for (const sheet of descendants(workbook, "sheet")) {
      const name = attribute(sheet, "name") ?? "未命名工作表";
      const target = workbookRels.get(attribute(sheet, "id") ?? "");
      if (!target) throw new OfficeFileError("OFFICE_MISSING_PART", `工作表「${name}」缺少關聯`);
      const sheetPart = resolvePart("xl/workbook.xml", target);
      const worksheet = pkg.xml(sheetPart);
      const blockByAddress = new Map<string, TextBlock>();
      for (const cell of descendants(worksheet, "c")) {
        const address = attribute(cell, "r");
        if (!address) continue;
        const content = cellText(cell, sharedStrings, formats, date1904);
        if (!content.trim()) continue;
        const block: TextBlock = { ordinal: blocks.length, heading: name, content, locationKind: "sheet_cell",
          locationValue: `工作表「${name}」!${address}` };
        blocks.push(block);
        blockByAddress.set(address, block);
      }
      const hyperlinkRels = hyperlinkRelationships(pkg, relationshipFile(sheetPart));
      for (const hyperlink of descendants(worksheet, "hyperlink")) {
        const reference = attribute(hyperlink, "ref");
        if (!reference) continue;
        const related = hyperlinkRels.get(attribute(hyperlink, "id") ?? "");
        const location = attribute(hyperlink, "location");
        const display = attribute(hyperlink, "display");
        const tooltip = attribute(hyperlink, "tooltip");
        const additions = searchableLinkTargets([related ?? "", location ? `#${location}` : "", display ?? "", tooltip ?? ""]);
        if (additions.length === 0) continue;
        const existing = blockByAddress.get(reference);
        if (existing) {
          const values = new Set(existing.content.split("\n"));
          for (const addition of additions) values.add(addition);
          existing.content = [...values].join("\n");
        } else {
          const block: TextBlock = { ordinal: blocks.length, heading: name, content: additions.join("\n"),
            locationKind: "sheet_cell", locationValue: `工作表「${name}」!${reference}` };
          blocks.push(block);
          blockByAddress.set(reference, block);
        }
      }
    }
    return blocks;
  },
};
