import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";

class XmlDecodeError extends Error {
  constructor(readonly code: "XML_ENCODING_UNSUPPORTED" | "XML_DECODE_ERROR", message: string) {
    super(message);
    this.name = "XmlDecodeError";
  }
}

function declaredEncoding(data: Uint8Array): string | undefined {
  const prefix = new TextDecoder("latin1").decode(data.subarray(0, Math.min(data.length, 1024)));
  return /^\s*<\?xml\s[^>]*\bencoding\s*=\s*["']\s*([^"']+?)\s*["']/iu.exec(prefix)?.[1];
}

function xmlEncoding(data: Uint8Array): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return "utf-8";
  if (data[0] === 0xff && data[1] === 0xfe) return "utf-16le";
  if (data[0] === 0xfe && data[1] === 0xff) return "utf-16be";
  if (data[0] === 0x00 && data[1] === 0x3c && data[2] === 0x00 && data[3] === 0x3f) return "utf-16be";
  if (data[0] === 0x3c && data[1] === 0x00 && data[2] === 0x3f && data[3] === 0x00) return "utf-16le";
  return declaredEncoding(data) ?? "utf-8";
}

function decodeXml(data: Uint8Array): string {
  const encoding = xmlEncoding(data);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    throw new XmlDecodeError("XML_ENCODING_UNSUPPORTED", "XML 宣告了不支援的文字編碼");
  }
  try {
    return decoder.decode(data);
  } catch {
    throw new XmlDecodeError("XML_DECODE_ERROR", "XML 內容無法依宣告的文字編碼解碼");
  }
}

export const xmlParser: DocumentParser = {
  extension: ".xml",
  parse(data: Uint8Array): TextBlock[] {
    return decodeXml(data).split(/\r\n|\n|\r/u).flatMap((line, index) => line.trim() ? [{
      ordinal: index,
      heading: null,
      content: line,
      locationKind: "line" as const,
      locationValue: `第 ${index + 1} 行`,
    }] : []);
  },
};
