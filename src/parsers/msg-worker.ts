import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { crc32 } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FieldsData, ParserConfig } from "@kenjiuno/msgreader";
import XLSX from "xlsx";
import iconv from "iconv-lite";
import { decompressRTF } from "@kenjiuno/decompressrtf";
import { DeEncapsulate, Tokenize } from "rtf-stream-parser";
import { htmlBlocks, decodeHtml } from "./web.js";
import type { TextBlock } from "../model.js";

const require = createRequire(import.meta.url);
const MsgReader = (require("@kenjiuno/msgreader") as {
  default: new (data: Uint8Array) => { parserConfig: ParserConfig; getFileData(): FieldsData };
}).default;
const RTF_LIMIT = 20 * 1024 * 1024;
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
const clean = (text?: string) => (text ?? "").replace(/\0/g, "").trim();
function encoding(codepage: number): string {
  const name = codepage === 65001 ? "utf8" : codepage === 1200 ? "utf16le" : `cp${codepage}`;
  if (!iconv.encodingExists(name)) fail("MSG_ENCODING_UNSUPPORTED");
  return name;
}

async function rtfBody(data: Uint8Array): Promise<{ mode: "text" | "html"; text: string }> {
  const bytes = Buffer.from(data);
  if (bytes.length < 16 || bytes.readUInt32LE(0) + 4 !== bytes.length) fail("MSG_RTF_INVALID");
  const size = bytes.readUInt32LE(4);
  if (size > RTF_LIMIT || bytes.length > RTF_LIMIT) fail("MSG_RTF_LIMIT");
  // MS-OXRTFCP 的 CRC 從 0 開始且不做最後 XOR，與 zlib 預設不同。
  if (bytes.toString("ascii", 8, 12) === "LZFu" &&
      ((crc32(bytes.subarray(16), 0xffffffff) ^ 0xffffffff) >>> 0) !== bytes.readUInt32LE(12)) fail("MSG_RTF_INVALID");
  const raw = Buffer.from(decompressRTF([...bytes]));
  if (raw.length !== size || !raw.subarray(0, 5).equals(Buffer.from("{\\rtf"))) fail("MSG_RTF_INVALID");
  if (raw.length > RTF_LIMIT) fail("MSG_RTF_LIMIT");
  const rtf = raw.toString("latin1");
  // 3.8.1 的 tokenizer 會依 bin 參數配置記憶體；進入解析器前界定上限。
  for (const match of rtf.matchAll(/\\bin(-?\d+)/g)) {
    const length = Number(match[1]);
    if (!Number.isSafeInteger(length) || length < 0 || length > raw.length) fail("MSG_RTF_INVALID");
  }
  // 一般 RTF 以文字模式處理相同的 Unicode、字碼頁與目的區塊規則。
  const source = /\\from(?:html\d*|text)\b/.test(rtf) ? raw : Buffer.from(rtf.replace(/^(\{\\rtf\d+)/, "$1\\fromtext "), "latin1");
  const decoder = new DeEncapsulate({ decode: iconv.decode, warn: () => {} });
  // 版本鎖定的 feature hook：一般 RTF 不得把圖片 hex、物件及中繼資料當正文。
  decoder._featureHandlers.unshift({ outputDataFilter(global) {
    const destinations = global._state.allDestinations ?? {};
    if (["pict", "object", "objdata", "info", "filetbl", "listtable", "listoverridetable", "fldinst"].some(name => destinations[name])) return true;
    return undefined;
  } });
  const chunks: Buffer[] = [];
  let outputBytes = 0;
  await pipeline(Readable.from([source]), new Tokenize(), decoder, async source => {
    for await (const chunk of source) {
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes > RTF_LIMIT) fail("MSG_RTF_LIMIT");
      chunks.push(bytes);
    }
  });
  return { mode: decoder.isHtml ? "html" : "text", text: Buffer.concat(chunks).toString("utf8") };
}

