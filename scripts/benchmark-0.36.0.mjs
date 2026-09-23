import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { IndexStore } from "../dist/src/store.js";
import { sync } from "../dist/src/sync.js";
import { buildIndexProfile, writeIndexProfile } from "../dist/src/profile.js";

const seed = 20260923;
const root = mkdtempSync(path.join(tmpdir(), "lds-bench-036-"));
const baselineDir = process.env.LOCALDOCSEARCH_BASELINE_DIST
  ?? "/tmp/quiet-index/dist/src";
const results = {
  seed,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  formalMinimumNode: "22.17.0",
  measuredOnFormalMinimum: process.versions.node.startsWith("22.17."),
  note: "合成資料。不含路徑、檔名、正文、查詢或環境變數。公司索引未納入。",
  cases: [],
};

function log(message) {
  console.error(`[bench] ${message}`);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function timeReplace(store, blocks, repeats) {
  const samples = [];
  for (let attempt = 0; attempt < repeats; attempt++) {
    const started = performance.now();
    store.upsert({
      path: path.join(root, "replace.txt"),
      filename: "replace.txt",
      extension: ".txt",
      sizeBytes: 12 + attempt,
      modifiedAtMs: 1 + attempt,
      status: "indexed",
      errorCode: null,
      errorMessage: null,
      blocks,
    });
    samples.push(round(performance.now() - started));
  }
  return { samples, median: median(samples) };
}

function plantDocuments(databasePath, count) {
  const db = new DatabaseSync(databasePath);
  db.exec("BEGIN IMMEDIATE");
  const insert = db.prepare(`INSERT INTO documents
    (path, filename, extension, size_bytes, modified_at_ms, indexed_at_ms, status, error_code, error_message, parse_version)
    VALUES (?, ?, '.txt', 8, 1, 1, 'indexed', NULL, NULL, 1)`);
  for (let index = 0; index < count; index++) insert.run(`synthetic://${index}.txt`, `d${index}.txt`);
  db.exec("COMMIT");
  db.close();
}

function plantMappings(databasePath, count) {
  const db = new DatabaseSync(databasePath);
  db.exec("BEGIN IMMEDIATE");
  const block = db.prepare("SELECT id FROM blocks ORDER BY id LIMIT 1").get();
  if (!block) throw new Error("需要至少一個 block 才能種植 mapping");
  const document = db.prepare("SELECT id FROM documents ORDER BY id LIMIT 1").get();
  const insert = db.prepare("INSERT OR IGNORE INTO document_payload_blocks(document_id, payload_ordinal, block_id) VALUES (?, ?, ?)");
  for (let ordinal = 0; ordinal < count; ordinal++) insert.run(document.id, ordinal + 10, block.id);
  db.exec("COMMIT");
  db.close();
}

function vacuumCopy(from, to) {
  const db = new DatabaseSync(from);
  db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`);
  db.close();
}

function dropBlockIndex(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec("DROP INDEX IF EXISTS document_payload_blocks_block_id");
  db.close();
}

function integrity(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  const rows = db.prepare("PRAGMA foreign_key_check").all();
  db.close();
  return rows.length === 0;
}

const blocks = [{ ordinal: 0, heading: null, content: "固定替換文件", locationKind: "line", locationValue: "1" }];
const database = path.join(root, "index.db");
log("建立固定文件與 350,000 筆 metadata");
const store = new IndexStore(database);
store.registerRoot(root);
store.upsert({
  path: path.join(root, "anchor.txt"), filename: "anchor.txt", extension: ".txt", sizeBytes: 4, modifiedAtMs: 1,
  status: "indexed", errorCode: null, errorMessage: null, blocks,
});
store.upsert({
  path: path.join(root, "replace.txt"), filename: "replace.txt", extension: ".txt", sizeBytes: 4, modifiedAtMs: 1,
  status: "indexed", errorCode: null, errorMessage: null, blocks,
});
store.close();
plantDocuments(database, 350_000);

log("種植 100,000 筆無關 mapping");
plantMappings(database, 100_000);
const snap100 = path.join(root, "map-100k.db");
vacuumCopy(database, snap100);
log("種植至 1,000,000 筆無關 mapping");
plantMappings(database, 1_000_000);
const snap1m = path.join(root, "map-1m.db");
vacuumCopy(database, snap1m);

const open100 = new IndexStore(snap100);
const with100 = timeReplace(open100, blocks, 3);
open100.close();
const open1m = new IndexStore(snap1m);
const planWithIndex = open1m.explainBlockLookup();
const with1m = timeReplace(open1m, blocks, 3);
const mappingStats = open1m.contentStats();
open1m.close();

const barePath = path.join(root, "map-1m-no-index.db");
vacuumCopy(snap1m, barePath);
dropBlockIndex(barePath);
const bare = new IndexStore(barePath);
const dropper = new DatabaseSync(barePath);
dropper.exec("DROP INDEX IF EXISTS document_payload_blocks_block_id");
dropper.close();
const planWithoutIndex = bare.explainBlockLookup();
const withoutAtMillion = timeReplace(bare, blocks, 3);
bare.close();

let baselineReplace = null;
try {
  const baselineStore = (await import(pathToFileURL(path.join(baselineDir, "store.js")).href)).IndexStore;
  const old100 = path.join(root, "old-100k.db");
  const old1m = path.join(root, "old-1m.db");
  vacuumCopy(snap100, old100);
  vacuumCopy(snap1m, old1m);
  dropBlockIndex(old100);
  dropBlockIndex(old1m);
  const base100 = new baselineStore(old100);
  const drop100 = new DatabaseSync(old100);
  drop100.exec("DROP INDEX IF EXISTS document_payload_blocks_block_id");
  drop100.close();
  const at100 = timeReplace(base100, blocks, 3);
  base100.close();
  const base1m = new baselineStore(old1m);
  const drop1 = new DatabaseSync(old1m);
  drop1.exec("DROP INDEX IF EXISTS document_payload_blocks_block_id");
  drop1.close();
  const at1m = timeReplace(base1m, blocks, 3);
  base1m.close();
  baselineReplace = { at100k: at100, at1_000_000: at1m };
} catch (error) {
  baselineReplace = { skipped: true, reason: error instanceof Error ? error.name : "BASELINE_UNAVAILABLE" };
}

const ratio = with1m.median / Math.max(with100.median, 0.001);
results.cases.push({
  name: "fixed-document-replace-vs-unrelated-mappings",
  metadataDocuments: 350_000,
  mappings: mappingStats,
  planWithIndex,
  planWithoutIndex,
  withIndex: { 100000: with100, 1000000: with1m },
  withoutIndexAt1_000_000: withoutAtMillion,
  baseline035: baselineReplace,
  ratio1mTo100k: round(ratio),
  foreignKeysOk: integrity(snap1m),
  threshold: "修正後 1,000,000 / 100,000 中位數 <= 2，且查詢計畫使用 block_id 索引、不得 SCAN document_payload_blocks",
  pass: ratio <= 2 && /document_payload_blocks_block_id/.test(planWithIndex) && !/SCAN document_payload_blocks/.test(planWithIndex),
});
log(`mapping ratio ${round(ratio)} pass=${results.cases[0].pass}`);

log("單份 40,000 blocks 替換三次");
const wideDb = path.join(root, "wide.db");
const wide = new IndexStore(wideDb);
wide.registerRoot(root);
const wideBlocks = Array.from({ length: 40_000 }, (_, ordinal) => ({
  ordinal, heading: null, content: `b${ordinal}`, locationKind: "line", locationValue: String(ordinal + 1),
}));
const wideSamples = timeReplace(wide, wideBlocks, 3);
const wideStats = wide.contentStats();
wide.close();
results.cases.push({
  name: "single-document-40000-blocks",
  samples: wideSamples,
  blocks: wideStats.blocks,
  payloads: wideStats.payloads,
  foreignKeysOk: integrity(wideDb),
});

if (!process.argv.includes("--skip-e2e")) {
  log("10,000 小檔端到端");
  const docs = path.join(root, "docs");
  mkdirSync(docs);
  for (let index = 0; index < 10_000; index++) {
    writeFileSync(path.join(docs, `f${String(index).padStart(5, "0")}.txt`), `seed ${seed} item ${index}\n`);
  }

  async function cold(Store, syncFn, label, repeats) {
    const samples = [];
    for (let attempt = 0; attempt < repeats; attempt++) {
      const dbPath = path.join(root, `${label}-${attempt}.db`);
      const instance = new Store(dbPath);
      const started = performance.now();
      const report = await syncFn(docs, instance);
      const rss = process.memoryUsage().rss;
      instance.close();
      samples.push({
        ms: round(performance.now() - started),
        parserCalls: report.parserCalls,
        unchanged: report.unchanged,
        updated: report.updated,
        rss,
      });
      if (attempt < repeats - 1) rmSync(dbPath, { force: true });
    }
    return samples;
  }

  const first = await cold(IndexStore, sync, "e2e36", 3);
  const keep = path.join(root, "e2e36-2.db");
  const kept = new IndexStore(keep);
  const unchanged = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now();
    const report = await sync(docs, kept);
    unchanged.push({ ms: round(performance.now() - started), parserCalls: report.parserCalls, unchanged: report.unchanged, rss: process.memoryUsage().rss });
  }
  const changed = [];
  for (let batch = 0; batch < 3; batch++) {
    for (let index = batch * 100; index < (batch + 1) * 100; index++) {
      writeFileSync(path.join(docs, `f${String(index).padStart(5, "0")}.txt`), `changed ${seed} ${batch} ${index}\n`);
    }
    const started = performance.now();
    const report = await sync(docs, kept);
    changed.push({ ms: round(performance.now() - started), parserCalls: report.parserCalls, updated: report.updated, unchanged: report.unchanged });
  }
  const profileSamples = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now();
    const report = await sync(docs, kept);
    const content = kept.contentStats();
    const profilePath = path.join(root, `profile-${attempt}.json`);
    writeIndexProfile(profilePath, buildIndexProfile({
      status: "complete",
      found: report.found, checked: report.checked, updated: report.updated, unchanged: report.unchanged,
      removed: report.removed, parserCalls: report.parserCalls, failedDocuments: report.failedDocuments,
      reasonsAttempted: report.reasonsAttempted, reasonsCommitted: report.reasonsCommitted,
      formats: report.formats, sourceBytes: report.sourceBytes, blocks: content.blocks, payloads: content.payloads,
      mappings: content.mappings, phasesMs: report.phasesMs, reservoir: report.sample,
      peakRssBytes: report.peakRssBytes, slowest: report.slowest,
    }));
    const profileText = readFileSync(profilePath, "utf8");
    profileSamples.push({
      ms: round(performance.now() - started),
      bytes: statSync(profilePath).size,
      anonymous: !profileText.includes(docs) && !profileText.includes("f00000"),
    });
  }
  kept.close();

  let baselineUnchanged = null;
  try {
    const baseline = await import(pathToFileURL(path.join(baselineDir, "store.js")).href);
    const baselineSync = (await import(pathToFileURL(path.join(baselineDir, "sync.js")).href)).sync;
    const baseFirst = await cold(baseline.IndexStore, baselineSync, "e2e35", 3);
    const baseKeep = new baseline.IndexStore(path.join(root, "e2e35-2.db"));
    const baseSecond = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = performance.now();
      const report = await baselineSync(docs, baseKeep);
      baseSecond.push({ ms: round(performance.now() - started), parserCalls: report.parserCalls, unchanged: report.unchanged });
    }
    baseKeep.close();
    baselineUnchanged = { first: baseFirst, unchanged: baseSecond, unchangedMedianMs: median(baseSecond.map(item => item.ms)) };
  } catch (error) {
    baselineUnchanged = { skipped: true, reason: error instanceof Error ? error.name : "BASELINE_UNAVAILABLE" };
  }

  const unchangedMedian = median(unchanged.map(item => item.ms));
  const profileMedian = median(profileSamples.map(item => item.ms));
  const baselineMedian = baselineUnchanged?.unchangedMedianMs;
  const slowerThanBaseline = typeof baselineMedian === "number" ? (unchangedMedian - baselineMedian) / Math.max(baselineMedian, 0.001) : null;
  const profileOverhead = (profileMedian - unchangedMedian) / Math.max(unchangedMedian, 0.001);
  results.cases.push({
    name: "ten-thousand-small-files",
    first,
    unchanged,
    changed,
    unchangedMedianMs: unchangedMedian,
    zeroParser: unchanged.every(item => item.parserCalls === 0 && item.unchanged === 10_000),
    baseline035: baselineUnchanged,
    slowerThanBaseline,
    profileSamples,
    profileOverhead,
    passUnchanged: unchanged.every(item => item.parserCalls === 0)
      && (slowerThanBaseline === null || slowerThanBaseline <= 0.2),
    passProfile: profileOverhead <= 0.1 && profileSamples.every(item => item.anonymous),
  });
  log(`unchanged median ${unchangedMedian} vs 0.35 ${baselineMedian ?? "n/a"} overhead ${round(profileOverhead)}`);
}

log("舊文字版本、CSV 未支援重試、錯誤重試與 Big5");
const behaviorDir = path.join(root, "behavior");
mkdirSync(behaviorDir);
const textFile = path.join(behaviorDir, "note.txt");
const csvFile = path.join(behaviorDir, "rows.csv");
const errFile = path.join(behaviorDir, "bad.txt");
writeFileSync(textFile, "舊索引文字\n");
writeFileSync(csvFile, "名稱,數量\n甲,1\n");
writeFileSync(errFile, "錯誤重試\n");
writeFileSync(path.join(behaviorDir, "big5.txt"), Buffer.from([0xa4, 0xa4, 0x0a]));
const behaviorDb = path.join(root, "behavior.db");
const behavior = new IndexStore(behaviorDb);
const firstBehavior = await sync(behaviorDir, behavior);
behavior.close();
const sql = new DatabaseSync(behaviorDb);
sql.exec("PRAGMA foreign_keys = ON");
sql.prepare("UPDATE documents SET parse_version = NULL WHERE extension = '.txt' AND filename = 'note.txt'").run();
sql.prepare("UPDATE documents SET status = 'unsupported', parse_version = NULL WHERE extension = '.csv'").run();
sql.prepare("UPDATE documents SET status = 'error', error_code = 'PARSE_ERROR', parse_version = 1 WHERE filename = 'bad.txt'").run();
sql.close();
const behavior2 = new IndexStore(behaviorDb);
const secondBehavior = await sync(behaviorDir, behavior2);
const thirdBehavior = await sync(behaviorDir, behavior2);
behavior2.close();
results.cases.push({
  name: "upgrade-retry-and-big5",
  firstParserCalls: firstBehavior.parserCalls,
  second: {
    parserCalls: secondBehavior.parserCalls,
    textUpgrade: secondBehavior.reasonsAttempted["text-upgrade"],
    unsupportedRetry: secondBehavior.reasonsAttempted["unsupported-retry"],
    errorRetry: secondBehavior.reasonsAttempted["error-retry"],
  },
  thirdParserCalls: thirdBehavior.parserCalls,
  thirdUnchanged: thirdBehavior.unchanged,
  pass: secondBehavior.reasonsAttempted["text-upgrade"] === 1
    && secondBehavior.reasonsAttempted["unsupported-retry"] === 1
    && secondBehavior.reasonsAttempted["error-retry"] === 1
    && thirdBehavior.parserCalls === 0
    && thirdBehavior.unchanged === firstBehavior.found,
});

const out = path.resolve("docs/benchmark-0.36.0.json");
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
console.log(`原始結果：${out}`);
if (results.cases.some(item => item.pass === false || item.passUnchanged === false || item.passProfile === false)) process.exitCode = 1;
rmSync(root, { recursive: true, force: true });
