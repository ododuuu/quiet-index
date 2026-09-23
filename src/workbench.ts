import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { IndexStore } from "./store.js";
import { searchDocuments, prepareContextTool } from "./mcp-tools.js";
import { MAX_FILE_BYTES } from "./parser.js";
import { supportedExtensions } from "./model.js";
import { combineWorkbenchContext, importDocument, sanitizeUploadName, uploadExtension, WORKBENCH_FILE_LIMIT, type ImportedDocument } from "./workbench-context.js";
import { previewId, previewMatches, ProviderError, ProviderKeys, providerNames, requestProvider, validateModel, validateProvider, type ProviderName } from "./workbench-provider.js";
import { workbenchHtml } from "./workbench-app.js";
import { productVersion } from "./version.js";

const HOST = "127.0.0.1";
const JSON_LIMIT = 128 * 1024;

interface Selection { query: string; reference: string }
interface ContextRequest {
  provider: ProviderName;
  model: string;
  question: string;
  mode: "phrase" | "all-terms";
  selections: Selection[];
  fileIds: string[];
}

export interface WorkbenchOptions {
  databasePath: string;
  port?: number;
  token?: string;
  secret?: Buffer;
  environment?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  tempParent?: string;
}

export interface WorkbenchHandle {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw Object.assign(new Error("要求內容超過上限。"), { statusCode: 413 });
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw Object.assign(new Error("要求內容超過上限。"), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(request, JSON_LIMIT);
  try {
    const value = JSON.parse(raw.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw Object.assign(new Error("JSON 要求格式無效。"), { statusCode: 400 }); }
}

function contextRequest(body: Record<string, unknown>): ContextRequest {
  const provider = validateProvider(body.provider);
  const model = validateModel(body.model);
  if (typeof body.question !== "string" || body.question.length > 8000) throw new Error("問題長度無效。");
  const question = body.question.trim();
  const mode = body.mode === "all-terms" ? "all-terms" : body.mode === "phrase" ? "phrase" : undefined;
  if (!mode) throw new Error("搜尋模式無效。");
  if (!Array.isArray(body.selections) || !Array.isArray(body.fileIds)) throw new Error("上下文選取格式無效。");
  const selections = body.selections.map(value => {
    if (!value || typeof value !== "object") throw new Error("索引選取格式無效。");
    const item = value as Record<string, unknown>;
    if (typeof item.query !== "string" || !item.query.trim() || item.query.length > 1000
      || typeof item.reference !== "string" || !/^[1-9]\d*-[0-9a-f]{16}$/u.test(item.reference)) throw new Error("索引選取格式無效。");
    return { query: item.query.trim(), reference: item.reference };
  });
  const fileIds = body.fileIds.map(value => {
    if (typeof value !== "string" || !/^[0-9a-f-]{36}$/u.test(value)) throw new Error("拖曳文件代碼無效。");
    return value;
  });
  const uniqueReferences = new Set(selections.map(item => item.reference));
  const uniqueFiles = new Set(fileIds);
  if (uniqueReferences.size !== selections.length || uniqueFiles.size !== fileIds.length
    || selections.length + fileIds.length < 1 || selections.length + fileIds.length > 20) throw new Error("索引與拖曳文件合計需要 1～20 份不重複項目。");
  return { provider, model, question, mode, selections, fileIds };
}

function providerStates(keys: ProviderKeys) {
  return Object.fromEntries(providerNames.map(provider => [provider, keys.state(provider)]));
}

async function openStore<T>(databasePath: string, operation: (store: IndexStore) => T | Promise<T>): Promise<T> {
  if (!existsSync(databasePath)) throw new Error("索引尚未建立；仍可只使用拖曳文件。");
  const store = new IndexStore(databasePath, { readOnly: true });
  try { return await operation(store); } finally { store.close(); }
}

export async function createWorkbench(options: WorkbenchOptions): Promise<WorkbenchHandle> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const secret = options.secret ?? randomBytes(32);
  const keys = new ProviderKeys(options.environment);
  const documents = new Map<string, ImportedDocument>();
  const tempRoot = await mkdtemp(path.join(options.tempParent ?? os.tmpdir(), "localdocsearch-ui-"));
  const sessionCreatedAt = new Date().toISOString();
  let origin = "";

  const buildContext = async (input: ContextRequest) => {
    let indexedText = "";
    if (input.selections.length) {
      const prepared = await openStore(options.databasePath, store => prepareContextTool(store, {
        selections: input.selections,
        mode: input.mode,
        passages: 3,
        createdAt: sessionCreatedAt,
      }));
      indexedText = prepared.text;
    }
    const imported = input.fileIds.map(id => {
      const document = documents.get(id);
      if (!document) throw new Error("拖曳文件已不存在，請重新選取。");
      return document;
    });
    return combineWorkbenchContext(indexedText, imported);
  };

  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      const currentAddress = server.address();
      const currentPort = currentAddress && typeof currentAddress === "object" ? currentAddress.port : options.port ?? 0;
      if (!host || host !== `${HOST}:${currentPort}`) {
        json(response, 421, { error: "Host 不允許。" }); return;
      }
      const url = new URL(request.url ?? "/", origin);
      if (request.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(18).toString("base64url");
        const body = workbenchHtml(nonce);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "cross-origin-opener-policy": "same-origin",
        });
        response.end(body); return;
      }
      if (!url.pathname.startsWith("/api/")) { json(response, 404, { error: "找不到本機資源。" }); return; }
      if (request.headers["x-localdocsearch-token"] !== token) { json(response, 403, { error: "工作階段 token 無效。" }); return; }
      if (request.method !== "GET" && request.headers.origin !== origin) { json(response, 403, { error: "跨來源要求已拒絕。" }); return; }

      if (request.method === "GET" && url.pathname === "/api/state") {
        json(response, 200, { indexAvailable: existsSync(options.databasePath), supportedExtensions: [...supportedExtensions].sort(), providers: providerStates(keys), fileLimit: WORKBENCH_FILE_LIMIT }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/search") {
        const body = await readJson(request);
        const result = await openStore(options.databasePath, store => searchDocuments(store, {
          query: typeof body.query === "string" ? body.query : "",
          mode: body.mode === "all-terms" ? "all-terms" : "phrase",
          page: Number(body.page), pageSize: Number(body.pageSize),
        }));
        json(response, 200, result); return;
      }
      if (request.method === "POST" && url.pathname === "/api/files") {
        if (documents.size >= WORKBENCH_FILE_LIMIT) throw Object.assign(new Error("一次最多保留 20 份拖曳文件。"), { statusCode: 409 });
        const header = request.headers["x-file-name"];
        if (typeof header !== "string") throw Object.assign(new Error("缺少檔名。"), { statusCode: 400 });
        let decoded: string;
        try { decoded = decodeURIComponent(header); } catch { throw Object.assign(new Error("檔名編碼無效。"), { statusCode: 400 }); }
        const filename = sanitizeUploadName(decoded);
        const extension = uploadExtension(filename);
        const content = await readBody(request, MAX_FILE_BYTES);
        const temporary = path.join(tempRoot, `${randomUUID()}${extension}`);
        await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
        let document: ImportedDocument;
        try { document = await importDocument(temporary, filename); }
        finally { await unlink(temporary).catch(() => {}); }
        documents.set(document.id, document);
        const { blocks: _blocks, ...publicDocument } = document;
        json(response, 201, publicDocument); return;
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/files/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/files/".length));
        if (!documents.delete(id)) throw Object.assign(new Error("拖曳文件不存在。"), { statusCode: 404 });
        json(response, 200, { removed: true }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/providers") {
        const body = await readJson(request);
        const provider = validateProvider(body.provider);
        if (typeof body.key !== "string") throw new Error("缺少 API Key。");
        keys.configure(provider, body.key);
        json(response, 200, { providers: providerStates(keys) }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/preview") {
        const input = contextRequest(await readJson(request));
        const built = await buildContext(input);
        const id = previewId(secret, { provider: input.provider, model: input.model, question: input.question, context: built.text });
        json(response, 200, { previewId: id, context: built.text, bytes: built.bytes, truncated: built.truncated }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJson(request);
        const input = contextRequest(body);
        if (!input.question) throw new Error("送出 AI 前需要填寫問題。");
        if (body.confirmed !== true) throw new Error("尚未確認外部傳送。");
        const built = await buildContext(input);
        const expected = previewId(secret, { provider: input.provider, model: input.model, question: input.question, context: built.text });
        if (!previewMatches(expected, body.previewId)) throw Object.assign(new Error("預覽已失效；請重新預覽並確認。"), { statusCode: 409 });
        const apiKey = keys.get(input.provider);
        if (!apiKey) throw new Error("尚未設定此 Provider 的 API Key。");
        const answer = await requestProvider({ provider: input.provider, model: input.model, question: input.question, context: built.text, apiKey }, options.fetcher);
        json(response, 200, { answer }); return;
      }
      json(response, 404, { error: "找不到本機 API。" });
    } catch (error) {
      const status = error instanceof ProviderError ? 502 : error instanceof Error && "statusCode" in error ? Number((error as Error & { statusCode: number }).statusCode) : 400;
      const message = error instanceof ProviderError || error instanceof Error ? error.message : "無法完成要求。";
      json(response, Number.isSafeInteger(status) ? status : 400, { error: message.slice(0, 700) });
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, HOST, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    keys.destroy();
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("無法取得本機工作台連接埠。");
  origin = `http://${HOST}:${address.port}`;
  let closed = false;
  return {
    url: `${origin}/#${encodeURIComponent(token)}`,
    port: address.port,
    token,
    close: async () => {
      if (closed) return;
      closed = true;
      keys.destroy();
      documents.clear();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export type BrowserLauncher = (url: string) => void;

export function launchBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export async function runWorkbenchCommand(databasePath: string, options: { openBrowser?: boolean; launcher?: BrowserLauncher; write?: (text: string) => void } = {}): Promise<number> {
  const handle = await createWorkbench({ databasePath });
  const write = options.write ?? console.log;
  write(`LocalDocSearch ${productVersion} 本機工作台：${handle.url}`);
  write("只接受這台電腦的瀏覽器連線；按 Ctrl+C 關閉並清除臨時文件與工作階段 API Key。");
  if (options.openBrowser !== false) (options.launcher ?? launchBrowser)(handle.url);
  await new Promise<void>(resolve => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await handle.close();
  return 0;
}
