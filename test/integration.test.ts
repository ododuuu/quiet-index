import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, unlink, rm, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { IndexStore } from "../src/store.js";
import { search } from "../src/search.js";
import { sync } from "../src/sync.js";
import { scan, validateRoot, RootError } from "../src/scanner.js";
import { MAX_FILE_BYTES } from "../src/parser.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("M1 scans, indexes, searches and updates local documents", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-test-"));
  const root = path.join(temporary, "中文資料");
  const store = new IndexStore(path.join(temporary, "index.db"));
  try {
    await mkdir(root);
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".git", "ignore.txt"), "秘密關鍵字");
    await writeFile(path.join(root, "~$temp.txt"), "秘密關鍵字");
    await writeFile(path.join(root, "會議.md"), "# 決策\n這裡記錄中文關鍵字。\n");
    await writeFile(path.join(root, "notes.txt"), "first line\n中文關鍵字出現在這一行\n");
    await writeFile(path.join(root, "empty.txt"), "");
    const scanned = await scan(root);
    assert.equal(scanned.paths.length, 3);

    const first = await sync(root, store);
    assert.equal(first.updated, 3);
    assert.equal(store.counts().no_text, 1);
    const matches = search(store, "中文關鍵字");
    assert.equal(matches.length, 2);
    assert.match(matches[0]!.snippet, /中文關鍵字/);
    assert.ok(matches.every(result => result.path.startsWith(root)));
    assert.equal(search(store, "會議.md")[0]!.rank, 4);
    assert.equal(search(store, "決策")[0]!.rank, 2);
    assert.equal(search(store, "不存在").length, 0);

    await writeFile(path.join(root, "會議.md"), "# 新標題\n修改後的搜尋文字，內容變長。\n");
    const modified = await sync(root, store);
    assert.equal(modified.updated, 1);
    assert.equal(search(store, "修改後的搜尋文字").length, 1);
    assert.equal(search(store, "決策").length, 0);

    const again = await sync(root, store);
    assert.equal(again.updated, 0);
    assert.equal(again.unchanged, 3);
    await unlink(path.join(root, "notes.txt"));
    const afterDelete = await sync(root, store);
    assert.equal(afterDelete.removed, 1);
    assert.equal(search(store, "中文關鍵字").length, 0);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("oversized files keep searchable names without reading content", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-test-"));
  const root = path.join(temporary, "docs");
  const store = new IndexStore(path.join(temporary, "index.db"));
  try {
    await mkdir(root);
    const file = await open(path.join(root, "大型檔.txt"), "w");
    try { await file.truncate(MAX_FILE_BYTES + 1); } finally { await file.close(); }
    await sync(root, store);
    assert.equal(store.counts().too_large, 1);
    assert.equal(search(store, "大型檔").length, 1);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("root and query validation reject invalid input", async () => {
  await assert.rejects(validateRoot(path.join(os.tmpdir(), "lds-nonexistent-root-12345")), RootError);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-test-"));
  const store = new IndexStore(path.join(temporary, "index.db"));
  try {
    assert.throws(() => search(store, "  "), /不可為空白/);
    assert.throws(() => search(store, "x", 0), /正整數/);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("compiled CLI indexes and searches through separate processes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lds-cli-"));
  const root = path.join(temporary, "文件");
  const cli = path.resolve("dist/src/cli.js");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: temporary };
  try {
    await mkdir(root);
    await writeFile(path.join(root, "demo.txt"), "CLI 中文查詢");
    const indexed = await execFileAsync(process.execPath, [cli, "index", root], { env });
    assert.match(indexed.stdout, /更新 1/);
    const result = await execFileAsync(process.execPath, [cli, "search", "中文查詢", "--limit", "1"], { env });
    assert.match(result.stdout, /demo\.txt/);
    assert.match(result.stdout, /第 1 行/);
    const status = await execFileAsync(process.execPath, [cli, "status"], { env });
    assert.match(status.stdout, /indexed：1/);
    await assert.rejects(execFileAsync(process.execPath, [cli, "search", "x", "--limit", "0"], { env }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
