import { getDocument, InvalidPDFException, PasswordException } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";

class PdfFileError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const pdfModuleUrl = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");

export function normalizePdfAssetDirectory(filePath: string): string {
  // PDF.js requires these directory strings to end in a forward slash. On
  // Windows, fileURLToPath returns backslashes, which its validation rejects.
  return `${filePath.replaceAll("\\", "/").replace(/\/+$/, "")}/`;
}

function pdfAssetDirectory(url: URL): string {
  return normalizePdfAssetDirectory(fileURLToPath(url));
}

const cMapUrl = pdfAssetDirectory(new URL("../../cmaps/", pdfModuleUrl));
const standardFontDataUrl = pdfAssetDirectory(new URL("../../standard_fonts/", pdfModuleUrl));

export const pdfParser: DocumentParser = {
  extension: ".pdf",
  async parse(data: Uint8Array): Promise<TextBlock[]> {
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    try {
      // 傳入記憶體中的本機位元組，PDF.js 不需要取得來源路徑或發出網路請求。
      loadingTask = getDocument({ data: new Uint8Array(data), verbosity: 0,
        cMapUrl, cMapPacked: true, standardFontDataUrl });
      const pdf = await loadingTask.promise;
      const blocks: TextBlock[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const textContent = await page.getTextContent();
        const lines: string[] = [];
        let line = "";
        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          line += item.str;
          if (item.hasEOL) {
            if (line.trim()) lines.push(line.trim());
            line = "";
          }
        }
        if (line.trim()) lines.push(line.trim());
        const content = lines.join("\n");
        if (content) blocks.push({ ordinal: blocks.length, heading: null, content,
          locationKind: "page", locationValue: `第 ${number} 頁` });
        page.cleanup();
      }
      return blocks;
    } catch (error) {
      if (error instanceof PasswordException) throw new PdfFileError("PDF_ENCRYPTED", "PDF 已加密，需要密碼");
      if (error instanceof InvalidPDFException) throw new PdfFileError("PDF_CORRUPT", "PDF 檔案無效或已損壞");
      throw new PdfFileError("PDF_PARSE_ERROR", `PDF 解析失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (loadingTask) await loadingTask.destroy().catch(() => {});
    }
  },
};
