import type { TextBlock } from "../model.js";

export class TextDecodeError extends Error {
  constructor(
    readonly code: "TEXT_DECODE_ERROR" | "XML_ENCODING_UNSUPPORTED" | "XML_DECODE_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "TextDecodeError";
  }
}

export type TextDecodeKind = "text" | "xml";

export interface TextDecodeResult {
  text: string;
  encoding: string;
}

export interface TextDecodeOptions {
  onAttempt?: (encoding: string) => void;
}

export function normalizeEncodingLabel(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "cp950" || normalized === "windows-950" || normalized === "csbig5"
    || normalized === "big5-hkscs" || normalized === "cn-big5" || normalized === "x-x-big5") {
    return "big5";
  }
  if (normalized === "utf8") return "utf-8";
  if (normalized === "utf16" || normalized === "utf-16") return "utf-16le";
  if (normalized === "unicode-1-1-utf-8") return "utf-8";
  return normalized;
}

function bomEncoding(data: Uint8Array): { encoding: "utf-8" | "utf-16le" | "utf-16be" } | undefined {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return { encoding: "utf-8" };
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return { encoding: "utf-16le" };
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return { encoding: "utf-16be" };
  return undefined;
}

function xmlUtf16Signature(data: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  if (data.length >= 4 && data[0] === 0x00 && data[1] === 0x3c && data[2] === 0x00 && data[3] === 0x3f) return "utf-16be";
  if (data.length >= 4 && data[0] === 0x3c && data[1] === 0x00 && data[2] === 0x3f && data[3] === 0x00) return "utf-16le";
  return undefined;
}

function declaredXmlEncoding(data: Uint8Array): string | undefined {
  const prefix = new TextDecoder("latin1").decode(data.subarray(0, Math.min(data.length, 1024)));
  return /^\s*<\?xml\s[^>]*\bencoding\s*=\s*["']\s*([^"']+?)\s*["']/iu.exec(prefix)?.[1];
}

function unsupportedCode(kind: TextDecodeKind): TextDecodeError["code"] {
  return kind === "xml" ? "XML_ENCODING_UNSUPPORTED" : "TEXT_DECODE_ERROR";
}

function decodeFailureCode(kind: TextDecodeKind): TextDecodeError["code"] {
  return kind === "xml" ? "XML_DECODE_ERROR" : "TEXT_DECODE_ERROR";
}

function failureMessage(kind: TextDecodeKind, code: TextDecodeError["code"]): string {
  if (code === "XML_ENCODING_UNSUPPORTED") return "XML 宣告了不支援的文字編碼";
  if (code === "XML_DECODE_ERROR") return "XML 內容無法依宣告的文字編碼解碼";
  return kind === "xml" ? "XML 內容無法解碼" : "文字內容無法以 UTF-8 或 Big5 解碼";
}

function decodeFatal(data: Uint8Array, encoding: string, kind: TextDecodeKind, options?: TextDecodeOptions): TextDecodeResult {
  options?.onAttempt?.(encoding);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    throw new TextDecodeError(unsupportedCode(kind), failureMessage(kind, unsupportedCode(kind)));
  }
  try {
    return { text: decoder.decode(data), encoding };
  } catch {
    throw new TextDecodeError(decodeFailureCode(kind), failureMessage(kind, decodeFailureCode(kind)));
  }
}

function decodeUtf8ThenBig5(data: Uint8Array, kind: TextDecodeKind, options?: TextDecodeOptions): TextDecodeResult {
  options?.onAttempt?.("utf-8");
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), encoding: "utf-8" };
  } catch {
    options?.onAttempt?.("big5");
    try {
      return { text: new TextDecoder("big5", { fatal: true }).decode(data), encoding: "big5" };
    } catch {
      throw new TextDecodeError(decodeFailureCode(kind), failureMessage(kind, decodeFailureCode(kind)));
    }
  }
}

export function decodeSharedText(
  data: Uint8Array,
  kind: TextDecodeKind = "text",
  options?: TextDecodeOptions,
): TextDecodeResult {
  const bom = bomEncoding(data);
  if (bom) return decodeFatal(data, bom.encoding, kind, options);
  if (kind === "xml") {
    const signature = xmlUtf16Signature(data);
    if (signature) return decodeFatal(data, signature, kind, options);
    const declared = declaredXmlEncoding(data);
    if (declared) return decodeFatal(data, normalizeEncodingLabel(declared), kind, options);
  }
  return decodeUtf8ThenBig5(data, kind, options);
}

export function splitSourceLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/u);
}

export function lineBlocks(text: string): TextBlock[] {
  return splitSourceLines(text).flatMap((line, index) => {
    if (!line.trim()) return [];
    return [{
      ordinal: index,
      heading: null,
      content: line,
      locationKind: "line" as const,
      locationValue: `第 ${index + 1} 行`,
    }];
  });
}
