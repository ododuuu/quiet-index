import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import iconv from "iconv-lite";
import { DeEncapsulate, Tokenize } from "rtf-stream-parser";

export const RTF_LIMIT = 20 * 1024 * 1024;

function fail(prefix: "MSG" | "RTF", suffix: "INVALID" | "LIMIT" | "ENCODING_UNSUPPORTED"): never {
  const code = `${prefix}_RTF_${suffix}`.replace("RTF_RTF_", "RTF_");
  throw Object.assign(new Error(code), { code });
}

export async function decodeRtf(rawInput: Uint8Array, prefix: "MSG" | "RTF" = "RTF"):
Promise<{ mode: "text" | "html"; text: string }> {
  const raw = Buffer.from(rawInput);
  if (raw.length > RTF_LIMIT) fail(prefix, "LIMIT");
  const rtf = raw.toString("latin1");
  if (!/^\s*\{\\rtf\d+\b/u.test(rtf)) fail(prefix, "INVALID");
  const codepage = /\\ansicpg(\d+)\b/u.exec(rtf)?.[1];
  if (codepage && !iconv.encodingExists(`cp${codepage}`)) fail(prefix, "ENCODING_UNSUPPORTED");
  const binaryRanges: Array<{ start: number; end: number }> = [];
  for (const match of rtf.matchAll(/\\bin(-?\d+)\s?/gu)) {
    const length = Number(match[1]);
    const start = match.index + match[0].length;
    if (!Number.isSafeInteger(length) || length < 0 || length > raw.length || start + length > rtf.length) fail(prefix, "INVALID");
    binaryRanges.push({ start, end: start + length });
  }
  let depth = 0;
  let slashRun = 0;
  let binaryIndex = 0;
  for (let index = 0; index < rtf.length; index++) {
    const binary = binaryRanges[binaryIndex];
    if (binary && index === binary.start) { index = binary.end - 1; binaryIndex++; slashRun = 0; continue; }
    const character = rtf[index]!;
    if (character === "\\") { slashRun++; continue; }
    const escaped = slashRun % 2 === 1;
    slashRun = 0;
    if (!escaped && character === "{") {
      depth++;
      if (depth > 512) fail(prefix, "LIMIT");
    } else if (!escaped && character === "}" && --depth < 0) fail(prefix, "INVALID");
  }
  if (depth !== 0) fail(prefix, "INVALID");
  // tokenizer 會依 \bin 參數配置記憶體，必須先界定其長度。
  const links = [...rtf.matchAll(/\\fldinst\s+HYPERLINK\s+(?:"([^"]+)"|([^\s\\}]+))/giu)]
    .map(match => (match[1] ?? match[2] ?? "").replace(/\\\\/gu, "\\")).filter(Boolean);
  const source = /\\from(?:html\d*|text)\b/u.test(rtf)
    ? raw
    : Buffer.from(rtf.replace(/^(\s*\{\\rtf\d+)/u, "$1\\fromtext "), "latin1");
  const decoder = new DeEncapsulate({ decode: iconv.decode, warn: () => {} });
  decoder._featureHandlers.unshift({ outputDataFilter(global) {
    const destinations = global._state.allDestinations ?? {};
    if (["pict", "object", "objdata", "info", "filetbl", "fonttbl", "colortbl", "stylesheet",
      "listtable", "listoverridetable", "fldinst"].some(name => destinations[name])) return true;
    return undefined;
  } });
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  try {
    await pipeline(Readable.from([source]), new Tokenize(), decoder, async stream => {
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        outputBytes += bytes.length;
        if (outputBytes > RTF_LIMIT) fail(prefix, "LIMIT");
        chunks.push(bytes);
      }
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && String(error.code).startsWith(`${prefix}_`)) throw error;
    fail(prefix, "INVALID");
  }
  const decoded = Buffer.concat(chunks).toString("utf8");
  return { mode: decoder.isHtml ? "html" : "text", text: [...new Set([decoded, ...links])].join("\n") };
}
