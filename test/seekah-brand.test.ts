import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildHelpText } from "../src/cli.js";
import { describeDatabaseLocation } from "../src/store.js";
import { MCP_APP_RESOURCE_URI } from "../src/mcp-app.js";

test("Seekah aliases share the same CLI and retain the lockfile contract", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(pkg.name, "seekah");
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(pkg.bin.seekah, "dist/src/cli.js");
  assert.equal(pkg.bin.docsearch, pkg.bin.seekah);
  assert.deepEqual(lock.packages[""].bin, pkg.bin);
  const newLauncher = await readFile("seekah.cmd", "utf8");
  const oldLauncher = await readFile("docsearch.cmd", "utf8");
  assert.equal(newLauncher.replaceAll("\r\n", "\n").trim(), oldLauncher.replaceAll("\r\n", "\n").trim());
  assert.match(buildHelpText(), /Seekah/u);
  assert.match(buildHelpText(), /seekah.cmd/u);
});

test("Seekah keeps existing storage locations and MCP resource identity", () => {
  assert.equal(describeDatabaseLocation({ LOCALAPPDATA: "legacy-data" }, "win32", "home").path,
    path.join("legacy-data", "LocalDocSearch", "index.db"));
  assert.equal(describeDatabaseLocation({ LOCALDOCSEARCH_DATA_DIR: "override" }, "win32", "home").path,
    path.join("override", "LocalDocSearch", "index.db"));
  assert.equal(describeDatabaseLocation({ XDG_DATA_HOME: "xdg" }, "linux", "home").path,
    path.join("xdg", "LocalDocSearch", "index.db"));
  assert.equal(MCP_APP_RESOURCE_URI, "ui://localdocsearch/search-context-v1.html");
});

test("Windows UI launcher uses CRLF and locates node.exe", async () => {
  const raw = await readFile("seekah-ui.cmd");
  assert.ok(raw.includes(Buffer.from("\r\n")), "seekah-ui.cmd must use CRLF so cmd.exe can parse it");
  const text = raw.toString("utf8");
  assert.match(text, /NODE_EXE/);
  assert.match(text, /nodejs\\node\.exe/);
  assert.match(text, /WindowsApps/);
  assert.doesNotMatch(text, /^node "/m);
  assert.doesNotMatch(text, /npm\.cmd/);
});

test("UI launcher runs npm through the same Node executable", async () => {
  const source = await readFile("scripts/launch-ui.mjs", "utf8");
  assert.match(source, /npm-cli\.js/);
  assert.doesNotMatch(source, /npm\.cmd/);
  // launch-ui.mjs stays at repo-root scripts/, not beside compiled dist/test.
  const { resolveNpmCli } = await import(pathToFileURL(path.resolve("scripts/launch-ui.mjs")).href);
  const npmCli = resolveNpmCli();
  const result = spawnSync(process.execPath, [npmCli, "--version"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\d+\.\d+/);
});
