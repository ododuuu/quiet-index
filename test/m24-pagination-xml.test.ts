import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDocument } from "../src/parser.js";
import { createSearchResultSet, search } from "../src/search.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";

async function fixture(run: (root: string, store: IndexStore, temp: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m24-pages-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, temp); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

test("M24 search result set reports totals and exposes stable non-overlapping pages", () => fixture(async (root, store) => {
  for (let index = 0; index < 45; index++) {
    const file = path.join(root, `application-${String(index).padStart(2, "0")}.txt`);
    store.upsert({ path: file, filename: path.basename(file), extension: ".txt", sizeBytes: 1, modifiedAtMs: index,
      status: "indexed", errorCode: null, errorMessage: null, blocks: [{ ordinal: 0, heading: null,
        content: index === 0 ? "正文也有 application" : "其他內容", locationKind: "line", locationValue: "第 1 行" }] });
  }
  const resultSet = createSearchResultSet(store, "application");
  const first = resultSet.page(1, 20);
  const second = resultSet.page(2, 20);
  const third = resultSet.page(3, 20);
  assert.equal(resultSet.total, 45);
  assert.deepEqual([first.start, first.end, first.pageCount], [1, 20, 3]);
  assert.deepEqual([second.start, second.end], [21, 40]);
  assert.deepEqual([third.start, third.end, third.results.length], [41, 45, 5]);
  assert.equal(new Set([...first.results, ...second.results, ...third.results].map(hit => hit.path)).size, 45);
  assert.throws(() => resultSet.page(4, 20), /共有 3 頁/);
}));

test("M24 XML raw text keeps tags attributes values and source line numbers", () => fixture(async (root, store) => {
  const file = path.join(root, "My Connections.xml");
  const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<Connections>", ...Array.from({ length: 8 }, (_, i) => `  <Item id=\"${i}\"/>`),
    "  <Connection role=\"APPLICATION\">", "    <User>dbla</User>", "  </Connection>", "</Connections>"];
  await writeFile(file, lines.join("\n"));
  const report = await sync(root, store);
  assert.equal(report.statuses.indexed, 1);
  assert.equal(search(store, "dbla")[0]?.location, "第 12 行");
  assert.match(search(store, "role=\"APPLICATION\"")[0]!.snippet, /APPLICATION/);
  assert.match(search(store, "<User>")[0]!.snippet, /<User>/);
}));

test("M24 XML supports UTF-16 BOM, indexes malformed markup, and reports unsupported declarations", () => fixture(async (root, store) => {
  const utf16 = path.join(root, "utf16.xml");
  const encoded = Buffer.from("<root>寬字元 needle</root>", "utf16le");
  await writeFile(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]));
  const malformed = path.join(root, "malformed.xml");
  await writeFile(malformed, "<root><broken key=\"still-searchable\">");
  const unknown = path.join(root, "unknown.xml");
  await writeFile(unknown, "<?xml version=\"1.0\" encoding=\"x-localdocsearch-nope\"?><root>hidden</root>");
  await sync(root, store);
  assert.equal(search(store, "needle")[0]?.path, utf16);
  assert.equal(search(store, "still-searchable")[0]?.path, malformed);
  assert.equal(store.getDocument(unknown)?.status, "error");
  const internal = store as unknown as { db: { prepare(sql: string): { get(value: string): { error_code: string } } } };
  assert.equal(internal.db.prepare("SELECT error_code FROM documents WHERE path = ?").get(unknown).error_code, "XML_ENCODING_UNSUPPORTED");
}));

test("M24 one normal sync upgrades an unchanged XML row that was formerly unsupported", () => fixture(async (root, store) => {
  const file = path.join(root, "legacy.xml");
  await writeFile(file, "<User>dbla-upgraded</User>");
  const info = await stat(file);
  store.registerRoot(root);
  store.upsert({ path: file, filename: path.basename(file), extension: ".xml", sizeBytes: info.size, modifiedAtMs: info.mtimeMs,
    status: "unsupported", errorCode: null, errorMessage: null, blocks: [] }, root);
  const report = await sync(root, store);
  assert.equal(report.reprocessed, 1);
  assert.equal(report.parserCalls, 1);
  assert.equal(search(store, "dbla-upgraded").length, 1);
}));

test("M24 CLI explicit pages show total range and a continuation hint", () => fixture(async (root, _store, temp) => {
  const data = path.join(temp, "data");
  await mkdir(data);
  for (let index = 0; index < 25; index++) await writeFile(path.join(root, `match-${index}.txt`), "body");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: data };
  const cli = path.resolve("dist/src/cli.js");
  const indexed = spawnSync(process.execPath, [cli, "index", root], { encoding: "utf8", env, timeout: 30_000 });
  assert.equal(indexed.status, 0, indexed.stderr);
  const first = spawnSync(process.execPath, [cli, "search", "match"], { encoding: "utf8", env, timeout: 30_000 });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /符合 25 份文件；第 1\/2 頁，本頁 1–20/);
  assert.match(first.stdout, /--page 2 --page-size 20/);
  const second = spawnSync(process.execPath, [cli, "search", "match", "--page", "2"], { encoding: "utf8", env, timeout: 30_000 });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /第 2\/2 頁，本頁 21–25/);
  const invalid = spawnSync(process.execPath, [cli, "search", "match", "--limit", "2", "--page", "2"], { encoding: "utf8", env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /不可與 --page/);
  const beyond = spawnSync(process.execPath, [cli, "search", "match", "--page", "3"], { encoding: "utf8", env });
  assert.equal(beyond.status, 2);
  assert.match(beyond.stderr, /共有 2 頁/);
}));
