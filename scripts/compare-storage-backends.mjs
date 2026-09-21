import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const project = fileURLToPath(new URL("../", import.meta.url));
const monitor = path.join(project, "scripts/measure-process.mjs");
const self = fileURLToPath(import.meta.url);
const queries = [
  { label: "一字中文", query: "的", mode: "phrase" },
  { label: "二字中文-資料", query: "資料", mode: "phrase" },
  { label: "二字中文-系統", query: "系統", mode: "phrase" },
  { label: "三字中文", query: "使用者", mode: "phrase" },
  { label: "英文縮寫", query: "API", mode: "phrase" },
  { label: "較長片語", query: "管理系統", mode: "phrase" },
  { label: "二字中文-流程", query: "流程", mode: "phrase" },
  { label: "無結果", query: "不存在關鍵字-ZZ-20260919", mode: "phrase" },
  { label: "多詞-資料系統", query: "資料 系統", mode: "all-terms" },
  { label: "多詞-使用者權限", query: "使用者 權限", mode: "all-terms" },
  { label: "多詞-文件設定", query: "文件 設定", mode: "all-terms" },
  { label: "多詞-API系統", query: "API 系統", mode: "all-terms" },
];
const normalize = value => value.normalize("NFKC").toLowerCase();
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = fork(args[0], args.slice(1), { cwd: project, silent: true,
      execArgv: ["--import", monitor], env: { ...process.env, ...env } });
    let stdout = ""; let stderr = ""; let metrics;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.on("message", value => { metrics = value; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error(`${args.join(" ")} 結束碼 ${code}: ${stderr || stdout}`));
      else {
        let output = null;
        if (stdout.trim()) { try { output = JSON.parse(stdout); } catch { output = stdout.trim(); } }
        resolve({ wallMs: performance.now() - started, maxRssKiB: metrics?.maxRssKiB, sampledPeakRss: metrics?.sampledPeakRss, output });
      }
    });
  });
}

function source(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  const documents = db.prepare("SELECT id,path,filename,extension,size_bytes,modified_at_ms,status FROM documents ORDER BY id").all();
  const blocks = db.prepare("SELECT ordinal,heading,content,location_kind,location_value FROM blocks WHERE document_id=? ORDER BY ordinal");
  return { db, documents, blocks };
}

