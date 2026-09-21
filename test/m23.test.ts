import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { search } from "../src/search.js";
import { IndexStore } from "../src/store.js";

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