async function parse(data: Uint8Array): Promise<TextBlock[]> {
  const bytes = Buffer.from(data);
  if (!bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) fail("MSG_FORMAT_ERROR");
  const compound = XLSX.CFB.read(bytes, { type: "buffer" }) as {
    FullPaths: string[]; FileIndex: { type: number; content?: Uint8Array }[];
  };
  const root = compound.FullPaths[0]!;
  const streams = new Map<string, Buffer>();
  for (let i = 0; i < compound.FullPaths.length; i++) {
    const relative = compound.FullPaths[i]!.slice(root.length);
    const entry = compound.FileIndex[i]!;
    if (entry.type === 2 && !relative.includes("/")) streams.set(relative.toLowerCase(), Buffer.from(entry.content ?? []));
  }
  const props = streams.get("__properties_version1.0");
  if (!props || props.length < 32 || (props.length - 32) % 16) fail("MSG_FORMAT_ERROR");
  let cp = 1252, htmlCp: number | undefined;
  for (let offset = 32; offset < props.length; offset += 16) {
    const tag = props.readUInt32LE(offset);
    if (tag === 0x3ffd0003) cp = props.readUInt32LE(offset + 8);
    if (tag === 0x3fde0003) htmlCp = props.readUInt32LE(offset + 8);
  }
  const ansi = encoding(cp);
  const stringField = (id: string): string => {
    const unicode = streams.get(`__substg1.0_${id}001f`);
    const ascii = streams.get(`__substg1.0_${id}001e`);
    return clean(unicode ? iconv.decode(unicode, "utf16le") : ascii ? iconv.decode(ascii, ansi) : "");
  };
  const messageClass = stringField("001a");
  if (!messageClass) fail("MSG_FORMAT_ERROR");
  if (/\.smime(?:\.|$)/i.test(messageClass)) fail("MSG_SMIME_UNSUPPORTED");
  if (!/^ipm\.note(?:\.|$)/i.test(messageClass)) fail("MSG_ITEM_UNSUPPORTED");

  // 只投影根層及收件者資料；附件和附加 MSG 不交給套件遞迴解析。
  const projected = XLSX.CFB.utils.cfb_new();
  const ids = new Set(["001a", "0037", "0c1a", "0c1e", "0c1f", "5d01", "1000", "1013", "1009", "3001", "3002", "3003", "39fe"]);
  for (let i = 0; i < compound.FullPaths.length; i++) {
    const relative = compound.FullPaths[i]!.slice(root.length);
    const entry = compound.FileIndex[i]!;
    if (entry.type !== 2 || !/^(?:__recip_version1\.0_#[0-9a-f]{8}\/)?(?:__properties_version1\.0|__substg1\.0_[0-9a-f]{8})$/i.test(relative)) continue;
    const base = relative.split("/").at(-1)!.toLowerCase();
    if (base === "__properties_version1.0") {
      const content = Buffer.from(entry.content ?? []);
      const header = relative.includes("/") ? 8 : 32;
      if (content.length < header || (content.length - header) % 16) fail("MSG_FORMAT_ERROR");
      const chunks = [content.subarray(0, header)];
      for (let offset = header; offset < content.length; offset += 16) {
        if ([0x0c150003, 0x3ffd0003, 0x3fde0003].includes(content.readUInt32LE(offset))) chunks.push(content.subarray(offset, offset + 16));
      }
      XLSX.CFB.utils.cfb_add(projected, "/" + relative, Buffer.concat(chunks));
    } else if (ids.has(base.slice(12, 16))) {
      XLSX.CFB.utils.cfb_add(projected, "/" + relative, entry.content);
    }
  }
  const reader = new MsgReader(XLSX.CFB.write(projected, { type: "buffer" }));
  reader.parserConfig = { ansiEncoding: ansi };
  const mail = reader.getFileData();
  if (mail.error || mail.dataType !== "msg") fail("MSG_PARSE_ERROR");
  const blocks: TextBlock[] = [];
  const add = (text: string, location: string, heading: string | null = null) => {
    if (clean(text)) blocks.push({ ordinal: blocks.length, content: clean(text), heading,
      locationKind: "section", locationValue: location });
  };
  const subject = stringField("0037");
  add(subject, "郵件主旨", subject || null);
  add([...new Set([mail.senderName, mail.senderEmail, mail.senderSmtpAddress].map(clean).filter(Boolean))].join("\n"), "郵件寄件者");
  const recipientLabels: Record<string, string> = { to: "收件者", cc: "副本", bcc: "密件副本" };
  for (const [index, recipient] of (mail.recipients ?? []).entries()) {
    add([...new Set([recipient.name, recipient.email, recipient.smtpAddress].map(clean).filter(Boolean))].join("\n"),
      `郵件${recipientLabels[recipient.recipType ?? ""] ?? "收件者（類別未知）"} ${index + 1}`);
  }
  // 有些匯出檔只有顯示名稱欄位，未附 recipient storage。
  if (!mail.recipients?.length) {
    for (const [id, label] of [["0e04", "收件者"], ["0e03", "副本"], ["0e02", "密件副本"]]) add(stringField(id!), `郵件${label}`);
  }
  let body: TextBlock[] = [];
  let bodyKind = "純文字";
  let bodyError: unknown;
  try {
    let html = clean(mail.bodyHtml);
    if (!html && mail.html?.length) {
      const binary = Buffer.from(mail.html);
      const bom = binary[0] === 0xff && binary[1] === 0xfe || binary[0] === 0xfe && binary[1] === 0xff || binary.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
      html = bom || htmlCp === undefined ? decodeHtml(binary) : iconv.decode(binary, encoding(htmlCp));
    }
    if (html) { body = htmlBlocks(html); bodyKind = "HTML"; }
  } catch (error) { bodyError = error; }
  const textBlocks = (text: string): TextBlock[] => text.split(/\r\n|[\r\n]/).filter(line => line.trim()).map((content, ordinal) => ({
    ordinal, content, heading: null, locationKind: "section", locationValue: "",
  }));
  if (!body.length && clean(mail.body)) { body = textBlocks(mail.body!); bodyKind = "純文字"; bodyError = undefined; }
  if (!body.length && mail.compressedRtf?.length) {
    const result = await rtfBody(mail.compressedRtf);
    body = result.mode === "html" ? htmlBlocks(result.text) : textBlocks(result.text);
    bodyKind = result.mode === "html" ? "RTF→HTML" : "RTF";
    bodyError = undefined;
  }
  if (bodyError) throw bodyError;
  for (const [index, block] of body.entries()) add(block.content, `郵件正文（${bodyKind}）／段落 ${index + 1}`);
  return blocks;
}

if (parentPort) {
  try { parentPort.postMessage({ blocks: await parse(workerData) }); }
  catch (error) {
    const code = error instanceof Error && "code" in error && /^MSG_[A-Z_]+$/.test(String(error.code)) ? String(error.code) : "MSG_PARSE_ERROR";
    parentPort.postMessage({ code });
  }
}
