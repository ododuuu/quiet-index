import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { decodeSharedText } from "./text-decode.js";

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: "CSV_FORMAT_ERROR" });
}

function rows(source: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
      continue;
    }
    if (character === '"') {
      if (field.length || closedQuote) fail("CSV 引號位置無效");
      quoted = true;
    } else if (character === ",") {
      row.push(field); field = ""; closedQuote = false;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(field); result.push(row); row = []; field = ""; closedQuote = false;
    } else {
      if (closedQuote) fail("CSV 結束引號後有非分隔字元");
      field += character;
    }
  }
  if (quoted) fail("CSV 引號未結束");
  if (field.length || row.length || (source.length > 0 && !/[\r\n]$/u.test(source))) {
    row.push(field); result.push(row);
  }
  return result;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return name;
}

export const csvParser: DocumentParser = {
  extension: ".csv",
  parse(data: Uint8Array): TextBlock[] {
    const parsed = rows(decodeSharedText(data).text.replace(/^\uFEFF/u, ""));
    return parsed.flatMap((cells, rowIndex) => {
      const nonempty = cells.map((value, index) => ({ value, index })).filter(item => item.value.trim());
      if (!nonempty.length) return [];
      const first = nonempty[0]!.index;
      const last = nonempty.at(-1)!.index;
      return [{
        ordinal: rowIndex,
        heading: null,
        content: cells.join(" | "),
        locationKind: "line" as const,
        locationValue: `第 ${rowIndex + 1} 列（${columnName(first)}–${columnName(last)}）`,
      }];
    });
  },
};
