import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DocumentRecord } from "../src/model.js";
import { search } from "../src/search.js";
import { runSearchSession, SearchSession, searchSessionPrompt } from "../src/search-session.js";
import { IndexStore } from "../src/store.js";

async function fixture(run: (root: string, store: IndexStore, temp: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m25-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, temp); }
  finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

function document(root: string, name: string, content: string, extra: Partial<DocumentRecord> & { modifiedAtMs?: number; heading?: string | null } = {}): DocumentRecord {
  const blocks = extra.blocks ?? (extra.status === "unsupported" ? [] : [{
    ordinal: 0, heading: extra.heading ?? null, content, locationKind: "line" as const, locationValue: "第 1 行",
  }]);
  return {
    path: path.join(root, name), filename: name, extension: extra.extension ?? ".txt", sizeBytes: content.length,
    modifiedAtMs: extra.modifiedAtMs ?? 1, status: extra.status ?? "indexed", errorCode: extra.errorCode ?? null,
    errorMessage: extra.errorMessage ?? null, blocks,
  };
}

function scripted(answers: Array<string | null>) {
  const output: string[] = [];
  const errors: string[] = [];
  const io = {
    write: (text: string) => output.push(text),
    writeError: (text: string) => errors.push(text),
    ask: async () => answers.shift() ?? null,
  };
  return { io, output, errors };
}

test("M25 keeps original order while filtering a later-page document", () => fixture(async (root, store) => {
  for (let index = 0; index < 45; index++) {
    store.upsert(document(root, `application-${String(index).padStart(2, "0")}.txt`,
      index === 0 ? "正文含 secret-token 與其他內容" : "其他內容", { modifiedAtMs: index }));
  }
  const session = new SearchSession(store, "application");
  const first = session.page(1, 20);
  assert.equal(session.originalTotal, 45);
  assert.equal(first.results.some(hit => hit.path.endsWith("application-00.txt")), false);
  session.append("secret-token");
  const refined = session.page(1, 20);
  assert.equal(refined.total, 1);
  assert.match(refined.results[0]!.path, /application-00\.txt$/);
  assert.equal(refined.results[0]!.condition, "secret-token");
  assert.match(refined.results[0]!.snippet, /secret-token/);
  assert.deepEqual(session.conditions, ["application", "secret-token"]);
}));

test("M25 matches a new condition outside the original snippet", () => fixture(async (root, store) => {
  const padding = "前置說明".repeat(80);
  store.upsert(document(root, "application-report.txt", `${padding} hidden-needle 結尾`));
  store.upsert(document(root, "application-only.txt", "只有 APPLICATION 沒有第二詞"));
  const session = new SearchSession(store, "application");
  const initial = session.page(1, 20);
  const report = initial.results.find(hit => hit.path.endsWith("application-report.txt"));
  assert.ok(report);
  assert.equal(report.snippet.includes("hidden-needle"), false);
  session.append("hidden-needle");
  const refined = session.page(1, 20);
  assert.equal(refined.total, 1);
  assert.match(refined.results[0]!.path, /application-report\.txt$/);
  assert.match(refined.results[0]!.snippet, /hidden-needle/);
}));

test("M25 combines a filename hit with a later body term and keeps original relative order", () => fixture(async (root, store) => {
  store.upsert(document(root, "資料庫.txt", "APPLICATION 在正文", { modifiedAtMs: 1 }));
  store.upsert(document(root, "z-application.txt", "APPLICATION 資料庫 連線", { modifiedAtMs: 2 }));
  const session = new SearchSession(store, "APPLICATION");
  assert.deepEqual(session.page(1, 20).results.map(hit => path.basename(hit.path)), ["z-application.txt", "資料庫.txt"]);
  session.append("資料庫");
  const refined = session.page(1, 20);
  assert.deepEqual(refined.results.map(hit => path.basename(hit.path)), ["z-application.txt", "資料庫.txt"]);
  assert.equal(refined.results[0]!.reason, "內容");
  assert.equal(refined.results[1]!.reason, "檔名包含");
}));

