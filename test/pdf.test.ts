import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDocument } from "../src/parser.js";
import { search } from "../src/search.js";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizePdfAssetDirectory } from "../src/parsers/pdf.js";

const fixtures = path.resolve("test/fixtures");
const execFileAsync = promisify(execFile);

test("PDF.js asset directories use forward slashes with a trailing slash", () => {
  const directory = normalizePdfAssetDirectory("C:\\Users\\test\\LocalDocSearch\\node_modules\\pdfjs-dist\\cmaps\\");
  assert.equal(directory, "C:/Users/test/LocalDocSearch/node_modules/pdfjs-dist/cmaps/");
  assert.ok(directory.endsWith("/"));
  assert.equal(directory.includes("\\"), false);
});

test("PDF extracts English and Chinese text with page locations", async () => {
  const document = await parseDocument(path.join(fixtures, "text-layer.pdf"));
  assert.equal(document.status, "indexed");
  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0]?.locationKind, "page");
  assert.equal(document.blocks[0]?.locationValue, "第 1 頁");
  assert.match(document.blocks[0]!.content, /First page searchable text/);
  assert.equal(document.blocks[1]?.locationValue, "第 2 頁");
  assert.match(document.blocks[1]!.content, /第二頁中文測試/);
});

test("PDF distinguishes no text, encryption and corruption", async () => {
  const noText = await parseDocument(path.join(fixtures, "no-text.pdf"));
  assert.equal(noText.status, "no_text");
  assert.equal(noText.blocks.length, 0);
  const encrypted = await parseDocument(path.join(fixtures, "encrypted.pdf"));
  assert.equal(encrypted.status, "encrypted");
  assert.equal(encrypted.errorCode, "PDF_ENCRYPTED");
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-pdf-"));
  try {
    const broken = path.join(directory, "broken.pdf");
    await writeFile(broken, "不是 PDF");
    const corrupt = await parseDocument(broken);
    assert.equal(corrupt.status, "error");
    assert.equal(corrupt.errorCode, "PDF_CORRUPT");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("PDF integrates with scanning, indexing and Chinese search", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-pdf-"));
  const root = path.join(directory, "文件");
  const store = new IndexStore(path.join(directory, "index.db"));
  try {
    await mkdir(root);
    for (const name of ["text-layer.pdf", "no-text.pdf", "encrypted.pdf"]) {
      await copyFile(path.join(fixtures, name), path.join(root, name));
    }
    const report = await sync(root, store);
    assert.equal(report.found, 3);
    assert.equal(store.counts().indexed, 1);
    assert.equal(store.counts().no_text, 1);
    assert.equal(store.counts().encrypted, 1);
    assert.match(report.notices[0] ?? "", /沒有可擷取的文字層/);
    const result = search(store, "中文測試");
    assert.equal(result.length, 1);
    assert.equal(result[0]?.location, "第 2 頁");
    assert.equal(search(store, "encrypted.pdf")[0]?.rank, 4);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("index retries an unchanged PDF that previously failed to parse", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-pdf-retry-"));
  const root = path.join(directory, "文件");
  const store = new IndexStore(path.join(directory, "index.db"));
  try {
    await mkdir(root);
    await writeFile(path.join(root, "broken.pdf"), "不是 PDF");
    const first = await sync(root, store);
    assert.equal(first.updated, 1);
    assert.equal(store.counts().error, 1);
    const retried = await sync(root, store);
    assert.equal(retried.updated, 1);
    assert.equal(retried.unchanged, 0);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI reports no-text PDFs and shows PDF page numbers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lds-pdf-cli-"));
  const root = path.join(directory, "文件");
  const cli = path.resolve("dist/src/cli.js");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: directory };
  try {
    await mkdir(root);
    await copyFile(path.join(fixtures, "text-layer.pdf"), path.join(root, "text-layer.pdf"));
    await copyFile(path.join(fixtures, "no-text.pdf"), path.join(root, "no-text.pdf"));
    const indexed = await execFileAsync(process.execPath, [cli, "index", root, "--verbose"], { env });
    assert.match(indexed.stdout, /本次 no_text：1/);
    assert.match(indexed.stdout, /PDF 沒有可擷取的文字層/);
    const found = await execFileAsync(process.execPath, [cli, "search", "中文測試"], { env });
    assert.match(found.stdout, /第 2 頁/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
