import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { brotliCompressSync } from "node:zlib";
import { IndexStore } from "../dist/src/store.js";

const documentCount = 610;
const blockCount = 219_518;
const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-m24-benchmark-"));
const database = path.join(temporary, "index.db");

try {
  new IndexStore(database).close();
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;
    DELETE FROM document_payload_blooms; DELETE FROM document_payload_blocks;
    DELETE FROM document_payloads; DELETE FROM blocks; DELETE FROM documents;
    DELETE FROM index_migration_documents;
    DELETE FROM metadata WHERE key = 'payload_bloom_version';`);
  const insertDocument = db.prepare(`INSERT INTO documents
    (id, path, filename, extension, size_bytes, modified_at_ms, indexed_at_ms, status, error_code, error_message)
    VALUES (?, ?, ?, '.txt', 1, 1, 1, 'indexed', NULL, NULL)`);
  const insertBlock = db.prepare(`INSERT INTO blocks
    (id, document_id, ordinal, heading, content, location_kind, location_value)
    VALUES (?, ?, ?, NULL, '', 'line', ?)`);
  const insertPayload = db.prepare("INSERT INTO document_payloads(document_id, ordinal, payload) VALUES (?, 0, ?)");
  let nextBlockId = 1;
  for (let documentId = 1; documentId <= documentCount; documentId++) {
    const remainingDocuments = documentCount - documentId + 1;
    const remainingBlocks = blockCount - nextBlockId + 1;
    const blocksForDocument = Math.floor(remainingBlocks / remainingDocuments);
    const filename = `${documentId}.txt`;
    insertDocument.run(documentId, path.join(temporary, filename), filename);
    const payload = [];
    for (let ordinal = 0; ordinal < blocksForDocument; ordinal++) {
      const id = nextBlockId++;
      insertBlock.run(id, documentId, ordinal, `第 ${ordinal + 1} 行`);
      payload.push([id, `合成升級文字 ${documentId}-${ordinal}`]);
    }
    insertPayload.run(documentId, brotliCompressSync(Buffer.from(JSON.stringify(payload), "utf8")));
  }
  db.exec("COMMIT");
  const before = db.prepare("SELECT count(*) AS count, sum(length(payload)) AS bytes FROM document_payloads").get();
  db.close();

  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const store = new IndexStore(database);
  const started = performance.now();
  await store.upgrade();
  const elapsedMs = performance.now() - started;
  store.close();
  clearInterval(sampler);

  const verify = new DatabaseSync(database, { readOnly: true });
  const after = verify.prepare("SELECT count(*) AS count, sum(length(payload)) AS bytes FROM document_payloads").get();
  const mappings = verify.prepare("SELECT count(*) AS count FROM document_payload_blocks").get();
  const blooms = verify.prepare("SELECT count(*) AS count FROM document_payload_blooms").get();
  const completed = verify.prepare("SELECT count(*) AS count FROM index_migration_documents WHERE version = 'payload_bloom_1'").get();
  const version = verify.prepare("SELECT value FROM metadata WHERE key = 'payload_bloom_version'").get();
  verify.close();
  console.log(JSON.stringify({ node: process.version, platform: process.platform, documentCount, blockCount,
    elapsedMs: Math.round(elapsedMs * 100) / 100, peakRssBytes: peakRss,
    payloadsBefore: before, payloadsAfter: after, mappings, blooms, completed, version }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
