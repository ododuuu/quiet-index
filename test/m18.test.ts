import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DocumentRecord } from "../src/model.js";
import { matchingPassages, search } from "../src/search.js";
import { IndexStore } from "../src/store.js";

function record(root: string, filename: string, blocks: DocumentRecord["blocks"]): DocumentRecord {
  return { path: path.join(root, filename), filename, extension: path.extname(filename), sizeBytes: 1, modifiedAtMs: 1000,
    status: "indexed", errorCode: null, errorMessage: null, blocks };
}

test("M18 streams documents without the legacy all-candidates path while preserving search and passages", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m18-"));
  const firstRoot = path.join(temp, "first"); const secondRoot = path.join(temp, "second");
  const store = new IndexStore(path.join(temp, "index.db"));
  try {
    const first = record(firstRoot, "Alpha.txt", [
      { ordinal: 0, heading: "標題 needle", content: "無關內容", locationKind: "line", locationValue: "第 1 行" },
      { ordinal: 1, heading: null, content: "first-token", locationKind: "line", locationValue: "第 2 行" },
      { ordinal: 2, heading: "次要標題", content: "second-token", locationKind: "line", locationValue: "第 3 行" },
    ]);
    const second = record(secondRoot, "other.md", [
      { ordinal: 0, heading: null, content: "needle only in another root", locationKind: "line", locationValue: "第 1 行" },
    ]);
    store.registerRoot(firstRoot); store.registerRoot(secondRoot);
    store.upsert(first, firstRoot); store.upsert(second, secondRoot);
    const legacy = store.candidates;
    (store as unknown as { candidates: () => never }).candidates = () => { throw new Error("M18 搜尋不可整庫載入 candidates"); };
    try {
      const phrase = search(store, "needle", 20, undefined, firstRoot);
      assert.deepEqual(phrase.map(result => path.basename(result.path)), ["Alpha.txt"]);
      assert.equal(phrase[0]?.rank, 2);
      assert.equal(phrase[0]?.location, "第 1 行");

      const filename = search(store, "alpha", 20, [".txt"], firstRoot);
      assert.equal(filename[0]?.filenameOnly, true);
      assert.equal(filename[0]?.snippet, "Alpha.txt");

      const allTerms = search(store, "first-token second-token", 20, undefined, firstRoot, "all-terms");
      assert.equal(allTerms.length, 1);
      assert.equal(allTerms[0]?.rank, 1);
      assert.equal(allTerms[0]?.location, "第 2 行");

      const passages = matchingPassages(store, "needle", first.path, 3);
      assert.deepEqual(passages.map(passage => passage.location), ["第 1 行"]);
    } finally { (store as unknown as { candidates: typeof legacy }).candidates = legacy; }
  } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
});
