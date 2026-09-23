import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { sync } from "../src/sync.js";
import { IndexStore } from "../src/store.js";
import { importDocument, renderImportedContext, sanitizeUploadName, uploadExtension } from "../src/workbench-context.js";
import { workbenchHtml } from "../src/workbench-app.js";
import { previewId, previewMatches, ProviderError, ProviderKeys, requestProvider } from "../src/workbench-provider.js";
import { createWorkbench } from "../src/workbench.js";

function rawStatus(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { host, "X-LocalDocSearch-Token": "test-token" } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
}

test("0.35 drag context reuses parsers, sanitizes names and applies a byte-safe bound", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m35-context-"));
  const file = path.join(temp, "sample.txt");
  try {
    await writeFile(file, "drag-context-needle\n第二行");
    const document = await importDocument(file, "../報告\u202e.txt", "00000000-0000-4000-8000-000000000001");
    assert.equal(document.filename, ".._報告_.txt");
    assert.equal(document.status, "indexed");
    const rendered = renderImportedContext([document], 220);
    assert.ok(rendered.bytes <= 220);
    assert.equal(rendered.truncated, true);
    assert.match(rendered.text, /拖曳文件上下文/u);
    assert.throws(() => uploadExtension("archive.zip"), /不支援/u);
    assert.equal(sanitizeUploadName("a\\b/c.txt"), "a_b_c.txt");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("0.35 provider keys stay in memory and preview ids bind all disclosed values", () => {
  const keys = new ProviderKeys({ OPENAI_API_KEY: "env-openai" });
  assert.deepEqual(keys.state("openai"), { configured: true, source: "environment", defaultModel: "gpt-5.6-terra" });
  keys.configure("openai", "session-openai");
  assert.equal(keys.get("openai"), "session-openai");
  assert.equal(keys.state("openai").source, "session");
  const secret = Buffer.alloc(32, 7);
  const first = previewId(secret, { provider: "openai", model: "gpt-5.6-terra", question: "問題", context: "內容" });
  const second = previewId(secret, { provider: "openai", model: "gpt-5.6-terra", question: "另一題", context: "內容" });
  assert.equal(previewMatches(first, first), true);
  assert.equal(previewMatches(first, second), false);
  keys.destroy();
  assert.equal(keys.get("openai"), "env-openai");
});

test("0.35 provider adapter uses fixed Responses endpoints and never echoes keys", async () => {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "provider-answer" }] }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const common = { model: "model-1", question: "q", context: "c", apiKey: "top-secret-key" };
  assert.equal(await requestProvider({ provider: "openai", ...common }, fakeFetch), "provider-answer");
  assert.equal(await requestProvider({ provider: "xai", ...common }, fakeFetch), "provider-answer");
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/responses");
  assert.equal(calls[1]?.url, "https://api.x.ai/v1/responses");
  assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), "Bearer top-secret-key");
  assert.equal(calls[0]?.body.store, false);
  assert.equal("store" in calls[1]!.body, false);
  const rejected = (async () => new Response(JSON.stringify({ error: { message: "bad top-secret-key" } }), { status: 401 })) as typeof fetch;
  await assert.rejects(() => requestProvider({ provider: "openai", ...common }, rejected), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.doesNotMatch(error.message, /top-secret-key/u);
    assert.match(error.message, /\[REDACTED\]/u);
    return true;
  });
});

test("0.35 workbench UI is self-contained and does not persist credentials", () => {
  const html = workbenchHtml("fixed-nonce");
  assert.match(html, /dragenter/u);
  assert.match(html, /dataTransfer\.files/u);
  assert.match(html, /X-LocalDocSearch-Token/u);
  assert.match(html, /navigator\.clipboard/u);
  assert.match(html, /textContent/u);
  assert.doesNotMatch(html, /innerHTML/u);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/u);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
});

