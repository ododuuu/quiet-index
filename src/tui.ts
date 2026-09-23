import { actOnDocument } from "./open-document.js";
import { copyToClipboard } from "./clipboard.js";
import { prepareSelectedContext, terminalText, type SelectedContextReference } from "./context.js";
import type { SearchMode, SearchResult, SearchResultPage } from "./search.js";
import { SearchIndexChangedError, SearchSession } from "./search-session.js";
import type { IndexStore } from "./store.js";
import { productVersion } from "./version.js";

export type TuiStopReason = "eof" | "sigint" | "sigterm";

export interface TuiIO {
  readonly ansi: boolean;
  write(text: string): void;
  ask(prompt: string): Promise<string | null>;
  stopReason?: () => TuiStopReason;
  size?: () => { columns: number; rows: number };
}

interface CommandSpec {
  name: string;
  group: string;
  usage: string;
  summary: string;
}

export const tuiCommands: readonly CommandSpec[] = [
  { name: "search", group: "搜尋／縮小", usage: "/search <片語>", summary: "精確片語搜尋" },
  { name: "all", group: "搜尋／縮小", usage: "/all <詞1 詞2>", summary: "同一文件包含全部詞" },
  { name: "refine", group: "搜尋／縮小", usage: "/refine <文字>", summary: "在目前完整結果內縮小" },
  { name: "back", group: "搜尋／縮小", usage: "/back", summary: "撤回一層縮小" },
  { name: "reset", group: "搜尋／縮小", usage: "/reset", summary: "重設縮小條件" },
  { name: "next", group: "翻頁", usage: "/next", summary: "結果下一頁" },
  { name: "prev", group: "翻頁", usage: "/prev", summary: "結果上一頁" },
  { name: "open", group: "開啟", usage: "/open <編號|代碼>", summary: "開啟文件" },
  { name: "reveal", group: "開啟", usage: "/reveal <編號|代碼>", summary: "顯示所在資料夾" },
  { name: "select", group: "選取籃／context", usage: "/select <編號|代碼>", summary: "加入上下文選取籃" },
  { name: "unselect", group: "選取籃／context", usage: "/unselect <編號|代碼>", summary: "移除選取" },
  { name: "selected", group: "選取籃／context", usage: "/selected", summary: "查看選取籃" },
  { name: "clear", group: "選取籃／context", usage: "/clear", summary: "清空選取籃" },
  { name: "context", group: "選取籃／context", usage: "/context [1～10]", summary: "預覽並確認複製" },
  { name: "status", group: "狀態", usage: "/status", summary: "索引摘要" },
  { name: "roots", group: "狀態", usage: "/roots", summary: "根目錄清單" },
  { name: "help", group: "說明／退出", usage: "/help", summary: "顯示命令" },
  { name: "quit", group: "說明／退出", usage: "/quit", summary: "離開" },
  { name: "q", group: "說明／退出", usage: "/q", summary: "離開" },
  { name: "exit", group: "說明／退出", usage: "/exit", summary: "離開" },
];

const commandNames = new Set(tuiCommands.map(command => command.name));
const dotAliases = new Set(["help", "quit", "q", "exit"]);
const quitNames = new Set(["quit", "q", "exit"]);

export type ParsedTui =
  | { kind: "empty" }
  | { kind: "search"; query: string }
  | { kind: "slash-menu" }
  | { kind: "command"; name: string; argument: string; notice?: string }
  | { kind: "unknown"; name: string };

export function sanitizeTerminal(text: string): string {
  return [...text].map(char => {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return " ";
    return char;
  }).join("");
}

function isCombining(code: number): boolean {
  return (code >= 0x0300 && code <= 0x036f) || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff) || (code >= 0x20d0 && code <= 0x20ff) || (code >= 0xfe20 && code <= 0xfe2f);
}

