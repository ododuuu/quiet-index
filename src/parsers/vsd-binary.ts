/*
 * VSD v11 文字解析；指標、chunk 與解壓邏輯改寫自 LibreOffice/libvisio
 * VSDParser.cpp、VSDInternalStream.cpp，版本及修改說明見 vendor/README.md。
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. A copy is provided in vendor/libvisio-MPL-2.0.txt.
 */
import XLSX from "xlsx";
import type { TextBlock } from "../model.js";

const MAX_EXPANDED = 64 * 1024 * 1024;
const MAX_TEXT = 20 * 1024 * 1024;
function fail(code = "VSD_FORMAT_ERROR"): never { throw Object.assign(new Error(code), { code }); }
function range(data: Buffer, offset: number, size: number): Buffer {
  if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > data.length) fail();
  return data.subarray(offset, offset + size);
}
const u32 = (data: Buffer, offset: number) => range(data, offset, 4).readUInt32LE();
interface Pointer { type: number; offset: number; length: number; format: number; id: number }
function pointer(data: Buffer, offset: number, id: number): Pointer {
  const bytes = range(data, offset, 18);
  return { type: bytes.readUInt32LE(0), offset: bytes.readUInt32LE(8), length: bytes.readUInt32LE(12), format: bytes.readUInt16LE(16), id };
}

export function expandVsd(input: Buffer, limit = MAX_EXPANDED): Buffer {
  // 4 KiB 循環字典，輸出預算由整份文件共用。
  const dictionary = Buffer.alloc(4096);
  const chunks: Buffer[] = [];
  let output = Buffer.alloc(Math.min(65536, limit)), used = 0, count = 0;
  const put = (value: number) => {
    if (count >= limit) fail("VSD_RESOURCE_LIMIT");
    dictionary[count & 4095] = value;
    if (used === output.length) { chunks.push(output); output = Buffer.alloc(Math.min(65536, limit - count)); used = 0; }
    output[used++] = value; count++;
  };
  for (let cursor = 0; cursor < input.length;) {
    const flag = input[cursor++]!;
    if (cursor === input.length) fail();
    for (let bit = 0; bit < 8 && cursor < input.length; bit++) {
      if (flag & (1 << bit)) put(input[cursor++]!);
      else {
        const pair = range(input, cursor, 2); cursor += 2;
        const address = (((pair[1]! & 0xf0) << 4) | pair[0]!) + 18;
        for (let j = 0; j < (pair[1]! & 15) + 3; j++) put(dictionary[(address + j) & 4095]!);
      }
    }
  }
  chunks.push(output.subarray(0, used));
  return Buffer.concat(chunks, count);
}

