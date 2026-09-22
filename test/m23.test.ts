import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { brotliCompressSync } from "node:zlib";
import { search } from "../src/search.js";
import { IndexStore } from "../src/store.js";

test("M23 more than 32766 candidate payloads preserve a complete cross-payload block", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m23-many-payloads-"));
  const database = path.join(temp, "index.db");
  let store = new IndexStore(database);
  try {
    store.upsert({ path: path.join(temp, "large.txt"), filename: "large.txt", extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
      status: "indexed", errorCode: null, errorMessage: null,
      blocks: [{ ordinal: 0, heading: null, content: "abc".repeat(33_000) + "尾端", locationKind: "line", locationValue: "行 0" }] });
    store.close();
    const db = new DatabaseSync(database);
    try {
      const row = db.prepare("SELECT id, document_id FROM blocks").get() as { id: number; document_id: number };
      db.exec("BEGIN; DELETE FROM document_payload_blocks; DELETE FROM document_payload_blooms; DELETE FROM document_payloads;");
      const insert = db.prepare("INSERT INTO document_payloads VALUES (?, ?, ?)");
      const fragment = brotliCompressSync(Buffer.from(JSON.stringify([[row.id, "abc"]])));
      for (let ordinal = 0; ordinal < 33_000; ordinal++) insert.run(row.document_id, ordinal, fragment);
      insert.run(row.document_id, 33_000, brotliCompressSync(Buffer.from(JSON.stringify([[row.id, "尾端"]]))));
      db.prepare("INSERT INTO document_payload_blocks SELECT document_id, ordinal, ? FROM document_payloads").run(row.id);
      // 飽和 Bloom 合法地把所有 payload 都列為候選，仍須做正文精確核對。
      db.prepare("INSERT INTO document_payload_blooms SELECT document_id, ordinal, ? FROM document_payloads").run(Buffer.alloc(1024, 255));
      db.exec("COMMIT");
    } finally { db.close(); }
    store = new IndexStore(database, { readOnly: true });
    assert.equal(search(store, "abc尾端").length, 1);
    assert.match(search(store, "abc尾端")[0]!.snippet, /abc尾端/);
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});

test("M23 large candidate block sets remain searchable through a read-only index", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m23-many-blocks-"));
  const database = path.join(temp, "index.db");
  let store = new IndexStore(database);
  try {
    store.upsert({ path: path.join(temp, "large.txt"), filename: "large.txt", extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
      status: "indexed", errorCode: null, errorMessage: null,
      blocks: Array.from({ length: 40_000 }, (_, ordinal) => ({ ordinal, heading: null,
        content: `的 BUG 的 Log ${ordinal}`, locationKind: "line" as const, locationValue: `行 ${ordinal}` })) });
    store.close();
    store = new IndexStore(database, { readOnly: true });
    const hits = search(store, "的 BUG 的 Log");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.location, "行 0");
    assert.match(hits[0]!.snippet, /的 BUG 的 Log/);
    assert.equal(search(store, "Log 39999")[0]!.location, "行 39999");
    assert.equal(search(store, "的 BUG 的 Log 不存在").length, 0);
    assert.equal(search(store, "BUG 39999", 20, undefined, undefined, "all-terms").length, 1);
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});

test("M23 payload Bloom does not decompress an unrelated payload", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m23-"));
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    store.upsert({ path: path.join(temp, "large.txt"), filename: "large.txt", extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
      status: "indexed", errorCode: null, errorMessage: null, blocks: [
        { ordinal: 0, heading: null, content: "無關內容".repeat(16_000), locationKind: "line", locationValue: "第 1 行" },
        { ordinal: 1, heading: null, content: "命中 payload-RARE-739", locationKind: "line", locationValue: "第 2 行" },
      ] });
    const internal = store as unknown as { db: { prepare(sql: string): { get(...values: unknown[]): unknown; run(...values: unknown[]): unknown } } };
    const document = store.getDocument(path.join(temp, "large.txt"))!;
    const unrelated = internal.db.prepare("SELECT payload_ordinal FROM document_payload_blocks WHERE document_id = ? AND block_id = (SELECT id FROM blocks WHERE document_id = ? AND ordinal = 0)")
      .get(document.id, document.id) as { payload_ordinal: number };
    internal.db.prepare("UPDATE document_payloads SET payload = X'00' WHERE document_id = ? AND ordinal = ?").run(document.id, unrelated.payload_ordinal);
    assert.deepEqual(search(store, "RARE-739").map(hit => hit.location), ["第 2 行"]);
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});

test("M23 keeps a phrase split at a payload boundary searchable", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m23-edge-"));
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    store.upsert({ path: path.join(temp, "edge.txt"), filename: "edge.txt", extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
      status: "indexed", errorCode: null, errorMessage: null, blocks: [{ ordinal: 0, heading: null,
        content: "x".repeat(65_535) + "邊界關鍵字", locationKind: "line", locationValue: "第 1 行" }] });
    assert.equal(search(store, "邊界關鍵字").length, 1);
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});