test("M25 applies document-level AND across blocks, phrase, and all-terms", () => fixture(async (root, store) => {
  store.upsert(document(root, "full.txt", "ignored", {
    blocks: [
      { ordinal: 0, heading: null, content: "APPLICATION", locationKind: "line", locationValue: "第 1 行" },
      { ordinal: 1, heading: null, content: "資料庫", locationKind: "line", locationValue: "第 2 行" },
      { ordinal: 2, heading: null, content: "連線", locationKind: "line", locationValue: "第 3 行" },
    ],
  }));
  store.upsert(document(root, "partial.txt", "ignored", {
    blocks: [
      { ordinal: 0, heading: null, content: "APPLICATION", locationKind: "line", locationValue: "第 1 行" },
      { ordinal: 1, heading: null, content: "資料庫", locationKind: "line", locationValue: "第 2 行" },
    ],
  }));
  store.upsert(document(root, "spread.txt", "ignored", {
    blocks: [
      { ordinal: 0, heading: null, content: "foo 第一段", locationKind: "line", locationValue: "第 1 行" },
      { ordinal: 1, heading: null, content: "bar 第二段", locationKind: "line", locationValue: "第 2 行" },
    ],
  }));
  const phrase = new SearchSession(store, "APPLICATION");
  phrase.append("資料庫");
  phrase.append("連線");
  assert.deepEqual(phrase.page(1, 20).results.map(hit => path.basename(hit.path)), ["full.txt"]);
  const allTerms = new SearchSession(store, "foo", undefined, undefined, "all-terms");
  allTerms.append("foo bar");
  assert.equal(allTerms.page(1, 20).total, 1);
  assert.match(allTerms.page(1, 20).results[0]!.path, /spread\.txt$/);
  const exact = new SearchSession(store, "foo");
  exact.append("foo bar");
  assert.equal(exact.currentTotal, 0);
}));

test("M25 respects type and root isolation and does not expand the candidate set", () => fixture(async (root, store, temp) => {
  const other = path.join(temp, "other");
  await mkdir(other);
  store.registerRoot(root);
  store.registerRoot(other);
  store.upsert(document(root, "application.txt", "APPLICATION 資料庫"), root);
  store.upsert(document(root, "application.pdf", "APPLICATION 資料庫", { extension: ".pdf" }), root);
  store.upsert(document(other, "application.txt", "APPLICATION 資料庫"), other);
  const typed = new SearchSession(store, "APPLICATION", [".txt"], root);
  assert.equal(typed.originalTotal, 1);
  typed.append("資料庫");
  assert.equal(typed.currentTotal, 1);
  assert.equal(typed.page(1, 20).results[0]!.path, path.join(root, "application.txt"));
}));

test("M25 metadata-only files match filename layers only", () => fixture(async (root, store) => {
  store.upsert(document(root, "application-config.dat", "", { extension: ".dat", status: "unsupported", blocks: [] }));
  store.upsert(document(root, "application-body.txt", "資料庫正文"));
  const session = new SearchSession(store, "application");
  assert.equal(session.originalTotal, 2);
  session.append("config");
  assert.equal(session.currentTotal, 1);
  assert.match(session.page(1, 20).results[0]!.path, /application-config\.dat$/);
  assert.equal(session.page(1, 20).results[0]!.filenameOnly, true);
  session.back();
  session.append("資料庫");
  assert.equal(session.currentTotal, 1);
  assert.match(session.page(1, 20).results[0]!.path, /application-body\.txt$/);
}));

test("M25 back reset and zero-hit layers preserve history", () => fixture(async (root, store) => {
  store.upsert(document(root, "application.txt", "APPLICATION 資料庫"));
  const session = new SearchSession(store, "APPLICATION");
  session.append("missing-term");
  assert.equal(session.currentTotal, 0);
  assert.deepEqual(session.conditions, ["APPLICATION", "missing-term"]);
  const empty = session.page(1, 20);
  assert.equal(empty.total, 0);
  assert.equal(empty.pageCount, 1);
  assert.equal(session.back(), true);
  assert.equal(session.currentTotal, 1);
  session.append("資料庫");
  session.append("連線");
  assert.equal(session.reset(), true);
  assert.deepEqual(session.conditions, ["APPLICATION"]);
  assert.equal(session.currentTotal, 1);
  assert.equal(session.back(), false);
  assert.equal(session.reset(), false);
}));

