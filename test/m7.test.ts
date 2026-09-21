import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { IndexStore } from "../src/store.js";
import { sync } from "../src/sync.js";
import { search } from "../src/search.js";
import { documentReference } from "../src/document-reference.js";
import { resolveDocument, actOnDocument, launchPlan, executeLaunch } from "../src/open-document.js";

async function fixture(run: (root: string, store: IndexStore, temp: string) => Promise<void>) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m7-"));
  const root = path.join(temp, "中文 根目錄"); await mkdir(root);
  const store = new IndexStore(path.join(temp, "index.db"));
  try { await run(root, store, temp); } finally { store.close(); await rm(temp, { recursive: true, force: true }); }
}

test("M7 references survive ranking changes and open only on explicit action", () => fixture(async (root, store) => {
  const file = path.join(root, "文件 & $價格 [1], '完成'.txt");
  await writeFile(file, "開啟關鍵字"); await sync(root, store);
  const first = search(store, "開啟關鍵字")[0]!;
  await writeFile(path.join(root, "開啟關鍵字.txt"), "另一文件"); await sync(root, store);
  assert.equal(search(store, "開啟關鍵字")[1]?.reference, first.reference);
  let launches = 0;
  const launch = async () => { launches++; };
  const target = await actOnDocument(store, first.reference, "open", true, launch);
  assert.equal(target.path.endsWith(path.basename(file)), true);
  assert.equal(launches, 0);
  await actOnDocument(store, first.reference, "open", false, launch);
  assert.equal(launches, 1);
  await writeFile(file, "開啟關鍵字已修改且內容更長");
  assert.equal((await resolveDocument(store, first.reference)).changed, true);
}));

test("M7 rejects deleted sources, invalid references and reused IDs", () => fixture(async (root, store) => {
  const file = path.join(root, "第一份.txt"); await writeFile(file, "keyword"); await sync(root, store);
  const ref = search(store, "keyword")[0]!.reference;
  await assert.rejects(resolveDocument(store, "1"), { code: "ACTION_REFERENCE_INVALID" });
  await rm(file);
  await assert.rejects(resolveDocument(store, ref), { code: "ACTION_SOURCE_UNAVAILABLE" });
  await sync(root, store);
  await writeFile(path.join(root, "第二份.txt"), "keyword"); await sync(root, store);
  assert.notEqual(search(store, "keyword")[0]!.reference, ref);
  await assert.rejects(resolveDocument(store, ref), { code: "ACTION_REFERENCE_STALE" });
}));

test("M7 refuses directories, links and removed root references", () => fixture(async (root, store, temp) => {
  const file = path.join(root, "來源.txt"); await writeFile(file, "keyword"); await sync(root, store);
  const row = store.getDocument(file)!;
  const ref = documentReference(row.id, row.path);
  await rm(file); await mkdir(file);
  await assert.rejects(resolveDocument(store, ref), { code: "ACTION_NOT_FILE" });
  await rm(file, { recursive: true });
  const outside = path.join(temp, "外部.txt"); await writeFile(outside, "keyword");
  if (process.platform !== "win32") {
    await symlink(outside, file);
    await assert.rejects(resolveDocument(store, ref), { code: "ACTION_LINK_REJECTED" });
  }
  store.removeRoot(root);
  await assert.rejects(resolveDocument(store, ref), { code: "ACTION_REFERENCE_STALE" });
  const other = path.join(temp, "新根目錄"); await mkdir(other); await sync(other, store);
  await assert.rejects(resolveDocument(store, ref), { code: "ACTION_REFERENCE_STALE" });
}));

test("M7 detects a parent directory replaced by a symlink", () => fixture(async (root, store, temp) => {
  const nested = path.join(root, "子目錄"); await mkdir(nested);
  await writeFile(path.join(nested, "來源.txt"), "keyword"); await sync(root, store);
  const ref = search(store, "keyword")[0]!.reference;
  await rm(nested, { recursive: true });
  const target = path.join(temp, "其他"); await mkdir(target);
  await writeFile(path.join(target, "來源.txt"), "other");
  await symlink(target, nested, "junction");
  await assert.rejects(resolveDocument(store, ref), { code: "ACTION_LINK_REJECTED" });
}));

test("M7 Windows launch uses data arguments without shell interpolation or policy bypass", () => {
  const name = "C:\\文件 夾\\A & $x; $(whoami) [1], '文件'.txt";
  for (const action of ["open", "reveal"] as const) {
    const plan = launchPlan(action, name, "win32", { SystemRoot: "C:\\Windows" });
    assert.equal(plan.env.LOCALDOCSEARCH_ACTION_PATH, name);
    assert.equal(plan.executable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const script = Buffer.from(plan.args.at(-1)!, "base64").toString("utf16le");
    assert.equal(script.includes(name), false);
    assert.match(script, /\$env:LOCALDOCSEARCH_ACTION_PATH/);
    assert.doesNotMatch(script, /ExecutionPolicy|Invoke-Expression|cmd\.exe/i);
    if (action === "reveal") assert.match(script, /\/select,/);
  }
  assert.throws(() => launchPlan("open", "https://example.invalid", "win32"), { code: "ACTION_PATH_REJECTED" });
  assert.throws(() => launchPlan("open", 'C:\\bad"name.txt', "win32"), { code: "ACTION_PATH_REJECTED" });
  assert.throws(() => launchPlan("open", "/tmp/a.txt", "linux"), { code: "ACTION_PLATFORM_UNSUPPORTED" });
  assert.deepEqual(launchPlan("reveal", "/tmp/檔案.txt", "darwin").args, ["-R", "/tmp/檔案.txt"]);
});

test("M7 launcher maps process failures without exposing stderr", async () => {
  await assert.rejects(executeLaunch({ executable: process.execPath, args: ["-e", "process.stderr.write('private diagnostic');process.exit(1)"], env: process.env }),
    error => error instanceof Error && error.message.includes("無法送出") && !error.message.includes("private"));
  await executeLaunch({ executable: process.execPath, args: ["-e", "process.exit(0)"], env: process.env });
});

test("M7 independent CLI searches then resolves open/reveal in dry-run", () => fixture(async (root, _store, temp) => {
  await writeFile(path.join(root, "可開啟的文件.txt"), "查詢詞");
  const env = { ...process.env, LOCALDOCSEARCH_DATA_DIR: path.join(temp, "cli-data") };
  const run = (...args: string[]) => spawnSync(process.execPath, [path.resolve("dist/src/cli.js"), ...args], { encoding: "utf8", env });
  assert.equal(run("index", root).status, 0);
  const result = run("search", "查詢詞"); assert.equal(result.status, 0);
  const ref = /文件代碼：([0-9]+-[0-9a-f]{16})/.exec(result.stdout)![1]!;
  for (const action of ["open", "reveal"]) {
    const preview = run(action, ref, "--dry-run");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /預覽，未啟動/);
    assert.match(preview.stdout, /可開啟的文件.txt/);
  }
  for (const args of [["open"], ["open", "1"], ["reveal", ref, "--unknown"], ["open", ref, "--dry-run", "extra"]]) assert.equal(run(...args).status, 2);
  await rm(path.join(root, "可開啟的文件.txt"));
  const missing = run("open", ref, "--dry-run");
  assert.equal(missing.status, 3); assert.match(missing.stderr, /ACTION_SOURCE_UNAVAILABLE/);
}));


test("M7 launcher deadline returns a fixed failure", async () => {
  await assert.rejects(executeLaunch({ executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"], env: process.env }, 50),
    { code: "ACTION_LAUNCH_FAILED" });
});
