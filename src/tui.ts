import { actOnDocument } from "./open-document.js";
import type { SearchMode, SearchResult, SearchResultPage } from "./search.js";
import { SearchIndexChangedError, SearchSession } from "./search-session.js";
import type { IndexStore } from "./store.js";

export interface TuiIO {
  readonly ansi: boolean;
  write(text: string): void;
  ask(prompt: string): Promise<string | null>;
}

const help = [
  "直接輸入文字搜尋；命令：",
  "/search <片語>       精確片語搜尋",
  "/all <詞1 詞2>       同一文件包含全部詞",
  "/next、/prev         翻頁",
  "/refine <文字>       在目前完整結果內縮小",
  "/back、/reset        撤回／重設縮小條件",
  "/open <編號|代碼>    開啟文件",
  "/reveal <編號|代碼>  顯示所在資料夾",
  "/status、/roots      索引摘要／根目錄",
  "/help、/quit         說明／離開",
];

function resultLines(result: SearchResult, index: number): string[] {
  return [
    `${index}. ${result.path}`,
    `   ${result.reference} · ${result.reason}${result.location ? ` · ${result.location}` : ""}`,
    `   ${result.snippet}${result.snippetTruncated ? "…" : ""}`,
  ];
}

function resolveReference(value: string, page: SearchResultPage | null): string | null {
  if (/^[1-9]\d*-[0-9a-f]{16}$/u.test(value)) return value;
  if (!/^\d+$/u.test(value) || !page) return null;
  return page.results[Number(value) - 1]?.reference ?? null;
}

export async function runTui(store: IndexStore, io: TuiIO, pageSize = 10): Promise<number> {
  let session: SearchSession | null = null;
  let page: SearchResultPage | null = null;
  let pageNumber = 1;
  let message = "輸入關鍵字開始搜尋；/help 顯示全部命令。";

  const refreshPage = () => {
    page = session?.page(pageNumber, pageSize) ?? null;
  };
  const render = () => {
    const lines = [
      "LocalDocSearch 0.32 · 本機文件搜尋",
      "─".repeat(72),
      `根目錄 ${store.roots().length} · 文件 ${Object.values(store.counts()).reduce((sum, count) => sum + count, 0)} · 全程離線`,
      "",
    ];
    if (session && page) {
      lines.push(`條件：${session.conditions.join(" → ")}`);
      lines.push(`符合 ${page.total} 份 · 第 ${page.page}/${page.pageCount} 頁 · 模式 ${session.mode === "all-terms" ? "全部詞" : "片語"}`, "");
      if (!page.results.length) lines.push("（沒有符合的結果）");
      page.results.forEach((result, index) => lines.push(...resultLines(result, index + 1), ""));
    } else {
      lines.push(...help.slice(0, 1), "");
    }
    lines.push("─".repeat(72), message);
    io.write(`${io.ansi ? "\x1b[2J\x1b[H" : ""}${lines.join("\n")}\n`);
  };
  const search = (query: string, mode: SearchMode) => {
    if (!query.trim()) { message = "搜尋文字不可為空白。"; return; }
    session = new SearchSession(store, query.trim(), undefined, undefined, mode);
    pageNumber = 1;
    refreshPage();
    message = session.originalTotal ? "可輸入 /next 翻頁，或 /refine <文字> 縮小。" : "沒有符合的結果。";
  };

  if (io.ansi) io.write("\x1b[?1049h\x1b[?25h");
  try {
    while (true) {
      render();
      const answer = await io.ask("docsearch › ");
      if (answer === null) return 0;
      const input = answer.trim();
      if (!input) { message = "請輸入搜尋文字或 /help。"; continue; }
      if (!input.startsWith("/")) { search(input, "phrase"); continue; }
      const [rawCommand, ...rest] = input.slice(1).split(/\s+/u);
      const command = rawCommand!.toLowerCase();
      const argument = rest.join(" ").trim();
      try {
        if (["quit", "q", "exit"].includes(command)) return 0;
        if (command === "help") { message = help.join("\n"); continue; }
        if (command === "search") { search(argument, "phrase"); continue; }
        if (command === "all") { search(argument, "all-terms"); continue; }
        if (command === "next" || command === "prev") {
          const currentPage = page as SearchResultPage | null;
          if (!currentPage) { message = "請先搜尋。"; continue; }
          const next = pageNumber + (command === "next" ? 1 : -1);
          if (next < 1 || next > currentPage.pageCount) { message = command === "next" ? "已是最後一頁。" : "已是第一頁。"; continue; }
          pageNumber = next; refreshPage(); message = `已移至第 ${pageNumber} 頁。`; continue;
        }
        if (command === "refine") {
          const activeSession = session as SearchSession | null;
          if (!activeSession) { message = "請先搜尋。"; continue; }
          activeSession.append(argument); pageNumber = 1; refreshPage(); message = "已縮小目前完整結果。"; continue;
        }
        if (command === "back" || command === "reset") {
          const activeSession = session as SearchSession | null;
          if (!activeSession) { message = "請先搜尋。"; continue; }
          const changed = command === "back" ? activeSession.back() : activeSession.reset();
          pageNumber = 1; refreshPage(); message = changed ? "搜尋條件已更新。" : "已是最初結果。"; continue;
        }
        if (command === "open" || command === "reveal") {
          const reference = resolveReference(argument, page);
          if (!reference) { message = `請輸入本頁編號或文件代碼，例如 /${command} 1。`; continue; }
          const target = await actOnDocument(store, reference, command);
          message = `${command === "open" ? "已送出開啟" : "已顯示所在資料夾"}：${target.path}${target.changed ? "（來源已有變更）" : ""}`;
          continue;
        }
        if (command === "roots") {
          const roots = store.roots(); message = roots.length ? `已登錄根目錄：\n${roots.join("\n")}` : "尚未登錄根目錄。"; continue;
        }
        if (command === "status") {
          const counts = store.counts();
          message = `索引狀態：${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join("、")}`; continue;
        }
        message = `未知命令：/${command}；輸入 /help 查看命令。`;
      } catch (error) {
        if (error instanceof SearchIndexChangedError) { session = null; page = null; message = `SEARCH_INDEX_CHANGED：${error.message}`; }
        else message = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    if (io.ansi) io.write("\x1b[?1049l");
  }
}