function compactSchema(db) {
  db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE documents(id INTEGER PRIMARY KEY,path TEXT,filename TEXT,extension TEXT,size_bytes INTEGER,modified_at_ms REAL,status TEXT);
    CREATE TABLE chunks(doc_id INTEGER,ordinal INTEGER,payload BLOB,PRIMARY KEY(doc_id,ordinal));`);
}

function compress(value) {
  return brotliCompressSync(Buffer.from(JSON.stringify(value)), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
  });
}

function blockTuple(block) {
  return [Number(block.ordinal), block.heading, block.content, block.location_kind, block.location_value];
}

function insertBase(target, baseline, scheme) {
  const input = source(baseline); const db = new DatabaseSync(target); compactSchema(db);
  const addDoc = db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?)");
  const addChunk = db.prepare("INSERT INTO chunks VALUES(?,?,?)");
  let extractedTextBytes = 0; let compressedBytes = 0; let chunkCount = 0;
  db.exec("BEGIN");
  for (const document of input.documents) {
    addDoc.run(document.id, document.path, document.filename, document.extension, document.size_bytes, document.modified_at_ms, document.status);
    const tuples = input.blocks.all(document.id).map(blockTuple);
    for (const tuple of tuples) extractedTextBytes += Buffer.byteLength(tuple[2] ?? "");
    const groups = [];
    if (scheme === "brotli-doc") {
      if (tuples.length) groups.push(tuples);
    } else {
      let group = []; let bytes = 2;
      for (const tuple of tuples) {
        const tupleBytes = Buffer.byteLength(JSON.stringify(tuple)) + 1;
        if (group.length && bytes + tupleBytes > 64 * 1024) { groups.push(group); group = []; bytes = 2; }
        group.push(tuple); bytes += tupleBytes;
      }
      if (group.length) groups.push(group);
    }
    groups.forEach((group, ordinal) => {
      const payload = compress(group); compressedBytes += payload.length; chunkCount++;
      addChunk.run(document.id, ordinal, payload);
    });
  }
  db.exec("COMMIT"); input.db.close();
  return { db, documents: input.documents.length, extractedTextBytes, compressedBytes, chunkCount };
}

function fieldsFor(db, docId) {
  const rows = db.prepare("SELECT payload FROM chunks WHERE doc_id=? ORDER BY ordinal").all(docId);
  const blocks = [];
  for (const row of rows) blocks.push(...JSON.parse(brotliDecompressSync(row.payload).toString("utf8")));
  return blocks;
}

function trigrams(value) {
  const chars = Array.from(value); const values = [];
  for (let index = 0; index + 2 < chars.length; index++) values.push(chars.slice(index, index + 3).join(""));
  return values;
}

function hashA(value) {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
function hashB(value) {
  let hash = 5381;
  for (const char of value) hash = (Math.imul(hash, 33) ^ char.codePointAt(0)) >>> 0;
  return (hash | 1) >>> 0;
}
function setBloom(bits, size, gram, count = 7) {
  const a = hashA(gram); const b = hashB(gram);
  for (let i = 0; i < count; i++) { const bit = ((a + Math.imul(i, b)) >>> 0) % size; bits[bit >>> 3] |= 1 << (bit & 7); }
}
function hasBloom(bits, size, gram, count) {
  const a = hashA(gram); const b = hashB(gram);
  for (let i = 0; i < count; i++) { const bit = ((a + Math.imul(i, b)) >>> 0) % size; if (!(bits[bit >>> 3] & (1 << (bit & 7)))) return false; }
  return true;
}

function buildPrototype(baseline, target, scheme) {
  const baseScheme = scheme === "brotli-doc" ? "brotli-doc" : "brotli-chunks";
  const summary = insertBase(target, baseline, baseScheme); const db = summary.db;
  if (scheme === "fts-trigram") {
    db.exec("CREATE VIRTUAL TABLE fts_docs USING fts5(body,content='',tokenize='trigram',detail=none,columnsize=0)");
    const add = db.prepare("INSERT INTO fts_docs(rowid,body) VALUES(?,?)");
    const docs = db.prepare("SELECT id,filename FROM documents").all();
    db.exec("BEGIN");
    for (const doc of docs) {
      const fields = [doc.filename];
      for (const tuple of fieldsFor(db, doc.id)) fields.push(tuple[1] ?? "", tuple[2] ?? "");
      add.run(doc.id, fields.map(normalize).join("\n"));
    }
    db.exec("COMMIT"); db.exec("INSERT INTO fts_docs(fts_docs) VALUES('optimize')");
  }
  if (scheme === "bloom-trigram") {
    db.exec("CREATE TABLE bloom(doc_id INTEGER PRIMARY KEY,bits BLOB NOT NULL,bit_count INTEGER NOT NULL,hash_count INTEGER NOT NULL)");
    const add = db.prepare("INSERT INTO bloom VALUES(?,?,?,?)");
    const docs = db.prepare("SELECT id,filename FROM documents").all();
    db.exec("BEGIN");
    for (const doc of docs) {
      const grams = new Set(trigrams(normalize(doc.filename)));
      for (const tuple of fieldsFor(db, doc.id)) {
        if (tuple[1]) for (const gram of trigrams(normalize(tuple[1]))) grams.add(gram);
        for (const gram of trigrams(normalize(tuple[2]))) grams.add(gram);
      }
      const bitCount = Math.max(64, grams.size * 10); const bits = Buffer.alloc(Math.ceil(bitCount / 8));
      for (const gram of grams) setBloom(bits, bitCount, gram);
      add.run(doc.id, bits, bitCount, 7);
    }
    db.exec("COMMIT");
  }
  db.exec("VACUUM"); db.close();
  return summary;
}

function parsedQuery(entry) {
  const query = normalize(entry.query.trim());
  return { query, terms: entry.mode === "all-terms" ? [...new Set(entry.query.trim().split(/\s+/u).map(normalize))] : [query] };
}

function exactMatch(filename, blocks, entry) {
  const { query, terms } = parsedQuery(entry); const fields = [normalize(filename)];
  for (const tuple of blocks) fields.push(normalize(tuple[1] ?? ""), normalize(tuple[2]));
  return entry.mode === "all-terms" ? terms.every(term => fields.some(field => field.includes(term))) : fields.some(field => field.includes(query));
}

function exactMatchStored(db, doc, entry) {
  const { query, terms } = parsedQuery(entry); const filename = normalize(doc.filename);
  if (entry.mode === "phrase" && filename.includes(query)) return true;
  const remaining = new Set(terms.filter(term => !filename.includes(term)));
  if (entry.mode === "all-terms" && remaining.size === 0) return true;
  for (const row of db.prepare("SELECT payload FROM chunks WHERE doc_id=? ORDER BY ordinal").iterate(doc.id)) {
    const tuples = JSON.parse(brotliDecompressSync(row.payload).toString("utf8"));
    for (const tuple of tuples) {
      const heading = normalize(tuple[1] ?? ""); const content = normalize(tuple[2]);
      if (entry.mode === "phrase") {
        if (heading.includes(query) || content.includes(query)) return true;
      } else {
        for (const term of remaining) if (heading.includes(term) || content.includes(term)) remaining.delete(term);
        if (remaining.size === 0) return true;
      }
    }
  }
  return false;
}

function exactMatchRaw(db, doc, entry) {
  const { query, terms } = parsedQuery(entry); const filename = normalize(doc.filename);
  if (entry.mode === "phrase" && filename.includes(query)) return true;
  const remaining = new Set(terms.filter(term => !filename.includes(term)));
  if (entry.mode === "all-terms" && remaining.size === 0) return true;
  for (const block of db.prepare("SELECT heading,content FROM blocks WHERE document_id=? ORDER BY ordinal").iterate(doc.id)) {
    const heading = normalize(block.heading ?? ""); const content = normalize(block.content);
    if (entry.mode === "phrase") {
      if (heading.includes(query) || content.includes(query)) return true;
    } else {
      for (const term of remaining) if (heading.includes(term) || content.includes(term)) remaining.delete(term);
      if (remaining.size === 0) return true;
    }
  }
  return false;
}

function candidateIds(db, scheme, entry, docs) {
  const { terms } = parsedQuery(entry);
  const grams = [...new Set(terms.flatMap(term => trigrams(term)))];
  if (!grams.length) return new Set(docs.map(doc => Number(doc.id)));
  if (scheme === "fts-trigram") {
    const quote = gram => `"${gram.replaceAll('"', '""')}"`;
    try { return new Set(db.prepare("SELECT rowid AS id FROM fts_docs WHERE fts_docs MATCH ?").all(grams.map(quote).join(" AND ")).map(row => Number(row.id))); }
    catch { return new Set(docs.map(doc => Number(doc.id))); }
  }
  if (scheme === "bloom-trigram") {
    const filters = new Map(db.prepare("SELECT doc_id,bits,bit_count,hash_count FROM bloom").all().map(row => [Number(row.doc_id), row]));
    return new Set(docs.filter(doc => {
      const row = filters.get(Number(doc.id));
      return row && grams.every(gram => hasBloom(row.bits, Number(row.bit_count), gram, Number(row.hash_count)));
    }).map(doc => Number(doc.id)));
  }
  return new Set(docs.map(doc => Number(doc.id)));
}