test("0.35 loopback workbench enforces host, origin, token, preview and explicit consent", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lds-m35-http-"));
  const root = path.join(temp, "docs");
  const databasePath = path.join(temp, "data", "index.db");
  await mkdir(root);
  await writeFile(path.join(root, "indexed.txt"), "indexed-http-needle");
  const store = new IndexStore(databasePath);
  await sync(root, store);
  store.close();
  const outbound: Array<{ url: string; body: string }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    outbound.push({ url: String(input), body: String(init?.body) });
    return new Response(JSON.stringify({ output_text: "local-fake-answer" }), { status: 200 });
  }) as typeof fetch;
  const handle = await createWorkbench({ databasePath, token: "test-token", secret: Buffer.alloc(32, 3), environment: {}, fetcher: fakeFetch, tempParent: temp });
  const origin = handle.url.split("/#")[0]!;
  const headers = { "X-LocalDocSearch-Token": "test-token" };
  const postHeaders = { ...headers, origin, "content-type": "application/json" };
  try {
    const html = await fetch(origin + "/");
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-security-policy") ?? "", /default-src 'none'/u);
    assert.equal((await fetch(origin + "/api/state")).status, 403);
    assert.equal(await rawStatus(origin + "/api/state", "localhost"), 421);
    const state = await fetch(origin + "/api/state", { headers });
    assert.equal(state.status, 200);
    assert.equal((await state.json() as { indexAvailable: boolean }).indexAvailable, true);

    const search = await fetch(origin + "/api/search", { method: "POST", headers: postHeaders, body: JSON.stringify({ query: "indexed-http-needle", mode: "phrase", page: 1, pageSize: 20 }) });
    assert.equal(search.status, 200);
    const searchData = await search.json() as { results: Array<{ reference: string }> };
    assert.equal(searchData.results.length, 1);

    const upload = await fetch(origin + "/api/files", { method: "POST", headers: { ...headers, origin, "X-File-Name": encodeURIComponent("臨時.txt"), "content-type": "application/octet-stream" }, body: "drag-http-needle" });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json() as { id: string; status: string };
    assert.equal(uploaded.status, "indexed");

    const base = { provider: "openai", model: "gpt-5.6-terra", question: "請回答", mode: "phrase", selections: [{ query: "indexed-http-needle", reference: searchData.results[0]!.reference }], fileIds: [uploaded.id] };
    const preview = await fetch(origin + "/api/preview", { method: "POST", headers: postHeaders, body: JSON.stringify(base) });
    assert.equal(preview.status, 200);
    const previewData = await preview.json() as { previewId: string; context: string };
    assert.match(previewData.context, /indexed-http-needle/u);
    assert.match(previewData.context, /drag-http-needle/u);

    const configure = await fetch(origin + "/api/providers", { method: "POST", headers: postHeaders, body: JSON.stringify({ provider: "openai", key: "session-key" }) });
    assert.equal(configure.status, 200);
    assert.doesNotMatch(await configure.text(), /session-key/u);
    const stale = await fetch(origin + "/api/ask", { method: "POST", headers: postHeaders, body: JSON.stringify({ ...base, question: "已改問題", previewId: previewData.previewId, confirmed: true }) });
    assert.equal(stale.status, 409);
    assert.equal(outbound.length, 0);
    const ask = await fetch(origin + "/api/ask", { method: "POST", headers: postHeaders, body: JSON.stringify({ ...base, previewId: previewData.previewId, confirmed: true }) });
    assert.equal(ask.status, 200);
    assert.deepEqual(await ask.json(), { answer: "local-fake-answer" });
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0]?.url, "https://api.openai.com/v1/responses");
    assert.match(outbound[0]?.body ?? "", /indexed-http-needle/u);
    assert.match(outbound[0]?.body ?? "", /drag-http-needle/u);
  } finally {
    await handle.close();
    const leftovers = (await readdir(temp)).filter(name => name.startsWith("localdocsearch-ui-"));
    assert.deepEqual(leftovers, []);
    await rm(temp, { recursive: true, force: true });
  }
});
