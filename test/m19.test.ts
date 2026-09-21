import assert from "node:assert/strict";
import test from "node:test";
import { makeSnippet, normalize } from "../src/search.js";

test("M19 large snippets only map the matching Unicode chunk and keep source text", () => {
  const prefix = "前".repeat(40_000);
  const suffix = "後".repeat(40_000);
  const source = `${prefix}e\u0301是原始文字${suffix}`;
  const snippet = makeSnippet(source, normalize("é是原始文字"));
  assert.ok(snippet.text.includes("e\u0301是原始文字"));
  assert.equal(snippet.truncated, false);
  assert.ok(Array.from(snippet.text).length <= 160);
  assert.equal(/[\uD800-\uDFFF]/u.test(snippet.text), false);
});

test("M19 large snippets retain the long-match truncation contract", () => {
  const source = `${"前".repeat(40_000)}${"🧪".repeat(200)}${"後".repeat(40_000)}`;
  const snippet = makeSnippet(source, "🧪".repeat(200));
  assert.equal(snippet.truncated, true);
  assert.ok(Array.from(snippet.text).length <= 160);
  assert.equal(/[\uD800-\uDFFF]/u.test(snippet.text), false);
});
