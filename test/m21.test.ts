import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { search } from "../src/search.js";
import { IndexStore } from "../src/store.js";

test("M21 search streams Brotli payload blocks without the full-document reader", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m21-"));
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    store.upsert({ path: path.join(temp, "stream.txt"), filename: "stream.txt", extension: ".txt", sizeBytes: 1, modifiedAtMs: 1,
      status: "indexed", errorCode: null, errorMessage: null,
      blocks: [{ ordinal: 0, heading: null, content: "前文 needle 後文", locationKind: "line", locationValue: "第 1 行" }] });
    const privateStore = store as unknown as { blocksFor: () => never };
    const original = privateStore.blocksFor;
    privateStore.blocksFor = () => { throw new Error("M21 主搜尋不可先重組整份文件"); };
    try { assert.equal(search(store, "needle").length, 1); }
    finally { privateStore.blocksFor = original; }
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});
