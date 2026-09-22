import { existsSync } from "node:fs";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { IndexStore } from "./store.js";
import { indexStatus, McpToolError, prepareContextTool, searchDocuments } from "./mcp-tools.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function errorResult(error: unknown): CallToolResult {
  if (error instanceof McpToolError) {
    return { content: [{ type: "text", text: `${error.code}：${error.message}` }], isError: true };
  }
  return { content: [{ type: "text", text: "MCP_INTERNAL：無法完成本機工具呼叫。" }], isError: true };
}

async function withStore(
  databasePath: string,
  operation: (store: IndexStore) => Promise<CallToolResult> | CallToolResult,
): Promise<CallToolResult> {
  if (!existsSync(databasePath)) {
    return errorResult(new McpToolError("MCP_INDEX_MISSING", "索引尚未建立；請先在終端執行 docsearch index <root>。"));
  }
  let store: IndexStore | undefined;
  try {
    store = new IndexStore(databasePath, { readOnly: true });
    return await operation(store);
  } catch (error) {
    return errorResult(error);
  } finally {
    store?.close();
  }
}

const modeSchema = z.enum(["phrase", "all-terms"]).default("phrase");
const typesSchema = z.array(z.string().min(1).max(254)).max(50).optional();

export function createMcpServer(databasePath: string): McpServer {
  const server = new McpServer(
    { name: "localdocsearch", version: "0.33.0" },
    {
      instructions: "Search the existing local index first. Show document references to the user and call prepare_context only for references the user selected. Never imply that a snippet is the full document.",
    },
  );

  server.registerTool(
    "search_documents",
    {
      title: "搜尋本機文件",
      description: "唯讀搜尋 LocalDocSearch 既有索引，回傳有界片段與穩定文件代碼。先讓使用者選擇代碼，再呼叫 prepare_context。",
      inputSchema: z.object({
        query: z.string().min(1).max(1000),
        mode: modeSchema.optional(),
        types: typesSchema,
        root: z.string().min(1).max(32768).optional(),
        page: z.number().int().min(1).max(500).default(1),
        pageSize: z.number().int().min(1).max(50).default(10),
      }),
      annotations: readOnlyAnnotations,
    },
    async input => withStore(databasePath, store => {
      const result = searchDocuments(store, {
        query: input.query,
        page: input.page,
        pageSize: input.pageSize,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.types ? { types: input.types } : {}),
        ...(input.root ? { root: input.root } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }),
  );

  server.registerTool(
    "prepare_context",
    {
      title: "建立已選上下文",
      description: "只為使用者明確選定的 1～20 個文件代碼建立有界 Markdown 上下文；重新驗證索引與來源，不讀整庫或完整文件。",
      inputSchema: z.object({
        selections: z.array(z.object({
          query: z.string().min(1).max(1000),
          reference: z.string().regex(/^[1-9]\d*-[0-9a-f]{16}$/u),
        })).min(1).max(20),
        mode: modeSchema.optional(),
        types: typesSchema,
        root: z.string().min(1).max(32768).optional(),
        passages: z.number().int().min(1).max(10).default(3),
      }),
      annotations: readOnlyAnnotations,
    },
    async input => withStore(databasePath, async store => {
      const result = await prepareContextTool(store, {
        selections: input.selections,
        passages: input.passages,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.types ? { types: input.types } : {}),
        ...(input.root ? { root: input.root } : {}),
      });
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.data,
      };
    }),
  );

  server.registerTool(
    "index_status",
    {
      title: "查看本機索引狀態",
      description: "唯讀查看 LocalDocSearch 索引格式、文件狀態數與已登錄根目錄；不掃描來源或啟動更新。",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => withStore(databasePath, store => {
      const result = indexStatus(store);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }),
  );

  return server;
}

export async function runMcpServer(databasePath: string): Promise<number> {
  serveStdio(() => createMcpServer(databasePath), {
    onerror: () => console.error("LocalDocSearch MCP transport error."),
  });
  console.error("LocalDocSearch MCP 0.33.0 running on stdio.");
  return 0;
}