function isWide(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f) || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd);
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of sanitizeTerminal(text)) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x20 && char === " " && text.includes(char)) { /* keep spaces */ }
    if (isCombining(code)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

export function clipWidth(text: string, columns: number): string {
  const clean = sanitizeTerminal(text).replace(/\s+/gu, " ").trim();
  if (columns < 2) return "";
  if (displayWidth(clean) <= columns) return clean;
  let width = 0;
  let out = "";
  for (const char of clean) {
    const next = isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
    if (width + next > columns - 1) break;
    out += char;
    width += next;
  }
  return `${out}…`;
}

export function completeTuiCommand(line: string): string[] {
  if (!line.startsWith("/") || /\s/u.test(line)) return [];
  const prefix = line.slice(1).toLowerCase();
  return tuiCommands.filter(command => command.name.startsWith(prefix)).map(command => `/${command.name} `);
}

export function parseTuiInput(raw: string): ParsedTui {
  const input = raw.trim();
  if (!input) return { kind: "empty" };
  const dotted = /^\/\.\/(help|quit|q|exit)$/iu.test(input) ? null : input.match(/^\.\/([^\s]+)(?:\s+([\s\S]*))?$/u);
  if (dotted) {
    const name = dotted[1]!.toLowerCase();
    const argument = (dotted[2] ?? "").trim();
    if (dotAliases.has(name) && !argument) {
      return { kind: "command", name, argument: "", notice: `已將 ./${name} 視為 /${name}；標準寫法是 /${name}。` };
    }
    return { kind: "search", query: input };
  }
  if (input === "/") return { kind: "slash-menu" };
  if (!input.startsWith("/")) return { kind: "search", query: input };
  const [rawName, ...rest] = input.slice(1).split(/\s+/u);
  const name = (rawName ?? "").toLowerCase();
  if (!commandNames.has(name)) return { kind: "unknown", name };
  return { kind: "command", name, argument: rest.join(" ").trim() };
}

function helpLines(): string[] {
  const lines = ["命令以 / 開頭。./help、./quit、./q、./exit 會改解釋並提示標準寫法；其他 ./ 仍是搜尋。裸 q、exit、help 也是搜尋。", ""];
  let group = "";
  for (const command of tuiCommands) {
    if (command.group !== group) {
      group = command.group;
      lines.push(`〔${group}〕`);
    }
    lines.push(`${command.usage}  ${command.summary}`);
  }
  lines.push("", "例子：合約", "例子：/all 付款 例外", "例子：/refine 附件", "例子：/select 1", "例子：/context 3", "例子：/search ./help");
  return lines;
}

function stopCode(io: TuiIO): number {
  const reason = io.stopReason?.() ?? "eof";
  if (reason === "sigint") return 130;
  if (reason === "sigterm") return 143;
  return 0;
}

function resultLines(result: SearchResult, index: number, selected: ReadonlySet<string>, columns: number): string[] {
  const mark = selected.has(result.reference) ? "[x]" : "[ ]";
  return [
    clipWidth(`${mark} ${index}. ${result.path} (${result.extension})`, columns),
    clipWidth(`   ${result.reference} · ${result.reason}${result.location ? ` · ${result.location}` : ""}`, columns),
    clipWidth(`   ${result.path}`, columns),
    clipWidth(`   ${result.snippet}${result.snippetTruncated ? "…" : ""}`, columns),
  ];
}

type ViewName = "results" | "help" | "selected" | "roots" | "context" | "status";

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
  let view: ViewName = "results";
  let viewLines: string[] = [];
  let viewPage = 1;
  let cleaned = false;
  const restore = () => {
    if (cleaned || !io.ansi) return;
    cleaned = true;
    io.write("\x1b[?1049l\x1b[?25h");
  };

  const measure = () => {
    const size = io.size?.() ?? { columns: 80, rows: 24 };
    const columns = Math.max(20, size.columns || 80);
    const rows = Math.max(8, size.rows || 24);
    return { columns, rows, compact: columns < 60 || rows < 15 };
  };
  const refreshPage = () => {
    const { rows, compact } = measure();
    const fitted = compact ? 1 : Math.max(1, Math.min(pageSize, Math.floor((rows - 8) / 4)));
    page = session?.page(pageNumber, fitted) ?? null;
  };
  const render = () => {
    const { columns, rows, compact } = measure();
    const counts = store.counts();
    const documents = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const header = compact
      ? [`Seekah ${productVersion}`, clipWidth(`根 ${store.roots().length} · 文件 ${documents}`, columns)]
      : [
        clipWidth(`Seekah ${productVersion} · 本機文件搜尋與上下文`, columns),
        "─".repeat(Math.min(columns, 72)),
        clipWidth(`根目錄 ${store.roots().length} · 文件 ${documents} · 全程離線`, columns),
      ];
    const hint = compact ? "/help · /quit · Ctrl+C" : "/help 說明 · /quit 離開 · Ctrl+C 中止 · Tab 補全";
    const status = clipWidth(message.split("\n")[0] ?? "", columns);
    const reserved = header.length + 3;
    const bodyRows = Math.max(1, rows - reserved);
    const body: string[] = [];
    const pushView = (lines: string[], label: string) => {
      const pages = Math.max(1, Math.ceil(lines.length / bodyRows));
      viewPage = Math.min(Math.max(1, viewPage), pages);
      const slice = lines.slice((viewPage - 1) * bodyRows, viewPage * bodyRows);
      body.push(clipWidth(`${label} · 第 ${viewPage}/${pages} 頁 · n／p 翻頁 · Esc 返回`, columns));
      for (const line of slice) body.push(clipWidth(line, columns));
    };
    if (view === "help") pushView(viewLines, "說明");
    else if (view === "selected" || view === "roots" || view === "context" || view === "status") pushView(viewLines, view === "context" ? "上下文預覽" : view === "roots" ? "根目錄" : view === "status" ? "狀態" : "選取籃");
    else if (session && page) {
      body.push(clipWidth(`條件：${session.conditions.join(" → ")}`, columns));
      body.push(clipWidth(`符合 ${page.total} 份 · 第 ${page.page}/${page.pageCount} 頁 · 模式 ${session.mode === "all-terms" ? "全部詞" : "片語"} · 已選 ${selected.size}/20`, columns));
      if (!page.results.length) body.push("（沒有符合的結果）");
      for (const [index, result] of page.results.entries()) {
        if (body.length >= bodyRows) break;
        for (const line of resultLines(result, index + 1, new Set(selected.keys()), columns)) {
          if (body.length >= bodyRows) break;
          body.push(line);
        }
      }
    } else {
      body.push("直接輸入文字搜尋。輸入 / 查看命令，Tab 補全。");
    }
    while (body.length < bodyRows) body.push("");
    const lines = [...header, ...body.slice(0, bodyRows), "─".repeat(Math.min(columns, 72)), status, hint];
    io.write(`${io.ansi ? "\x1b[2J\x1b[H" : ""}${lines.join("\n")}\n`);
  };
  const search = (query: string, mode: SearchMode) => {
    if (!query.trim()) { message = "搜尋文字不可為空白。"; return; }
    view = "results";
    session = new SearchSession(store, query.trim(), undefined, undefined, mode);
    pageNumber = 1;
    refreshPage();
    message = session.originalTotal ? "可輸入 /next 翻頁，或 /refine <文字> 縮小。" : "沒有符合的結果。";
  };
  const openView = (name: ViewName, lines: string[], note: string) => {
    view = name;
    viewLines = lines;
    viewPage = 1;
    message = note;
  };

  if (io.ansi) io.write("\x1b[?1049h\x1b[?25h");
  try {
    while (true) {
      render();
      const answer = await io.ask("docsearch › ");
      if (answer === null) return stopCode(io);
      const parsed = parseTuiInput(answer);
      if (parsed.kind === "empty") {
        if (view !== "results" && answer.includes("\u001b")) { view = "results"; message = "已返回。"; continue; }
        message = "請輸入搜尋文字或 /help。";
        continue;
      }
      if (answer.trim() === "\u001b" || answer.trim().toLowerCase() === "esc") {
        view = "results";
        message = "已返回。選取籃保留。";
        continue;
      }
      if (view !== "results" && parsed.kind === "search" && (parsed.query === "n" || parsed.query === "p")) {
        viewPage += parsed.query === "n" ? 1 : -1;
        message = parsed.query === "n" ? "已翻到下一頁內容。" : "已翻到上一頁內容。";
        continue;
      }
      if (parsed.kind === "search") { search(parsed.query, "phrase"); continue; }
      if (parsed.kind === "slash-menu") {
        message = tuiCommands.map(command => `/${command.name} ${command.summary}`).join(" · ");
        continue;
      }
      if (parsed.kind === "unknown") { message = `未知命令：/${parsed.name}；輸入 /help 查看命令。`; continue; }
      if (parsed.notice) message = parsed.notice;
      const command = parsed.name;
      const argument = parsed.argument;
      try {
        if (quitNames.has(command)) return 0;
        if (command === "help") { openView("help", helpLines(), "說明可翻頁；Esc 返回，/quit 離開。"); continue; }
        if (command === "search") { search(argument, "phrase"); continue; }
        if (command === "all") { search(argument, "all-terms"); continue; }
        if (command === "next" || command === "prev") {
          const currentPage = page as SearchResultPage | null;
          if (!currentPage) { message = "請先搜尋。"; continue; }
          const next = pageNumber + (command === "next" ? 1 : -1);
          if (next < 1 || next > currentPage.pageCount) { message = command === "next" ? "已是最後一頁。" : "已是第一頁。"; continue; }
          pageNumber = next; refreshPage(); message = `已移至第 ${pageNumber} 頁。`; view = "results"; continue;
        }
        if (command === "refine") {
          const activeSession = session as SearchSession | null;
          if (!activeSession) { message = "請先搜尋。"; continue; }
          activeSession.append(argument); pageNumber = 1; refreshPage(); message = "已縮小目前完整結果。"; view = "results"; continue;
        }
        if (command === "back" || command === "reset") {
          const activeSession = session as SearchSession | null;
          if (!activeSession) { message = "請先搜尋。"; continue; }
          const changed = command === "back" ? activeSession.back() : activeSession.reset();
          pageNumber = 1; refreshPage(); message = changed ? "搜尋條件已更新。" : "已是最初結果。"; view = "results"; continue;
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
          selected.set(reference, { query: activeSession.conditions.at(-1)!, reference, path: result.path, mode: activeSession.mode });
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
          openView("selected", selected.size
            ? [...selected.values()].map((item, index) => `${index + 1}. [${item.query}] ${item.path} ${item.reference}`)
            : ["選取籃目前是空的。"], selected.size ? `已選 ${selected.size}/20。` : "選取籃目前是空的。");
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
          const preview = terminalText(prepared.text).split("\n");
          openView("context", preview, `完整預覽（只含 ${selected.size} 份已選文件）。n／p 翻頁；確認時只有 yes 會複製。`);
          render();
          const confirm = await io.ask("確認複製以上內容？輸入 yes，其他輸入取消：");
          if (confirm === null) return stopCode(io);
          const confirmParsed = parseTuiInput(confirm);
          if (confirmParsed.kind === "command" && quitNames.has(confirmParsed.name)) return 0;
          if (confirm.trim() === "\u001b" || confirm.trim().toLowerCase() === "esc") { view = "results"; message = "已返回，未改動剪貼簿。"; continue; }
          if (confirm.trim() === "n" || confirm.trim() === "p") { viewPage += confirm.trim() === "n" ? 1 : -1; message = "已翻頁；請再輸入 /context 後 yes 才會複製。"; continue; }
          if (confirm.trim() === "yes") {
            const verified = await prepareSelectedContext(store, [...selected.values()].map(({ query, reference }) => ({ query, reference })), {
              passages, format: "md", ...(mode === "all-terms" ? { allTerms: true } : {}),
            }, prepared.data.createdAt);
            if (verified.text !== prepared.text) throw new Error("預覽後索引或同步資訊已變更，請重新選取。");
            await clipboardWriter(prepared.text);
            message = `已複製 ${selected.size} 份已選片段到本機剪貼簿；未傳送至外部服務。`;
          } else message = "已取消，未改動剪貼簿。";
          view = "results";
          continue;
        }
        if (command === "roots") {
          const roots = store.roots();
          openView("roots", roots.length ? roots : ["尚未登錄根目錄。"], roots.length ? "已登錄根目錄。" : "尚未登錄根目錄。");
          continue;
        }
        if (command === "status") {
          const statusCounts = store.counts();
          const line = `索引狀態：${Object.entries(statusCounts).map(([status, count]) => `${status}=${count}`).join("、")}`;
          openView("status", [line, "文字解析升級與儲存格式請用 CLI status 查看兩種待處理狀態。"], line);
          continue;
        }
      } catch (error) {
        if (error instanceof SearchIndexChangedError) { session = null; page = null; view = "results"; message = `SEARCH_INDEX_CHANGED：${error.message} 請重新搜尋。`; }
        else message = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    restore();
  }
}

function resolveReference(value: string, page: SearchResultPage | null): string | null {
  if (/^[1-9]\d*-[0-9a-f]{16}$/u.test(value)) return value;
  if (!/^\d+$/u.test(value) || !page) return null;
  return page.results[Number(value) - 1]?.reference ?? null;
}
