import XLSX from "xlsx";
import iconv from "iconv-lite";

export interface MailFixture {
  subject?: string;
  body?: string;
  html?: string;
  htmlBytes?: Buffer;
  rtf?: Buffer;
  messageClass?: string;
  ansiCodepage?: number;
  htmlCodepage?: number;
  sender?: string;
  senderAddress?: string;
  senderSmtp?: string;
  recipients?: { name: string; address: string; smtp?: string; type: number }[];
  attachments?: boolean;
  extra?: Record<string, Buffer>;
}

export function makeMsg(options: MailFixture = {}): Buffer {
  const cfb = XLSX.CFB.utils.cfb_new();
  const add = (name: string, data: Uint8Array) => XLSX.CFB.utils.cfb_add(cfb, "/" + name, data);
  const records: Buffer[] = [];
  const unicode = options.ansiCodepage === undefined;
  const charset = unicode ? "utf16le" : options.ansiCodepage === 65001 ? "utf8" : `cp${options.ansiCodepage}`;
  function record(tag: number, value: number): Buffer {
    const result = Buffer.alloc(16);
    result.writeUInt32LE(tag, 0);
    result.writeUInt32LE(6, 4);
    result.writeUInt32LE(value, 8);
    return result;
  }
  function stream(folder: string, tag: string, data: Buffer, properties: Buffer[]): void {
    add(`${folder}__substg1.0_${tag}`, data);
    properties.push(record(parseInt(tag, 16), data.length));
  }
  function string(folder: string, id: string, value: string | undefined, properties: Buffer[]): void {
    if (value !== undefined) stream(folder, id + (unicode ? "001F" : "001E"), iconv.encode(value + "\0", charset), properties);
  }
  string("", "001A", options.messageClass ?? "IPM.Note", records);
  string("", "0037", options.subject, records);
  string("", "1000", options.body, records);
  string("", "0C1A", options.sender, records);
  string("", "0C1F", options.senderAddress, records);
  string("", "5D01", options.senderSmtp, records);
  if (options.html !== undefined) stream("", "1013001F", Buffer.from(options.html + "\0", "utf16le"), records);
  if (options.htmlBytes !== undefined) stream("", "10130102", options.htmlBytes, records);
  if (options.rtf) stream("", "10090102", options.rtf, records);
  if (options.ansiCodepage !== undefined) records.push(record(0x3ffd0003, options.ansiCodepage));
  if (options.htmlCodepage !== undefined) records.push(record(0x3fde0003, options.htmlCodepage));
  for (const [index, recipient] of (options.recipients ?? []).entries()) {
    const folder = `__recip_version1.0_#${index.toString(16).padStart(8, "0")}/`;
    const properties = [record(0x0c150003, recipient.type)];
    string(folder, "3001", recipient.name, properties);
    string(folder, "3003", recipient.address, properties);
    string(folder, "39FE", recipient.smtp, properties);
    add(folder + "__properties_version1.0", Buffer.concat([Buffer.alloc(8), ...properties]));
  }
  const header = Buffer.alloc(32);
  header.writeUInt32LE(options.recipients?.length ?? 0, 16);
  header.writeUInt32LE(options.attachments ? 1 : 0, 20);
  add("__properties_version1.0", Buffer.concat([header, ...records]));
  if (options.attachments) {
    const folder = "__attach_version1.0_#00000000/";
    add(folder + "__substg1.0_3707001F", Buffer.from("附件私密名稱.txt\0", "utf16le"));
    add(folder + "__substg1.0_37010102", Buffer.from("attachment-secret"));
    // 損壞的附加郵件不應進入解析，也不能污染父郵件欄位。
    add(folder + "__substg1.0_3701000D/__properties_version1.0", Buffer.from([1]));
    add(folder + "__substg1.0_3701000D/__substg1.0_1000001F", Buffer.from("nested-secret", "utf16le"));
  }
  for (const [name, bytes] of Object.entries(options.extra ?? {})) add(name, bytes);
  return Buffer.from(XLSX.CFB.write(cfb, { type: "buffer" }));
}

// 自製 literal-only LZFu，與正式解壓套件獨立，另支援 MELA（未壓縮）。
export function wrapRtf(rtf: string, compressed = false): Buffer {
  const raw = Buffer.from(rtf, "latin1");
  let payload = raw;
  if (compressed) {
    const end = ((207 + raw.length) & 4095) << 4;
    const tokens = [...raw].map(value => ({ ref: false, bytes: Buffer.from([value]) }));
    tokens.push({ ref: true, bytes: Buffer.from([end >> 8, end & 255]) });
    const chunks: Buffer[] = [];
    for (let i = 0; i < tokens.length; i += 8) {
      const group = tokens.slice(i, i + 8);
      chunks.push(Buffer.from([group.reduce((flags, token, index) => flags | (token.ref ? 1 << index : 0), 0)]), ...group.map(token => token.bytes));
    }
    payload = Buffer.concat(chunks);
  }
  const header = Buffer.alloc(16);
  header.writeUInt32LE(payload.length + 12, 0);
  header.writeUInt32LE(raw.length, 4);
  header.write(compressed ? "LZFu" : "MELA", 8, "ascii");
  let crc = 0;
  if (compressed) for (const value of payload) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  header.writeUInt32LE(crc >>> 0, 12);
  return Buffer.concat([header, payload]);
}
