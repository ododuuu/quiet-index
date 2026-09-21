import XLSX from "xlsx";

export function literalCompress(bytes: Buffer): Buffer {
  const pieces: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    const block = bytes.subarray(i, i + 8);
    pieces.push(Buffer.from([(1 << block.length) - 1]), block);
  }
  return Buffer.concat(pieces);
}
export function vsdChunk(type: number, id: number, body: Buffer, level = 1): Buffer {
  const header = Buffer.alloc(19);
  header.writeUInt32LE(type); header.writeUInt32LE(id, 4);
  header.writeUInt32LE(body.length, 12); header.writeUInt16LE(level, 16); header[18] = 0x50;
  return Buffer.concat([header, body]);
}
export function makeVsd(options: { text?: string; version?: number; compressed?: boolean; corrupt?: boolean; cycle?: boolean; chunks?: Buffer } = {}): Buffer {
  const header = Buffer.alloc(64);
  header.write("Visio (TM) Drawing\r\n\0", "ascii"); header[0x1a] = options.version ?? 11;
  const chunks = options.chunks ?? Buffer.concat([
    vsdChunk(0x48, 7, Buffer.alloc(0)),
    vsdChunk(0x0e, 0, Buffer.concat([Buffer.alloc(8), Buffer.from(options.text ?? "繁體中文流程\n核准採購", "utf16le")]), 2),
    vsdChunk(0x1f, 0, Buffer.from("不能索引的附件文字", "utf16le")),
  ]);
  const compressed = options.compressed ?? true;
  const page = compressed ? literalCompress(Buffer.concat([Buffer.alloc(4), chunks])) : chunks;
  // 單一根指標表，頁面 ID 由表中位置決定。
  const table = Buffer.alloc(34);
  table.writeUInt32LE(8, 0); table.writeUInt32LE(1, 4); table.writeUInt32LE(1, 8);
  const ptr = (type: number, offset: number, length: number, format: number) => {
    const b = Buffer.alloc(18); b.writeUInt32LE(type); b.writeUInt32LE(offset, 8);
    b.writeUInt32LE(length, 12); b.writeUInt16LE(format, 16); return b;
  };
  ptr(0x15, 98, page.length + (options.corrupt ? 20 : 0), compressed ? 0xd3 : 0xd1).copy(table, 16);
  if (options.cycle) ptr(0x27, 64, table.length, 0x50).copy(table, 16);
  ptr(0x14, 64, table.length, 0x50).copy(header, 0x24);
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, "/VisioDocument", Buffer.concat([header, table, page]));
  XLSX.CFB.utils.cfb_add(cfb, "/unrelated", Buffer.from("不能索引的根層雜訊", "utf16le"));
  return XLSX.CFB.write(cfb, { type: "buffer" }) as Buffer;
}
