import assert from "node:assert/strict";
import test from "node:test";

import { buildHelpText, main } from "../src/cli.js";

test("help text names the product and planned index command", () => {
  const help = buildHelpText();

  assert.match(help, /LocalDocSearch/);
  assert.match(help, /docsearch index \[root\]/);
});

test("unknown commands return a usage error code", async () => {
  assert.equal(await main(["unknown"]), 2);
});