export function extractVsd(bytes: Uint8Array): TextBlock[] {
  const input = Buffer.from(bytes);
  if (!input.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) fail();
  const cfb = XLSX.CFB.read(input, { type: "buffer" });
  const root = cfb.FullPaths[0];
  const entry = cfb.FileIndex[cfb.FullPaths.findIndex((name: string) => name === `${root}VisioDocument`)];
  const data = Buffer.from(entry?.content ?? []);
  if (!range(data, 0, 21).equals(Buffer.from("Visio (TM) Drawing\r\n\0", "ascii"))) fail();
  if (range(data, 0x1a, 1)[0] !== 11) fail("VSD_VERSION_UNSUPPORTED");
  let expanded = 0, operations = 0, textSize = 0, pages = 0;
  const blocks: TextBlock[] = [];
  const active = new Set<number>();
  const tick = () => { if (++operations > 100000) fail("VSD_RESOURCE_LIMIT"); };
  const readStream = (ptr: Pointer) => {
    const raw = range(data, ptr.offset, ptr.length);
    const result = ptr.format & 2 ? expandVsd(raw, MAX_EXPANDED - expanded) : raw;
    expanded += result.length;
    if (expanded > MAX_EXPANDED) fail("VSD_RESOURCE_LIMIT");
    return result;
  };
  const text = (body: Buffer, page: number | null, shape: number | null) => {
    if (page === null) return;
    if (body.length < 8 || (body.length - 8) % 2) fail();
    const raw = range(body, 8, body.length - 8);
    let content: string;
    try { content = new TextDecoder("utf-16le", { fatal: true }).decode(raw); } catch { fail("VSD_TEXT_ENCODING_ERROR"); }
    // 欄位標記以分隔取代；不串接標記兩側文字形成錯誤命中。
    content = content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffc]/g, "\n").trim();
    textSize += raw.length;
    if (textSize > MAX_TEXT) fail("VSD_RESOURCE_LIMIT");
    if (content) blocks.push({ ordinal: blocks.length, heading: null, content, locationKind: "section",
      locationValue: `VSD 頁面 ID ${page}／${shape === null ? "文字紀錄" : `圖形 ID ${shape}`}／擷取區塊 ${blocks.length + 1}` });
  };
  const table = (buffer: Buffer, shift: number): Pointer[] => {
    const at = u32(buffer, shift) + shift - 4;
    const orderSize = u32(buffer, at), count = u32(buffer, at + 4);
    if (count > 100000 || orderSize > 100000) fail("VSD_RESOURCE_LIMIT");
    range(buffer, at + 12, count * 18);
    const pointers = Array.from({ length: count }, (_, index) => pointer(buffer, at + 12 + index * 18, index));
    const order: number[] = [];
    if (orderSize > 1) {
      range(buffer, at + 12 + count * 18, orderSize * 4);
      for (let i = 0; i < orderSize; i++) order.push(u32(buffer, at + 12 + count * 18 + i * 4));
    }
    const ordered = new Set(order);
    if (order.some(id => id >= count) || ordered.size !== order.length) fail();
    return [...order.map(id => pointers[id]!), ...pointers.filter(ptr => !ordered.has(ptr.id))];
  };
  const chunks = (buffer: Buffer, page: number | null, initialShape: number | null) => {
    const shapes: { level: number; id: number }[] = [];
    for (let at = 0; at < buffer.length;) {
      while (at < buffer.length && buffer[at] === 0) at++;
      if (at === buffer.length) break;
      tick();
      const header = range(buffer, at, 19);
      const type = header.readUInt32LE(0), id = header.readUInt32LE(4), list = header.readUInt32LE(8);
      const length = header.readUInt32LE(12), level = header.readUInt16LE(16), unknown = header[18]!;
      let trailer = list || [0x71, 0x70, 0x6b, 0x6a, 0x69, 0x66, 0x65, 0x2c].includes(type) ? 8 : 0;
      if (list || (level === 2 && unknown === 0x55) || (level === 2 && unknown === 0x54 && type === 0xaa)
        || (level === 3 && unknown !== 0x50 && unknown !== 0x54)) trailer += 4;
      if ([0x64, 0x65, 0x66, 0x69, 0x6a, 0x6b, 0x6f, 0x71, 0x92, 0xa9, 0xb4, 0xb6, 0xb9, 0xc7].includes(type)
        && trailer !== 12 && trailer !== 4) trailer += 4;
      if ([0x1f, 0xc9, 0x2d, 0xd1].includes(type)) trailer = 0;
      const body = range(buffer, at + 19, length);
      range(buffer, at + 19 + length, trailer);
      while (shapes.length && shapes.at(-1)!.level >= level) shapes.pop();
      if ([0x47, 0x48, 0x4e].includes(type)) shapes.push({ level, id });
      if (type === 0x0e) text(body, page, shapes.at(-1)?.id ?? initialShape);
      at += 19 + length + trailer;
    }
  };
  const visit = (ptr: Pointer, page: number | null, shape: number | null, depth: number) => {
    tick();
    if (depth > 64) fail("VSD_RESOURCE_LIMIT");
    if (!ptr.type || ([0xff, 0x2f].includes(ptr.type) && ptr.length === 0 && ptr.offset === 0)) return;
    // 不進入樣板、樣式、外部 OLE、字型及名稱表。
    if ([0x1d, 0x1e, 0x1a, 0x0d, 0x1f, 0x0c, 0x18, 0xd8, 0x2c, 0x32, 0xc9, 0x34, 0x16].includes(ptr.type)) return;
    if (active.has(ptr.offset)) fail("VSD_POINTER_CYCLE");
    active.add(ptr.offset);
    try {
      const buffer = readStream(ptr), shift = ptr.format & 2 ? 4 : 0;
      if (ptr.type === 0x15) { page = ptr.id; pages++; }
      if ([0x47, 0x48, 0x4e].includes(ptr.type)) shape = ptr.id;
      const format = ptr.format >> 4;
      if (ptr.type === 0x14 || format === 5) {
        if (ptr.type === 0x0e) text(range(buffer, shift, buffer.length - shift), page, shape);
        for (const child of table(buffer, shift)) visit(child, page, shape, depth + 1);
      } else if ([8, 12, 13].includes(format)) chunks(buffer, page, shape);
      else if ([0, 4].includes(format)) {
        if ([0x27, 0x15].includes(ptr.type)) fail("VSD_STRUCTURE_UNSUPPORTED");
        if (ptr.type === 0x0e) text(range(buffer, shift, buffer.length - shift), page, shape);
      } else fail("VSD_STRUCTURE_UNSUPPORTED");
    } finally { active.delete(ptr.offset); }
  };
  const trailer = pointer(data, 0x24, 0);
  if (trailer.type !== 0x14) fail();
  visit(trailer, null, null, 0);
  if (!pages) fail("VSD_STRUCTURE_UNSUPPORTED");
  return blocks;
}
