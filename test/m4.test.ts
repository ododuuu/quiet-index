import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { IgnoreConfigurationError, IgnoreRules } from "../src/ignore.js";
import type { DocumentRecord } from "../src/model.js";
import { scan } from "../src/scanner.js";
import { search } from "../src/search.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";

const execFileAsync = promisify(execFile);

test("ignore rules handle root paths, directory names and glob patterns", () => {
  const rules = IgnoreRules.parse("# comment\n/cache/\narchive/\n*.bak\nreports/**/draft?.txt\n");
  assert.equal(rules.matches("cache", true), true);
  assert.equal(rules.matches("nested/cache", true), false);
  assert.equal(rules.matches("nested/archive", true), true);
  assert.equal(rules.matches("notes.bak", false), true);
  assert.equal(rules.matches("reports/2026/draft1.txt", false), true);
  assert.equal(rules.matches("reports/draft-long.txt", false), false);
  assert.throws(() => IgnoreRules.parse("!keep.txt"), IgnoreConfigurationError);
});

test("scanner applies .localdocsearchignore without weakening built-in exclusions", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-m4-ignore-"));
  try {
    await mkdir(path.join(temporary, "archive"));
    await mkdir(path.join(temporary, "keep"));
    await mkdir(path.join(temporary, "node_modules"));
    await writeFile(path.join(temporary, ".localdocsearchignore"), "archive/\n*.skip.txt\n");
    await writeFile(path.join(temporary, "archive", "secret.txt"), "skip");
    await writeFile(path.join(temporary, "keep", "visible.txt"), "keep");
    await writeFile(path.join(temporary, "keep", "hidden.skip.txt"), "skip");
    await writeFile(path.join(temporary, "node_modules", "dependency.txt"), "skip");
    const result = await scan(temporary);
    assert.deepEqual(result.paths.map(file => path.basename(file)), [".localdocsearchignore", "visible.txt"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("rebuild reparses every included file and exclusions remain scoped to their root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-m4-rebuild-"));
  const firstRoot = path.join(temporary, "first");
  const secondRoot = path.join(temporary, "second");
  const store = new IndexStore(path.join(temporary, "index.db"));
  try {
    await mkdir(firstRoot);
    await mkdir(secondRoot);
    await writeFile(path.join(firstRoot, "first.txt"), "第一個根目錄");
    await writeFile(path.join(secondRoot, "second.txt"), "第二個根目錄");
    await sync(firstRoot, store);
    const rebuilt = await sync(firstRoot, store, { rebuild: true });
    assert.equal(rebuilt.updated, 1);
    assert.equal(rebuilt.unchanged, 0);
    await writeFile(path.join(firstRoot, ".localdocsearchignore"), "first.txt\n");
    const excluded = await sync(firstRoot, store);
    assert.equal(excluded.removed, 1);
    assert.equal(search(store, "第一個根目錄").length, 0);
    await sync(secondRoot, store);
    assert.equal(search(store, "第一個根目錄").length, 0);
    assert.equal(search(store, "第二個根目錄").length, 1);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("an incomplete attempt does not replace the last successful sync time", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-m4-status-"));
  const store = new IndexStore(path.join(temporary, "index.db"));
  try {
    store.recordSync(temporary, true, [], []);
    const successfulAt = store.getLastSyncReport().successfulAt;
    await new Promise(resolve => setTimeout(resolve, 2));
    store.recordSync(temporary, false, ["無法讀取資料夾"], []);
    const report = store.getLastSyncReport();
    assert.equal(report.complete, false);
    assert.equal(report.successfulAt, successfulAt);
    assert.notEqual(report.attemptedAt, successfulAt);
    assert.deepEqual(report.errors, ["無法讀取資料夾"]);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("document replacement is atomic when a block insert fails", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-m4-atomic-"));
  const store = new IndexStore(path.join(temporary, "index.db"));
  const original: DocumentRecord = {
    path: path.join(temporary, "atomic.txt"), filename: "atomic.txt", extension: ".txt",
    sizeBytes: 8, modifiedAtMs: 1, status: "indexed", errorCode: null, errorMessage: null,
    blocks: [{ ordinal: 0, heading: null, content: "原始內容", locationKind: "line", locationValue: "第 1 行" }],
  };
  try {
    store.upsert(original);
    assert.throws(() => store.upsert({ ...original, modifiedAtMs: 2, blocks: [
      { ...original.blocks[0]!, content: "不應留下" },
      { ...original.blocks[0]!, content: "重複序號" },
    ] }));
    assert.equal(search(store, "原始內容").length, 1);
    assert.equal(search(store, "不應留下").length, 0);
    assert.equal(store.getDocument(original.path)?.modified_at_ms, 1);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CLI rebuild and status expose rebuild results and document errors", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-m4-cli-"));
  const root = path.join(temporary, "docs");
  const cli = path.resolve("dist/src/cli.js");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temporary, "data") };
  try {
    await mkdir(root);
    await writeFile(path.join(root, "good.txt"), "可以搜尋");
    await writeFile(path.join(root, "broken.pdf"), "不是 PDF");
    await execFileAsync(process.execPath, [cli, "index", root], { env });
    const status = await execFileAsync(process.execPath, [cli, "status"], { env });
    assert.match(status.stdout, /最近同步完整：是/);
    assert.match(status.stdout, /目前索引文件問題：1/);
    assert.doesNotMatch(status.stdout, /PDF_CORRUPT/);
    const issues = await execFileAsync(process.execPath, [cli, "status", "--issues"], { env });
    assert.match(issues.stdout, /PDF_CORRUPT/);
    const rebuilt = await execFileAsync(process.execPath, [cli, "rebuild"], { env });
    assert.match(rebuilt.stdout, /重建完成/);
    assert.match(rebuilt.stdout, /更新 2、未變更 0/);
    await writeFile(path.join(root, ".localdocsearchignore"), "!good.txt\n");
    try {
      await execFileAsync(process.execPath, [cli, "index", root], { env });
      assert.fail("invalid ignore configuration should fail");
    } catch (error) {
      assert.equal((error as { code?: number }).code, 3);
      assert.match((error as { stderr?: string }).stderr ?? "", /不支援以 ! 重新納入/);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
