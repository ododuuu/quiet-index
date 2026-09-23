import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
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