test("M25 refined pages do not duplicate or omit documents", () => fixture(async (root, store) => {
  for (let index = 0; index < 25; index++) {
    store.upsert(document(root, `application-${String(index).padStart(2, "0")}.txt`,
      index < 21 ? `keep-${index}` : "drop", { modifiedAtMs: index }));
  }
  const session = new SearchSession(store, "application");
  session.append("keep");
  const first = session.page(1, 10);
  const second = session.page(2, 10);
  const third = session.page(3, 10);
  assert.equal(session.currentTotal, 21);
  assert.equal(new Set([...first.results, ...second.results, ...third.results].map(hit => hit.path)).size, 21);
  assert.deepEqual([first.start, first.end, second.start, second.end, third.start, third.end], [1, 10, 11, 20, 21, 21]);
}));

test("M25 aborts when another connection commits during refine or paging", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m25-changed-"));
  const root = path.join(temp, "docs");
  await mkdir(root);
  const database = path.join(temp, "index.db");
  const store = new IndexStore(database);
  try {
    store.upsert(document(root, "application.txt", "APPLICATION 資料庫"));
    const session = new SearchSession(store, "APPLICATION");
    const writer = new IndexStore(database);
    writer.upsert(document(root, "other.txt", "無關提交"));
    writer.close();
    const harness = scripted(["/ 資料庫"]);
    const code = await runSearchSession(session, {
      pageSize: 20,
      renderResults: (results, write) => { for (const result of results) write(result.path); },
    }, harness.io);
    assert.equal(code, 3);
    assert.ok(harness.errors.some(line => line.includes("SEARCH_INDEX_CHANGED")));
  } finally {
    store.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("M25 session works against a read-only store", () => fixture(async (root, writable, temp) => {
  writable.upsert(document(root, "application.txt", "APPLICATION 資料庫"));
  const store = new IndexStore(path.join(temp, "index.db"), { readOnly: true });
  try {
    const session = new SearchSession(store, "APPLICATION");
    session.append("資料庫");
    assert.equal(session.currentTotal, 1);
    assert.equal(search(store, "APPLICATION").length, 1);
  } finally { store.close(); }
}));

test("M25 interactive runner supports refine back reset paging usage and EOF", () => fixture(async (root, store) => {
  for (let index = 0; index < 3; index++) {
    store.upsert(document(root, `application-${index}.txt`, `APPLICATION 資料庫 ${index}`, { modifiedAtMs: index }));
  }
  const harness = scripted(["n", "n", "p", "/", "  /   ", "/ missing", "back", "/ 資料庫", "reset", "zzz", "q"]);
  const code = await runSearchSession(storeSession(store), {
    pageSize: 2,
    renderResults: (results, write) => write(results.map(hit => path.basename(hit.path)).join(",")),
  }, harness.io);
  assert.equal(code, 0);
  const text = harness.output.join("\n");
  assert.match(text, /搜尋條件：APPLICATION/);
  assert.match(text, /符合 3 份文件（最初 3 份）/);
  assert.match(text, /已是最後一頁/);
  assert.match(text, /請在 \/ 之後輸入縮小條件/);
  assert.match(text, /請輸入 n、p、q、back、reset，或 \/ 關鍵字/);
  assert.match(text, /搜尋條件：APPLICATION → missing/);
  assert.match(text, /符合 0 份文件（最初 3 份）/);
  assert.match(text, /搜尋條件：APPLICATION → 資料庫/);
  assert.ok(harness.output.includes(searchSessionPrompt) === false);
}));

function storeSession(store: IndexStore): SearchSession {
  return new SearchSession(store, "APPLICATION");
}

test("M25 non-interactive CLI keeps paging output and does not wait for refine", () => fixture(async (root, _store, temp) => {
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
  assert.doesNotMatch(first.stdout, /\[back\]/);
  assert.match(first.stdout, /--page 2 --page-size 20/);
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env });
  assert.match(help.stdout, /\/ 關鍵字/);
}));