function searchPrototype(database, scheme, entries, repetitions = 5) {
  const db = new DatabaseSync(database, { readOnly: true });
  const docs = db.prepare("SELECT id,path,filename FROM documents ORDER BY id").all();
  const results = [];
  for (const entry of entries) {
    const samples = []; let paths = []; let candidateCount = 0;
    for (let run = 0; run < repetitions + 1; run++) {
      const started = performance.now(); const ids = candidateIds(db, scheme, entry, docs); candidateCount = ids.size;
      paths = [];
      for (const doc of docs) {
        const filenameHit = exactMatch(doc.filename, [], entry);
        if (!filenameHit && !ids.has(Number(doc.id))) continue;
        if (filenameHit || exactMatchStored(db, doc, entry)) paths.push(doc.path);
      }
      const elapsed = performance.now() - started; if (run) samples.push(elapsed);
    }
    results.push({ ...entry, matches: paths.sort(), candidateCount, p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95) });
  }
  db.close(); return results;
}

async function worker() {
  const action = process.argv[3];
  if (action === "build") {
    const [baseline, target, scheme] = process.argv.slice(4);
    const started = performance.now(); const summary = buildPrototype(baseline, target, scheme);
    console.log(JSON.stringify({ ...summary, db: undefined, buildMs: performance.now() - started, bytes: (await stat(target)).size })); return;
  }
  if (action === "search") {
    const [database, scheme, encoded] = process.argv.slice(4);
    console.log(JSON.stringify(searchPrototype(database, scheme, JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))))); return;
  }
  if (action === "search-current") {
    const [database, encoded] = process.argv.slice(4);
    const [{ IndexStore }, { search }] = await Promise.all([import("../dist/src/store.js"), import("../dist/src/search.js")]);
    const store = new IndexStore(database); const entries = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const results = [];
    try {
      for (const entry of entries) {
        const samples = []; let matches = [];
        for (let run = 0; run < 6; run++) {
          const started = performance.now();
          matches = search(store, entry.query, 10000, undefined, undefined, entry.mode).map(result => result.path).sort();
          const elapsed = performance.now() - started; if (run) samples.push(elapsed);
        }
        results.push({ ...entry, matches, candidateCount: store.candidates().length,
          p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95) });
      }
    } finally { store.close(); }
    console.log(JSON.stringify(results)); return;
  }
  if (action === "search-raw-stream") {
    const [database, encoded] = process.argv.slice(4); const entries = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const db = new DatabaseSync(database, { readOnly: true }); const docs = db.prepare("SELECT id,path,filename FROM documents ORDER BY id").all();
    const results = [];
    try {
      for (const entry of entries) {
        const samples = []; let matches = [];
        for (let run = 0; run < 6; run++) {
          const started = performance.now(); matches = docs.filter(doc => exactMatchRaw(db, doc, entry)).map(doc => doc.path).sort();
          const elapsed = performance.now() - started; if (run) samples.push(elapsed);
        }
        results.push({ ...entry, matches, candidateCount: docs.length, p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95) });
      }
    } finally { db.close(); }
    console.log(JSON.stringify(results)); return;
  }
  throw new Error(`未知 worker action: ${action}`);
}

