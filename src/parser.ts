import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DocumentRecord } from "./model.js";
import { vsdParser } from "./parsers/vsd.js";
import type { DocumentParser } from "./parsers/contract.js";
import { markdownParser } from "./parsers/markdown.js";
import { textParser } from "./parsers/text.js";
import { docxParser } from "./parsers/docx.js";
import { pptxParser } from "./parsers/pptx.js";
import { xlsxParser } from "./parsers/xlsx.js";
import { pdfParser } from "./parsers/pdf.js";
import { docParser, xlsParser } from "./parsers/legacy.js";
import { htmlParser, mhtParser } from "./parsers/web.js";
import { msgParser } from "./parsers/msg.js";
import { xmlParser } from "./parsers/xml.js";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const parsers = new Map<string, DocumentParser>([
  [markdownParser.extension, markdownParser],
  [textParser.extension, textParser],
  [docxParser.extension, docxParser],
  [pptxParser.extension, pptxParser],
  [xlsxParser.extension, xlsxParser],
  [pdfParser.extension, pdfParser],
  [docParser.extension, docParser],
  [xlsParser.extension, xlsParser],
  [".html", htmlParser], [".htm", htmlParser], [".xhtml", htmlParser],
  [".mht", mhtParser], [".mhtml", mhtParser],
  [".adoc", textParser],
  [".java", textParser],
  [".sql", textParser],
  [".js", textParser],
  [xmlParser.extension, xmlParser],
  [msgParser.extension, msgParser],
  [vsdParser.extension, vsdParser],
]);

export async function parseDocument(filePath: string): Promise<DocumentRecord> {
  const info = await stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const parser = parsers.get(extension);
  if (!parser) throw new Error(`不支援的格式：${extension}`);
  const document: DocumentRecord = {
    path: filePath,
    filename: path.basename(filePath),
    extension,
    sizeBytes: info.size,
    modifiedAtMs: info.mtimeMs,
    status: "indexed",
    errorCode: null,
    errorMessage: null,
    blocks: [],
  };
  if (info.size > MAX_FILE_BYTES) {
    document.status = "too_large";
    document.errorCode = "FILE_TOO_LARGE";
    document.errorMessage = "檔案超過 100 MB 上限";
    return document;
  }
  try {
    const content = await readFile(filePath);
    document.blocks = await parser.parse(content);
    if (document.blocks.length === 0) document.status = "no_text";
  } catch (error) {
    document.status = error instanceof Error && "code" in error && ["PDF_ENCRYPTED", "DOC_ENCRYPTED", "XLS_ENCRYPTED"].includes(String(error.code)) ? "encrypted" : "error";
    document.errorCode = error instanceof Error && "code" in error ? String(error.code) : "PARSE_ERROR";
    if (["VSD_VERSION_UNSUPPORTED", "VSD_STRUCTURE_UNSUPPORTED"].includes(document.errorCode)) document.status = "unsupported";
    document.errorMessage = document.status === "unsupported" ? "此 VSD 版本或結構尚不支援，僅可搜尋檔名" : error instanceof Error ? error.message : String(error);
  }
  return document;
}
