import { parentPort, workerData } from "node:worker_threads";
import WordExtractor from "word-extractor";
import XLSX from "xlsx";
import type { TextBlock } from "../model.js";

function failure(code: string): never { throw Object.assign(new Error(code), { code }); }

async function parse(extension: string, data: Uint8Array): Promise<TextBlock[]> {
  const buffer = Buffer.from(data);
  const ole = buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (extension === ".doc") {
    if (!ole) failure("DOC_FORMAT_ERROR");
    const compound = XLSX.CFB.read(buffer, { type: "buffer" });
    const stream = XLSX.CFB.find(compound, "WordDocument") as { content?: Uint8Array } | null;
    const word = Buffer.from(stream?.content ?? []);
    if (word.length < 32 || word.readUInt16LE(0) !== 0xa5ec) failure("DOC_FORMAT_ERROR");
    if (word.readUInt16LE(10) & 0x8100) failure("DOC_ENCRYPTED");
    const doc = await new WordExtractor().extract(buffer);
    const options = { filterUnicode: false };
    const parts: [string, string][] = [
      ["正文", doc.getBody(options)], ["頁首", doc.getHeaders({ ...options, includeFooters: false })],
      ["頁尾", doc.getFooters(options)], ["註腳", doc.getFootnotes(options)],
      ["章末註", doc.getEndnotes(options)], ["批註", doc.getAnnotations(options)],
      ["文字方塊", doc.getTextboxes(options)],
    ];
    const blocks: TextBlock[] = [];
    for (const [part, text] of parts) {
      text.split(/\r\n|[\r\n\f]/).forEach((line, index) => {
        if (line.trim()) blocks.push({ ordinal: blocks.length, heading: null, content: line,
          locationKind: "section", locationValue: `${part}／擷取段落 ${index + 1}` });
      });
    }
    return blocks;
  }
  // 不讓 SheetJS 的寬鬆偵測把任意文字當 CSV 成功索引。
  const biff = buffer.length >= 4 && [0x0009, 0x0209, 0x0409, 0x0809].includes(buffer.readUInt16LE(0));
  if (!ole && !biff) failure("XLS_FORMAT_ERROR");
  if (ole) {
    const compound = XLSX.CFB.read(buffer, { type: "buffer" });
    if (!XLSX.CFB.find(compound, "Workbook") && !XLSX.CFB.find(compound, "Book")) failure("XLS_FORMAT_ERROR");
  }
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellFormula: false, cellHTML: false });
  const blocks: TextBlock[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]!;
    // 只走實際儲存格，不依可能膨脹的 !ref 掃過數百萬個空格。
    const addresses = Object.keys(sheet).filter(key => /^[A-Z]+[1-9]\d*$/.test(key));
    addresses.sort((a, b) => {
      const left = XLSX.utils.decode_cell(a), right = XLSX.utils.decode_cell(b);
      return left.r - right.r || left.c - right.c;
    });
    for (const address of addresses) {
      const cell = sheet[address] as XLSX.CellObject;
      const pieces = [cell.w ?? (cell.v === undefined ? "" : String(cell.v)), cell.l?.Target, cell.l?.Tooltip];
      const content = pieces.filter(value => value?.trim()).join("\n");
      if (content) blocks.push({ ordinal: blocks.length, heading: name, content,
        locationKind: "sheet_cell", locationValue: `工作表「${name}」!${address}` });
    }
  }
  return blocks;
}

if (parentPort) {
  try {
    parentPort.postMessage({ blocks: await parse(workerData.extension, workerData.data) });
  } catch (error) {
    let code = workerData.extension === ".doc" ? "DOC_PARSE_ERROR" : "XLS_PARSE_ERROR";
    if (error instanceof Error && "code" in error) code = String(error.code);
    else if (error instanceof Error && /password|encrypt/i.test(error.message)) code = "XLS_ENCRYPTED";
    parentPort.postMessage({ code });
  }
}