async function main() {
  const root = path.resolve(process.argv[2] ?? "");
  if (!root) throw new Error("用法：node scripts/compare-storage-backends.mjs <資料夾> [輸出 JSON]");
  const output = path.resolve(process.argv[3] ?? "docs/storage-backend-comparison.json");
  const work = await mkdtemp(path.join(os.tmpdir(), "lds-storage-compare-"));
  try {
    const data = path.join(work, "current"); await mkdir(data);
    const baselineBuild = await run([path.join(project, "dist/src/cli.js"), "index", root], { LOCALDOCSEARCH_DATA_DIR: data });
    const baseline = path.join(data, "LocalDocSearch", "index.db");
    const encoded = Buffer.from(JSON.stringify(queries)).toString("base64url");
    const baselineExact = await run([self, "--worker", "search-current", baseline, encoded]);
    const rawStreaming = await run([self, "--worker", "search-raw-stream", baseline, encoded]);
    for (let index = 0; index < queries.length; index++) {
      assert.deepEqual(rawStreaming.output[index].matches, baselineExact.output[index].matches, `raw-stream: ${queries[index].label} 結果不同`);
    }
    const schemes = [];
    for (const scheme of ["brotli-doc", "brotli-chunks", "fts-trigram", "bloom-trigram"]) {
      const database = path.join(work, `${scheme}.db`);
      const build = await run([self, "--worker", "build", baseline, database, scheme]);
      const search = await run([self, "--worker", "search", database, scheme, encoded]);
      for (let index = 0; index < queries.length; index++) {
        assert.deepEqual(search.output[index].matches, baselineExact.output[index].matches, `${scheme}: ${queries[index].label} 結果不同`);
      }
      schemes.push({ scheme, bytes: build.output.bytes, buildMs: build.output.buildMs, buildWallMs: build.wallMs,
        buildMaxRssKiB: build.maxRssKiB, extractedTextBytes: build.output.extractedTextBytes,
        compressedPayloadBytes: build.output.compressedBytes, chunkCount: build.output.chunkCount,
        searchMaxRssKiB: search.maxRssKiB, search: search.output.map(({ matches, ...entry }) => ({ ...entry, matchCount: matches.length })) });
    }
    const baselineSize = await stat(baseline);
    const report = { generatedAt: new Date().toISOString(), root, platform: process.platform, arch: process.arch,
      node: process.version, cpu: os.cpus()[0]?.model, ramBytes: os.totalmem(), queryCount: queries.length,
      method: "同一份 0.20.0 解析結果；每個搜尋 worker 暖機 1 次、量測 5 次。所有方案逐查詢比對完整命中集合；候選方案最後仍解壓原文核對。",
      baseline: { bytes: baselineSize.size, buildWallMs: baselineBuild.wallMs, buildMaxRssKiB: baselineBuild.maxRssKiB,
        searchMaxRssKiB: baselineExact.maxRssKiB,
        search: baselineExact.output.map(({ matches, ...entry }) => ({ ...entry, matchCount: matches.length })),
        rawStreaming: { searchMaxRssKiB: rawStreaming.maxRssKiB,
          search: rawStreaming.output.map(({ matches, ...entry }) => ({ ...entry, matchCount: matches.length })) } }, schemes,
      limitations: ["目前測試資料只有 151 份可解析文件，不能直接外推 300 GB。", "原型搜尋回傳完整命中集合但不產生片段與最終排序；產品採用前仍需整合測試。", "一、二字查詢沒有 trigram，候選方案會退回逐文件核對。"],
    };
    await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ output, baselineBytes: report.baseline.bytes,
      schemes: schemes.map(item => ({ scheme: item.scheme, bytes: item.bytes, buildMs: item.buildMs,
        searchMaxRssKiB: item.searchMaxRssKiB,
        p95Ms: Math.max(...item.search.map(query => query.p95Ms)),
        avgCandidates: item.search.reduce((sum, query) => sum + query.candidateCount, 0) / item.search.length })) }, null, 2));
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[2] === "--worker") await worker(); else await main();
