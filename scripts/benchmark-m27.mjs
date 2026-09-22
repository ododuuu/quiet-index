import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSharedText } from '../dist/src/parsers/text-decode.js';
import { IndexStore } from '../dist/src/store.js';
import { sync } from '../dist/src/sync.js';

const repeats = 3;
const filesPerEncoding = 40;
const line = 'class Sample { String needle = "搜尋目標"; /* comment */ }\n';
const utf8 = Buffer.from(line.repeat(20));
const big5Line = Buffer.concat([
  Buffer.from('class Sample { String needle = "'),
  Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]),
  Buffer.from('"; /* comment */ }\n'),
]);
const big5 = Buffer.concat(Array.from({ length: 20 }, () => big5Line));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(label, fn) {
  const samples = [];
  for (let index = 0; index < repeats; index++) {
    global.gc?.();
    const before = process.memoryUsage();
    const started = performance.now();
    await fn();
    const elapsedMs = performance.now() - started;
    const after = process.memoryUsage();
    samples.push({ elapsedMs, rss: after.rss, heapUsed: after.heapUsed, rssDelta: after.rss - before.rss });
  }
  return {
    label,
    repeats,
    medianElapsedMs: median(samples.map(item => item.elapsedMs)),
    medianRss: median(samples.map(item => item.rss)),
    samples,
  };
}

const work = await mkdtemp(path.join(os.tmpdir(), 'lds-m27-bench-'));
const utfRoot = path.join(work, 'utf8');
const big5Root = path.join(work, 'big5');
await mkdir(utfRoot); await mkdir(big5Root);
for (let index = 0; index < filesPerEncoding; index++) {
  await writeFile(path.join(utfRoot, `A${index}.java`), utf8);
  await writeFile(path.join(big5Root, `B${index}.java`), big5);
  await writeFile(path.join(utfRoot, `A${index}.sql`), utf8);
  await writeFile(path.join(big5Root, `B${index}.js`), big5);
}
const fileCount = filesPerEncoding * 4;
const bytes = (await stat(path.join(utfRoot, 'A0.java'))).size * filesPerEncoding * 2
  + (await stat(path.join(big5Root, 'B0.java'))).size * filesPerEncoding * 2;

const decodeUtf = await measure('decode-utf8', () => {
  for (let index = 0; index < filesPerEncoding; index++) decodeSharedText(utf8, 'text');
});
const decodeBig5 = await measure('decode-utf8-then-big5', () => {
  for (let index = 0; index < filesPerEncoding; index++) decodeSharedText(big5, 'text');
});

const utfDb = path.join(work, 'utf.db');
const big5Db = path.join(work, 'big5.db');
const indexUtf = await measure('index-utf8', async () => {
  await rm(utfDb, { force: true });
  const store = new IndexStore(utfDb);
  try { await sync(utfRoot, store); } finally { store.close(); }
});
const indexBig5 = await measure('index-big5', async () => {
  await rm(big5Db, { force: true });
  const store = new IndexStore(big5Db);
  try { await sync(big5Root, store); } finally { store.close(); }
});
const utfStore = new IndexStore(utfDb);
await sync(utfRoot, utfStore);
const unchangedUtf = await measure('unchanged-utf8', async () => { await sync(utfRoot, utfStore); });
await writeFile(path.join(utfRoot, 'broken.pdf'), 'not-pdf');
const errorRetry = await measure('error-retry', async () => { await sync(utfRoot, utfStore); });
utfStore.close();
const utfBytes = (await stat(utfDb)).size;
const big5Bytes = (await stat(big5Db)).size;
await rm(work, { recursive: true, force: true });

const report = {
  node: process.version,
  platform: process.platform,
  files: fileCount,
  sourceBytes: bytes,
  decodeUtf, decodeBig5, indexUtf, indexBig5, unchangedUtf, errorRetry,
  indexBytesUtf8: utfBytes,
  indexBytesBig5: big5Bytes,
  note: 'Big5 路徑含嚴格 UTF-8 失敗後回退；新增原始碼正文成本與編碼回退成本分開列出。不得外推為固定加倍或零成本。',
};
const destination = fileURLToPath(new URL('../docs/benchmark-m27.json', import.meta.url));
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  node: report.node,
  files: report.files,
  decodeUtf8Ms: report.decodeUtf.medianElapsedMs,
  decodeBig5Ms: report.decodeBig5.medianElapsedMs,
  indexUtf8Ms: report.indexUtf.medianElapsedMs,
  indexBig5Ms: report.indexBig5.medianElapsedMs,
  unchangedUtf8Ms: report.unchangedUtf.medianElapsedMs,
  errorRetryMs: report.errorRetry.medianElapsedMs,
  indexBytesUtf8: utfBytes,
  indexBytesBig5: big5Bytes,
}, null, 2));
