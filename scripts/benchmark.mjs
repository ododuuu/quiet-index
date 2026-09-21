import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndexStore } from '../dist/src/store.js';
import { generateDataset, expectedFiles, queries } from './dataset.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(project, 'dist/src/cli.js');
const monitor = path.join(project, 'scripts/measure-process.mjs');
const output = path.resolve(process.argv[2] ?? 'docs/benchmark-local.json');
const storageType = process.argv[3] ?? '未填寫（請以第三個參數註明 SSD／HDD／網路磁碟）';
const work = await mkdtemp(path.join(os.tmpdir(), 'lds-benchmark-'));
const samples = [];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

function run(args, dataDir) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = fork(cli, args, { cwd: project, silent: true, execArgv: ['--import', monitor],
      env: { ...process.env, LOCALDOCSEARCH_DATA_DIR: dataDir } });
    let stdout = ''; let stderr = ''; let metrics;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', value => { metrics = value; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`CLI 結束碼 ${code}: ${stderr}`));
      else if (!metrics) reject(new Error('被測程序沒有回報記憶體量測。'));
      else resolve({ ms: performance.now() - start, ...metrics, stdout });
    });
  });
}
function openStore(dataDir) { return new IndexStore(path.join(dataDir, 'LocalDocSearch/index.db')); }
function checkIndex(dataDir, expectedCount) {
  const store = openStore(dataDir);
  try {
    const counts = store.counts();
    assert.equal(counts.indexed, expectedCount);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), expectedCount);
    return { ...store.getLastSyncReport().summary, blockCount: store.candidates().reduce((sum, d) => sum + d.blocks.length, 0) };
  } finally { store.close(); }
}
async function databaseBytes(dataDir) {
  let bytes = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { bytes += (await stat(path.join(dataDir, `LocalDocSearch/index.db${suffix}`))).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return bytes;
}
async function sourceHash() {
  const hash = createHash('sha256');
  async function walk(folder) {
    for (const entry of (await readdir(path.join(project, folder), { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : 1)) {
      const relative = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else { hash.update(relative.replaceAll('\\', '/')); hash.update(await readFile(path.join(project, relative))); }
    }
  }
  await walk('src');
  hash.update(await readFile(path.join(project, 'package-lock.json')));
  return hash.digest('hex');
}

try {
  const scenarios = { initial: [], unchanged: [], changed: [] };
  let manifest; let searchRoot; let searchData; let indexBytes; let blockCount;
  for (let repetition = 0; repetition < 3; repetition++) {
    console.log(`索引量測 ${repetition + 1}/3：建立固定資料集`);
    const root = path.join(work, `run${repetition}`, '中文 文件');
    const data = path.join(work, `run${repetition}`, 'data');
    manifest = await generateDataset(root);
    const initial = await run(['index', root], data);
    const initialReport = checkIndex(data, 1000);
    assert.equal(initialReport.parserCalls, 1000);
    scenarios.initial.push({ ...initial, stdout: undefined, summary: initialReport });
    const unchanged = await run(['index', root], data);
    const unchangedReport = checkIndex(data, 1000);
    assert.equal(unchangedReport.parserCalls, 0);
    assert.equal(unchangedReport.unchanged, 1000);
    scenarios.unchanged.push({ ...unchanged, stdout: undefined, summary: unchangedReport });
    if (repetition === 0) {
      searchRoot = root;
      searchData = path.join(work, 'search-data');
      await cp(data, searchData, { recursive: true });
      indexBytes = await databaseBytes(searchData);
      blockCount = initialReport.blockCount;
    }
    const textFiles = manifest.documents.filter(d => d.extension === '.txt');
    for (const file of textFiles.slice(0, 10)) await unlink(path.join(root, file.filename));
    for (const file of textFiles.slice(10, 20)) {
      await writeFile(path.join(root, file.filename), '修改後內容 changed-marker');
      await utimes(path.join(root, file.filename), 1800000000, 1800000000);
    }
    for (let n = 0; n < 10; n++) await writeFile(path.join(root, `新增-${n}.txt`), '新增內容 added-marker');
    const changed = await run(['index', root], data);
    const changedReport = checkIndex(data, 1000);
    assert.equal(changedReport.added, 10); assert.equal(changedReport.reprocessed, 10);
    assert.equal(changedReport.removed, 10); assert.equal(changedReport.parserCalls, 20);
    const changedStore = openStore(data);
    try {
      for (const file of textFiles.slice(0, 10)) assert.equal(changedStore.getDocument(path.join(root, file.filename)), undefined);
      const candidates = changedStore.candidates();
      assert.equal(candidates.filter(d => d.blocks.some(b => b.content === '修改後內容 changed-marker')).length, 10);
      assert.equal(candidates.filter(d => d.blocks.some(b => b.content === '新增內容 added-marker')).length, 10);
    } finally { changedStore.close(); }
    scenarios.changed.push({ ...changed, stdout: undefined, summary: changedReport });
  }
  const searchResults = [];
  for (const [index, entry] of queries.entries()) {
    console.log(`搜尋量測 ${index + 1}/${queries.length}：${entry.query}`);
    const expected = expectedFiles(manifest, entry.query, entry.types);
    const fullExpected = expectedFiles(manifest, entry.query, entry.types, 1000);
    const args = ['search', entry.query, '--limit', '20', ...(entry.types ? ['--type', entry.types] : [])];
    const measured = [];
    function actualFiles(stdout) {
      return stdout.split(/\r?\n/).filter(line => line.startsWith(searchRoot + path.sep))
        .map(line => path.basename(line.replace(/ \(\.[a-z]+\)$/, '')));
    }
    // 先核對全部命中，再量測預設上限；不把漏回文件當成速度改善。
    const all = await run(['search', entry.query, '--limit', '1000', ...(entry.types ? ['--type', entry.types] : [])], searchData);
    assert.deepEqual(actualFiles(all.stdout), fullExpected);
    for (let i = 0; i < 13; i++) {
      const sample = await run(args, searchData);
      assert.deepEqual(actualFiles(sample.stdout), expected);
      if (i >= 3) { const { stdout, ...metrics } = sample; measured.push(metrics); samples.push(metrics.ms); }
    }
    searchResults.push({ ...entry, expectedFiles: expected, totalMatches: fullExpected.length, samples: measured,
      p50Ms: percentile(measured.map(s => s.ms), .5), p95Ms: percentile(measured.map(s => s.ms), .95) });
  }
  const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  let revision = '未提供 Git revision';
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(); } catch {}
  const report = {
    generatedAt: new Date().toISOString(), platform: process.platform, release: os.release(), arch: process.arch,
    node: process.version, cpu: os.cpus()[0]?.model, ramBytes: os.totalmem(), storageType,
    version: pkg.version, revision, sourceSha256: await sourceHash(), dependencies: pkg.dependencies,
    dataset: { version: manifest.version, seed: manifest.seed, count: manifest.count, formatCounts: manifest.formatCounts,
      sourceBytes: manifest.sourceBytes, blockCount, indexBytes },
    method: '每組暖機 3 次、正式 10 次；獨立 CLI 程序啟動至結束，包含輸出及量測預載；nearest-rank；limit=20。',
    memoryMethod: 'maxRssKiB 為 Node resourceUsage 的 OS 峰值（KiB）；sampledPeakRss 為 5ms 取樣（bytes，可能漏短暫峰值）。',
    limitation: '合成小文件；Office 為解析器所需的最小 XML 套件，未保證可供 Office 編輯；PDF 重用兩頁中英文字層樣本。不能推論大型／複雜實際文件表現。',
    index: Object.fromEntries(Object.entries(scenarios).map(([key, runs]) => [key, { runs, medianMs: percentile(runs.map(r => r.ms), .5) }])),
    search: { p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95), queries: searchResults },
    correctness: { fullResultsChecked: true, incrementalChangesChecked: true, unchangedParserCalls: 0 },
    targetPassed: percentile(samples, .95) < 2000 && searchResults.every(q => q.p95Ms < 2000),
    windowsAcceptance: '需由使用者在公司 Windows 回報；本報告僅代表上述 platform。',
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`已保存 ${output}\np95=${report.search.p95Ms.toFixed(2)} ms；目標${report.targetPassed ? '達成' : '未達成'}`);
  if (!report.targetPassed) process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
