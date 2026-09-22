import { actOnDocument } from "./open-document.js";
import { copyToClipboard } from "./clipboard.js";
import { prepareSelectedContext, terminalText, type SelectedContextReference } from "./context.js";
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
  "/select <編號|代碼>  加入上下文選取籃",
  "/unselect <編號|代碼>移除選取；/selected 查看",
  "/clear                清空選取籃",
  "/context [1～10]      預覽並確認複製已選片段",
  "/status、/roots      索引摘要／根目錄",
  "/help、/quit         說明／離開",
];

function resultLines(result: SearchResult, index: number, selected: ReadonlySet<string>): string[] {
  return [
    `${selected.has(result.reference) ? "[x]" : "[ ]"} ${index}. ${result.path}`,
    `   ${result.reference} · ${result.reason}${result.location ? ` · ${result.location}` : ""}`,
    `   ${result.snippet}${result.snippetTruncated ? "…" : ""}`,
  ];
}

function resolveReference(value: string, page: SearchResultPage | null): string | null {
  if (/^[1-9]\d*-[0-9a-f]{16}$/u.test(value)) return value;
  if (!/^\d+$/u.test(value) || !page) return null;
  return page.results[Number(value) - 1]?.reference ?? null;
}

export async function runTui(
  store: IndexStore,
  io: TuiIO,
  pageSize = 10,
  clipboardWriter: (text: string) => Promise<void> = copyToClipboard,
): Promise<number> {
  let session: SearchSession | null = null;
  let page: SearchResultPage | null = null;
  let pageNumber = 1;
  const selected = new Map<string, SelectedContextReference & { path: string; mode: SearchMode }>();
  let message = "輸入關鍵字開始搜尋；/help 顯示全部命令。";

  const refreshPage = () => {
    page = session?.page(pageNumber, pageSize) ?? null;
  };
  const render = () => {
    const lines = [
      "LocalDocSearch 0.33 · 本機文件搜尋與上下文",
      "─".repeat(72),
      `根目錄 ${store.roots().length} · 文件 ${Object.values(store.counts()).reduce((sum, count) => sum + count, 0)} · 全程離線`,
      "",
    ];
    if (session && page) {
      lines.push(`條件：${session.conditions.join(" → ")}`);
      lines.push(`符合 ${page.total} 份 · 第 ${page.page}/${page.pageCount} 頁 · 模式 ${session.mode === "all-terms" ? "全部詞" : "片語"}`, "");
      if (!page.results.length) lines.push("（沒有符合的結果）");
      page.results.forEach((result, index) => lines.push(...resultLines(result, index + 1, new Set(selected.keys())), ""));
    } else {
      lines.push(...help.slice(0, 1), "");
    }
    lines.push("─".repeat(72), `已選上下文 ${selected.size}/20`, message);
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
        if (command === "select") {
          const activeSession = session as SearchSession | null;
          const reference = resolveReference(argument, page);
          const currentPage = page as SearchResultPage | null;
          const result = currentPage?.results.find(item => item.reference === reference);
          if (!activeSession || !reference || !result) { message = "請先搜尋，再輸入本頁編號或文件代碼，例如 /select 1。"; continue; }
          const selectedMode = selected.values().next().value?.mode as SearchMode | undefined;
          if (selectedMode && selectedMode !== activeSession.mode) { message = "同一選取籃不可混用片語與全部詞模式；請先 /clear。"; continue; }
          if (selected.has(reference)) { message = "該文件已在選取籃。"; continue; }
          if (selected.size >= 20) { message = "選取籃最多 20 份文件；請先移除部分項目。"; continue; }
          selected.set(reference, {
            query: activeSession.conditions.at(-1)!, reference, path: result.path, mode: activeSession.mode,
          });
          message = `已加入：${result.path}`;
          continue;
        }
        if (command === "unselect") {
          let reference = /^[1-9]\d*-[0-9a-f]{16}$/u.test(argument) ? argument : undefined;
          if (!reference && /^\d+$/u.test(argument)) reference = [...selected.keys()][Number(argument) - 1];
          if (!reference || !selected.delete(reference)) { message = "請輸入已選清單編號或文件代碼，例如 /unselect 1。"; continue; }
          message = "已從選取籃移除。";
          continue;
        }
        if (command === "selected") {
          message = selected.size
            ? `已選 ${selected.size}/20：\n${[...selected.values()].map((item, index) => `${index + 1}. [${item.query}] ${item.path}\n   ${item.reference}`).join("\n")}`
            : "選取籃目前是空的。";
          continue;
        }
        if (command === "clear") { selected.clear(); message = "已清空選取籃。"; continue; }
        if (command === "context") {
          if (!selected.size) { message = "尚未選取文件；請先用 /select。"; continue; }
          const passages = argument ? Number(argument) : 3;
          if (!Number.isSafeInteger(passages) || passages < 1 || passages > 10) { message = "/context 的 passage 數量必須為 1～10。"; continue; }
          const mode = selected.values().next().value!.mode;
          const prepared = await prepareSelectedContext(store, [...selected.values()].map(({ query, reference }) => ({ query, reference })), {
            passages, format: "md", ...(mode === "all-terms" ? { allTerms: true } : {}),
          });
          message = `完整預覽（只含 ${selected.size} 份已選文件）：\n${terminalText(prepared.text)}\n輸入 yes 才會複製到本機剪貼簿。`;
          render();
          const confirm = await io.ask("確認複製以上內容？輸入 yes，其他輸入取消：");
          if (confirm?.trim() === "yes") {
            const verified = await prepareSelectedContext(store, [...selected.values()].map(({ query, reference }) => ({ query, reference })), {
              passages, format: "md", ...(mode === "all-terms" ? { allTerms: true } : {}),
            }, prepared.data.createdAt);
            if (verified.text !== prepared.text) throw new Error("預覽後索引或同步資訊已變更，請重新選取。");
            await clipboardWriter(prepared.text);
            message = `已複製 ${selected.size} 份已選片段到本機剪貼簿；未傳送至外部服務。`;
          } else message = "已取消，未改動剪貼簿。";
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
