#!/usr/bin/env node
import { IndexBusyError } from "./write-lock.js";
import { interactiveContext, ContextError } from "./context.js";
import { runWatch, WatchError, resolveWatchDebounce, resolveWatchRescan } from "./watch.js";
import { actOnDocument, DocumentActionError } from "./open-document.js";
import { defaultDatabasePath, IndexStore } from "./store.js";
import { parseTypes, type SearchResult } from "./search.js";
import { runSearchSession, SearchSession, SearchIndexChangedError } from "./search-session.js";
import { resolveUserRootPath } from "./root-plan.js";
import { RootError } from "./scanner.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IgnoreConfigurationError } from "./ignore.js";
import type { SyncSummary } from "./model.js";
import { supportedExtensions } from "./model.js";
import { ClipboardError } from "./clipboard.js";
import { existsSync } from "node:fs";
import { OperationCancelledError, type ProgressUpdate } from "./progress.js";
import { createInterface } from "node:readline/promises";

function safeProgressText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "?");
}

function progressReporter(): { update(update: ProgressUpdate): void; close(): void } {
  let latest: ProgressUpdate | undefined;
  let lastStage: ProgressUpdate["stage"] | undefined;
  let lastWritten = 0;
  const render = (update: ProgressUpdate) => {
    const count = update.current === undefined ? "" : update.total === undefined ? ` ${update.current}` : ` ${update.current}/${update.total}`;
    const location = update.path ? `；${safeProgressText(update.path)}` : "";
    console.error(`[${update.stage}] ${update.message}${count}${location}`);
    lastWritten = Date.now(); lastStage = update.stage;
  };
  const timer = setInterval(() => { if (latest && Date.now() - lastWritten >= 1000) render(latest); }, 1000);
  timer.unref();
  return {
    update(update) {
      latest = update;
      if (lastStage !== update.stage || Date.now() - lastWritten >= 1000 || update.stage === "complete") render(update);
    },
    close() { clearInterval(timer); },
  };
}

function sqliteExtendedCode(error: unknown): number | undefined {
  return error instanceof Error && "errcode" in error ? (error as Error & { errcode?: number }).errcode : undefined;
}

export function buildHelpText(): string {
  return [
    "LocalDocSearch — 本機文件搜尋",
    "",
    "  docsearch index [root] [--verbose]",
    "  docsearch search <query> [--all-terms] [--page <正整數>] [--page-size <1～100>] [--limit <正整數>] [--type <格式清單>] [--root <路徑>] [--verbose]",
    "  docsearch context [query] (--out <新檔案>|--clipboard) [--all-terms] [--format json|md] [--passages <1～10>] [--select <文件代碼,...>] [--type <格式>] [--root <路徑>] [--limit <1～500>]",
    "  docsearch open <文件代碼> [--dry-run]",
    "  docsearch reveal <文件代碼> [--dry-run]",
    "  docsearch roots [remove <root>]",
    "  docsearch status",
    "  docsearch rebuild [root] [--verbose]",
    "  docsearch watch [root] [--debounce <毫秒>] [--rescan <毫秒>] [--verbose]",
    "",
    "search 在互動終端預設每頁 20 筆，可用 n／p 翻頁、/ 關鍵字縮小結果、back 撤回、reset 重設、q 結束；單頁與零結果仍可操作。非互動輸出可用 --page 與 --page-size。--limit 保留為單次輸出的相容選項。",
    "index 可將涵蓋的既有子根合併為上層登錄；已包含於上層的子目錄只同步該子樹。--root 可為已登錄根目錄或其下子樹／已合併原子根。",
    "Windows 磁碟根目錄請用 D:/ ；加引號時請寫 D:/，不要讓路徑以反斜線結尾。",
    "context 預設 100、最高 500。--type 例如 pdf,docx,xml（可有前導點、忽略大小寫）。",
    `目前支援 ${[...supportedExtensions].join("、")}（PDF 只擷取文字層）；搜尋前請先執行 index。`,
    "VSD v11 擷取直接儲存的圖形文字；不展開 master／動態欄位，舊版或不支援結構仍可搜尋檔名。",
    "查詢預設為整段子字串；--all-terms 要求空白分隔詞全部出現在同一文件。AND、*、? 不作進階查詢語法。",
    "context 內可用 s <查詢> 跨查詢累積選取，b 查看已選清單，r <編號> 移除。",
  ].join("\n");
}

function printSummary(summary: SyncSummary): void {
  console.log(`找到 ${summary.found} 份一般檔案；更新 ${summary.updated}、未變更 ${summary.unchanged}、移除 ${summary.removed}。`);
  console.log(`新增 ${summary.added}、重新處理 ${summary.reprocessed}；解析器呼叫 ${summary.parserCalls} 次。`);
  console.log(`本次處理狀態：${Object.entries(summary.statuses).map(([status, count]) => `${status}=${count}`).join("、")}`);
  console.log(`略過項目（不計已排除目錄的內部文件）：內建規則 ${summary.skipped.builtin}、使用者規則 ${summary.skipped.user}、連結 ${summary.skipped.link}。${summary.skipped.unsupported ? ` 舊版未登錄格式 ${summary.skipped.unsupported}。` : ""}`);
  console.log(`掃描／讀取錯誤 ${summary.readErrors}；同步耗時 ${summary.elapsedMs} ms。`);
}

function printSearchResults(results: readonly SearchResult[], verbose: boolean, write: (text: string) => void = console.log): void {
  for (const result of results) {
    write(`${result.path} (${result.extension})`);
    write(`  文件代碼：${result.reference}；open ${result.reference}／reveal ${result.reference}`);
    write(`  命中：${result.reason}${result.filenameOnly ? "（僅檔名命中）" : ""}`);
    if (result.condition) write(`  條件：${result.condition}`);
    if (result.status !== "indexed") write(`  解析狀態：${result.status}`);
    if (result.heading) write(`  標題：${result.heading}`);
    if (result.location) write(`  位置：${result.location}`);
    write(`  片段：${result.snippet}${result.snippetTruncated ? "（命中文字已截短）" : ""}`);
    write(`  修改：${new Date(result.modifiedAtMs).toISOString()}`);
    if (verbose) write(`  排序：等級 ${result.rank}；同級按修改時間 ${result.modifiedAtMs} 由新到舊，再按完整路徑固定字串順序：${result.path}`);
  }
}

export async function main(args: readonly string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(buildHelpText());
    return 0;
  }
  const command = args[0];
  if (!["index", "search", "status", "rebuild", "open", "reveal", "roots", "context", "watch"].includes(command ?? "")) {
    console.error(`未知命令：${command}`);
    return 2;
  }
  let contextOutput: string | undefined;
  let contextClipboard = false;
  let allTerms = false;
  let selectedReferences: string[] | undefined;
  let contextFormat: "json" | "md" = "json";
  let contextPassages = 3;
  let watchDebounce: number | undefined;
  let watchRescan: number | undefined;
  const contextQuery = command === "context" && args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  let rootInput: string | undefined;
  let rootFilter: string | undefined;
  let dryRun = false;
  let limit = command === "context" ? 100 : 20;
  let limitSpecified = false;
  let searchPage = 1;
  let searchPageSpecified = false;
  let searchPageSize = 20;
  let searchPageSizeSpecified = false;
  let verbose = false;
  let types: string[] | undefined;
  try {
    if (command === "watch") {
      const values: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const option = args[i]!;
        if (option === "--verbose") {
          if (verbose) throw new Error("不可重複指定 --verbose。");
          verbose = true;
        } else if (option === "--debounce") {
          if (watchDebounce !== undefined) throw new Error("不可重複指定 --debounce。");
          const value = args[++i];
          if (!value || value.startsWith("--")) throw new Error("--debounce 缺少毫秒數。");
          watchDebounce = resolveWatchDebounce(Number(value));
        } else if (option === "--rescan") {
          if (watchRescan !== undefined) throw new Error("不可重複指定 --rescan。");
          const value = args[++i];
          if (!value || !value.trim() || value.startsWith("--")) throw new Error("--rescan 缺少毫秒數。");
          watchRescan = resolveWatchRescan(Number(value));
        } else if (option.startsWith("--") || !option.trim()) {
          throw new Error("用法：docsearch watch [root] [--debounce <毫秒>] [--rescan <毫秒>] [--verbose]");
        } else {
          if (values.length) throw new Error("用法：docsearch watch [root] [--debounce <毫秒>] [--rescan <毫秒>] [--verbose]");
          values.push(option);
        }
      }
      rootInput = values[0];
    } else if (command === "index" || command === "rebuild") {
      const values = args.slice(1).filter(value => value !== "--verbose");
      if (values.length > 1 || args.filter(value => value === "--verbose").length > 1 || values.some(value => !value.trim() || value.startsWith("--"))) {
        throw new Error(`用法：docsearch ${command} [root] [--verbose]`);
      }
      rootInput = values[0]; verbose = args.includes("--verbose");
    } else if (command === "roots") {
      if (args.length !== 1 && !(args.length === 3 && args[1] === "remove" && args[2] && !args[2].startsWith("--"))) throw new Error("用法：docsearch roots [remove <root>]");
    } else if (command === "open" || command === "reveal") {
      if (!args[1] || !/^[1-9]\d*-[0-9a-f]{16}$/.test(args[1]) || !Number.isSafeInteger(Number(args[1].split("-")[0])) || args.length > 3 || (args[2] !== undefined && args[2] !== "--dry-run")) throw new Error(`用法：docsearch ${command} <文件代碼> [--dry-run]`);
      dryRun = args[2] === "--dry-run";
    } else if (command === "status") {
      if (args.length !== 1) throw new Error("用法：docsearch status");
    } else {
      if (command !== "context" && !args[1]?.trim()) throw new Error("搜尋文字不可為空白。");
      const seen = new Set<string>();
      for (let i = command === "context" && contextQuery === undefined ? 1 : 2; i < args.length; i++) {
        const option = args[i]!;
        if (seen.has(option)) throw new Error(`不可重複指定 ${option}。`);
        seen.add(option);
        if (option === "--out" && command === "context") {
          const value = args[++i];
          if (!value?.trim() || value.startsWith("--")) throw new Error("--out 缺少新檔案路徑。");
          contextOutput = value;
        } else if (option === "--clipboard" && command === "context") {
          contextClipboard = true;
        } else if (option === "--all-terms") {
          allTerms = true;
        } else if (option === "--select" && command === "context") {
          const value = args[++i];
          if (!value) throw new Error("--select 缺少文件代碼。");
          selectedReferences = value.split(",").map(item => item.trim());
          if (selectedReferences.some(item => !/^[1-9]\d*-[0-9a-f]{16}$/.test(item)) || new Set(selectedReferences).size > 20) throw new Error("--select 需為最多 20 份文件代碼，以逗號分隔。");
        } else if (option === "--format" && command === "context") {
          const value = args[++i];
          if (value !== "json" && value !== "md") throw new Error("--format 必須是 json 或 md。");
          contextFormat = value;
        } else if (option === "--passages" && command === "context") {
          const value = args[++i];
          if (!value || !/^[1-9]\d*$/.test(value) || Number(value) > 10) throw new Error("--passages 必須是 1～10 的整數。");
          contextPassages = Number(value);
        } else if (option === "--verbose") verbose = true;
        else if (option === "--limit") {
          const value = args[++i];
          if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("--limit 必須是正整數。");
          limit = Number(value);
          limitSpecified = true;
        } else if (option === "--page" && command === "search") {
          const value = args[++i];
          if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("--page 必須是正整數。");
          searchPage = Number(value); searchPageSpecified = true;
        } else if (option === "--page-size" && command === "search") {
          const value = args[++i];
          if (!value || !/^[1-9]\d*$/.test(value) || Number(value) > 100) throw new Error("--page-size 必須是 1～100 的整數。");
          searchPageSize = Number(value); searchPageSizeSpecified = true;
        } else if (option === "--root") {
          const value = args[++i];
          if (!value || value.startsWith("--")) throw new Error("--root 缺少根目錄路徑。");
          rootFilter = value;
        } else if (option === "--type") {
          const value = args[++i];
          if (value === undefined) throw new Error("--type 缺少格式清單。");
          types = parseTypes(value);
        } else throw new Error(command === "context" ? "用法：docsearch context [query] (--out <新檔案>|--clipboard) [--all-terms] [--select <文件代碼,...>] [--limit <1～500>] [--type <格式>] [--root <路徑>]" : "用法：docsearch search <query> [--all-terms] [--page <正整數>] [--page-size <1～100>] [--limit <正整數>] [--type <格式清單>] [--root <路徑>] [--verbose]");
      }
      if (command === "context" && (Boolean(contextOutput) === contextClipboard || limit > 500)) throw new Error("context 需要在 --out <新檔案> 與 --clipboard 中擇一；--limit 限 1～500；--format 為 json|md，--passages 為 1～10。");
      if (command === "search" && limitSpecified && (searchPageSpecified || searchPageSizeSpecified)) throw new Error("--limit 不可與 --page 或 --page-size 同時使用。");
    }
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  let store: IndexStore | undefined;
  let reporter: ReturnType<typeof progressReporter> | undefined;
  let abortController: AbortController | undefined;
  let cancel: (() => void) | undefined;
  try {
    const databasePath = defaultDatabasePath();
    const writes = command === "index" || command === "rebuild" || command === "watch" || (command === "roots" && args[1] === "remove");
    if (command === "status") console.log(`索引位置：${databasePath}\n讀取索引狀態…`);
    if (!writes && !existsSync(databasePath)) { console.error("索引尚未建立；請先執行 docsearch index <root>。"); return 3; }
    if (writes) {
      reporter = progressReporter();
      reporter.update({ stage: "recover", message: "開啟並檢查本機索引" });
      abortController = new AbortController();
      cancel = () => abortController!.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
    }
    store = new IndexStore(databasePath, { readOnly: !writes });
    if (writes && !(command === "roots" && args[1] === "remove")) {
      await store.upgrade({ ...(abortController ? { signal: abortController.signal } : {}), onProgress: update => reporter?.update(update) });
    }

    if (command === "watch") {
      const registered = store.roots();
      let targets: string[];
      if (rootInput) {
        const requested = resolveUserRootPath(rootInput);
        const existing = registered.find(root => process.platform === "win32" ? root.toLowerCase() === requested.toLowerCase() : root === requested);
        if (!existing) {
          const merged = store.findMergedParent(requested);
          throw new RootError(merged
            ? `該路徑已合併至上層索引：${merged}；請改監看上層根目錄。`
            : "監看只接受已登錄根目錄；新增位置請先 index。");
        }
        targets = [existing];
      } else {
        targets = registered;
      }
      if (!targets.length) { console.error("索引尚未建立；請先執行 docsearch index <root>。"); return 3; }
      let finish!: () => void;
      const stop = new Promise<void>(resolve => {
        finish = () => resolve();
        process.on("SIGINT", finish);
        process.on("SIGTERM", finish);
      });
      try {
        return await runWatch(store, targets, {
          ...(watchDebounce !== undefined ? { debounceMs: watchDebounce } : {}),
          ...(watchRescan !== undefined ? { rescanMs: watchRescan } : {}),
          verbose, onProgress: update => reporter?.update(update),
        }, {
          write: text => console.log(text),
          waitForStop: () => stop,
        });
      } finally {
        process.off("SIGINT", finish);
        process.off("SIGTERM", finish);
      }
    }
    if (command === "index" || command === "rebuild") {
      if (command === "rebuild" && rootInput) {
        const requested = resolveUserRootPath(rootInput);
        const existing = store.roots().find(root => process.platform === "win32" ? root.toLowerCase() === requested.toLowerCase() : root === requested);
        if (!existing) {
          const merged = store.findMergedParent(requested);
          throw new RootError(merged
            ? `該路徑已合併至上層索引：${merged}；重建請指定有效根目錄，避免隱式擴大範圍。`
            : "重建只接受已登錄根目錄；新增位置請使用 index。");
        }
        rootInput = existing;
      }
      const targets = rootInput ? [rootInput] : store.roots();
      if (!targets.length) { console.error("索引尚未建立；請先執行 docsearch index <root>。"); return 3; }
      let exitCode = 0;
      // search/status 不載入 Office/PDF 解析器，也不掃描來源目錄。
      const { sync } = await import("./sync.js");
      for (const target of targets) {
        try {
          const report = await sync(target, store, { rebuild: command === "rebuild", requireRegistered: !rootInput || command === "rebuild",
            ...(abortController ? { signal: abortController.signal } : {}), onProgress: update => reporter?.update(update) });
          console.log(`根目錄：${report.root}`);
          for (const notice of report.notices.filter(item => item.startsWith("合併根目錄範圍：") || item.startsWith("合併：") || item.startsWith("已包含於上層索引："))) {
            console.log(`提示：${notice}`);
          }
          if (command === "rebuild") console.log(report.complete ? "重建完成。" : "重建未完整完成。");
          printSummary(report);
          console.log(`同步完整：${report.complete ? "是" : "否"}（文件解析狀態另列）`);
          if (report.found === 0) console.log("沒有找到支援的文件。");
          if (!report.complete) exitCode = 3;
          if (!report.complete) console.log(command === "rebuild"
            ? "提示：本次重建不完整；部分內容可能尚未更新，請查看問題清單。"
            : "提示：本次同步不完整；為避免誤刪，保留無法確認的既有索引資料。");
          for (const notice of report.notices.filter(item => !item.startsWith("合併根目錄範圍：") && !item.startsWith("合併：") && !item.startsWith("已包含於上層索引："))) {
            console.log(`提示：${notice}`);
          }
          for (const error of report.errors) console.error(`文件問題：${error}`);
          if (verbose) {
            console.log("內建排除：.git/、node_modules/、.localdocsearch/、~$ 暫存項目；不追蹤符號連結／junction。");
            console.log(`排除檔：${report.ignoreFile ?? "未設定"}`);
            for (const rule of report.ignorePatterns) console.log(`  規則：${rule}`);
            for (const issue of report.diagnostics) console.error(`  [${issue.stage}/${issue.code}] ${issue.path}：${issue.message}`);
          }
        } catch (error) {
            if (!(error instanceof RootError || error instanceof IgnoreConfigurationError)) throw error;
            console.error(error.message); exitCode = 3;

        }
      }
      return exitCode;
    }
    const indexStore = store;
    const roots = indexStore.roots();
    const registeredRoot = (value: string) => {
      const requested = resolveUserRootPath(value);
      const root = roots.find(item => process.platform === "win32" ? item.toLowerCase() === requested.toLowerCase() : item === requested);
      if (!root) {
        const merged = indexStore.findMergedParent(requested);
        if (merged) throw new RootError(`該路徑已合併至上層索引：${merged}；請對上層根目錄操作 remove。`);
        throw new RootError("該根目錄未登錄；請以 roots 顯示的路徑操作。");
      }
      return root;
    };
    if (command === "roots") {
      if (args[1] === "remove") {
        const root = registeredRoot(args[2]!);
        console.log(`已移除根目錄登錄及 ${store.removeRoot(root)} 份索引，來源文件未變更：${root}`);
      } else {
        console.log(`已登錄根目錄：${roots.length}`);
        for (const root of roots) console.log(root);
      }
      return 0;
    }
    if (!roots.length) {
      console.error("索引尚未建立；請先執行 docsearch index <root>。"); return 3;
    }
    const searchScope = rootFilter ? store.resolveSearchScope(rootFilter) : undefined;
    const selectedRoot = searchScope?.root;
    const selectedSubtree = searchScope?.subtree;
    if (command === "context") {
      await interactiveContext(store, {
        ...(contextOutput ? { output: contextOutput } : {}), ...(contextClipboard ? { clipboard: true } : {}),
        limit, format: contextClipboard && !args.includes("--format") ? "md" : contextFormat, passages: contextPassages,
        ...(allTerms ? { allTerms: true } : {}),
        ...(contextQuery !== undefined ? { query: contextQuery } : {}),
        ...(selectedReferences ? { select: selectedReferences } : {}),
        ...(types ? { types } : {}), ...(selectedRoot ? { root: selectedRoot } : {}),
        ...(selectedSubtree ? { subtree: selectedSubtree } : {}),
      });
      return 0;
    }
    if (command === "open" || command === "reveal") {
      const target = await actOnDocument(store, args[1]!, command, dryRun);
      if (target.changed) console.log("提示：來源已變更，搜尋片段可能過期；建議重新 index。");
      console.log(`${dryRun ? "預覽，未啟動" : "已送出請求"}：${command === "open" ? "開啟文件" : "顯示所在資料夾"} ${target.path}`);
      return 0;
    }
    if (command === "status") {
      const format = store.formatStatus();
      console.log(`索引格式：文字儲存 ${format.contentStorageVersion ?? "舊版"}；payload Bloom ${format.payloadBloomVersion ?? "未完成"}`);
      if (format.needsUpgrade) console.log(`索引升級：需要升級（已完成 ${format.completedDocuments}/${format.totalDocuments} 份文件）；請執行 index 接續。`);
      else console.log("索引升級：已完成。");
      for (const root of roots) {
        const syncReport = store.getLastSyncReport(root);
        console.log(`根目錄：${root}`);
        console.log(`最後嘗試同步：${syncReport.attemptedAt ?? "尚未同步"}`);
        console.log(`最後完整同步：${syncReport.successfulAt ?? "尚未完成"}`);
        if (syncReport.complete !== null) console.log(`最近同步完整：${syncReport.complete ? "是" : "否"}`);
        if (syncReport.summary) { console.log("最近同步摘要（歷史紀錄，非即時磁碟清單）："); printSummary(syncReport.summary); }
        console.log(`最近同步錯誤：${syncReport.errors.length}`);
        for (const issue of syncReport.diagnostics) console.log(`  [${issue.stage}/${issue.code}] ${issue.path}：${issue.message}`);
      }
      console.log("全部根目錄文件狀態：");
      for (const [status, count] of Object.entries(store.counts())) console.log(`${status}：${count}`);
      const issues = store.documentIssues();
      console.log(`文件問題：${issues.length}`);
      // 不直接輸出解析器的原始錯誤文字，避免 XML 等解析例外帶出文件內容。
      for (const issue of issues) console.log(`  ${issue.path} [${issue.status}/${issue.errorCode ?? "UNKNOWN"}]`);
      return 0;
    }
    const session = new SearchSession(store, args[1]!, types, selectedRoot, allTerms ? "all-terms" : "phrase", selectedSubtree);
    const availablePages = Math.max(1, Math.ceil(session.originalTotal / searchPageSize));
    if (!limitSpecified && searchPage > availablePages) {
      console.error(`頁碼超出範圍；共有 ${availablePages} 頁。`);
      return 2;
    }
    console.log(`搜尋根目錄：${selectedSubtree ? `${selectedSubtree}（上層 ${selectedRoot}）` : selectedRoot ?? `全部 ${roots.length} 個`}`);
    console.log(`查詢模式：${allTerms ? "全部關鍵字" : "精確片語"}`);
    console.log(`格式範圍：${types?.join(",") ?? "全部已登錄格式"}。`);
    for (const root of selectedRoot ? [selectedRoot] : roots) {
      const syncReport = store.getLastSyncReport(root);
      console.log(`根目錄：${root}；最後完整同步：${syncReport.successfulAt ?? "尚未完成"}（搜尋現有索引）`);
      if (syncReport.complete === false) console.log("提示：最近同步不完整；結果可能包含尚未確認的既有文件。");
    }
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !searchPageSpecified && !limitSpecified);
    if (session.originalTotal === 0) {
      console.log(Object.values(store.counts()).every(count => count === 0)
        ? "索引內沒有支援的文件；請確認根目錄、排除規則與同步狀態。" : "沒有符合的結果。");
      if (!interactive) return 0;
    } else if (limitSpecified) {
      const page = session.page(1, limit);
      console.log(`符合 ${page.total} 份文件；顯示前 ${page.results.length} 份（--limit 單次輸出）。`);
      printSearchResults(page.results, verbose);
      return 0;
    }
    if (!interactive) {
      const page = session.page(searchPage, searchPageSize);
      console.log(`符合 ${page.total} 份文件；第 ${page.page}/${page.pageCount} 頁，本頁 ${page.start}–${page.end}；回傳 ${page.results.length} 份。`);
      printSearchResults(page.results, verbose);
      if (page.page < page.pageCount) console.log(`提示：尚有結果；使用 --page ${page.page + 1} --page-size ${page.pageSize} 查看下一頁。`);
      return 0;
    }
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    let inputClosed = false;
    readline.on("close", () => { inputClosed = true; });
    readline.on("SIGINT", () => readline.close());
    try {
      return await runSearchSession(session, {
        pageSize: searchPageSize,
        renderResults: (results, write) => printSearchResults(results, verbose, write),
      }, {
        write: text => console.log(text),
        writeError: text => console.error(text),
        ask: async prompt => {
          if (inputClosed) return null;
          const abort = new AbortController();
          const stop = () => abort.abort();
          readline.once("close", stop);
          try { return await readline.question(prompt, { signal: abort.signal }); }
          catch { return null; }
          finally { readline.off("close", stop); }
        },
      });
    } finally {
      readline.close();
    }
  } catch (error) {
    if (error instanceof OperationCancelledError) { console.error(`${error.code}：${error.message}`); return 130; }
    const sqliteCode = sqliteExtendedCode(error);
    if (sqliteCode === 776) { console.error("INDEX_RECOVERY_REQUIRED：索引有未完成交易，需要由下一次 index 安全回復；請勿刪除 journal 或 WAL。"); return 3; }
    if (sqliteCode !== undefined && ((sqliteCode & 0xff) === 5 || (sqliteCode & 0xff) === 6)) { console.error("INDEX_BUSY：索引目前由另一個程序使用，請稍後重試。"); return 3; }
    if (error instanceof SearchIndexChangedError) { console.error(`SEARCH_INDEX_CHANGED：${error.message}`); return 3; }
    if (error instanceof IndexBusyError || error instanceof ContextError || error instanceof WatchError || error instanceof ClipboardError) { console.error(`${error.code}：${error.message}`); return 3; }
    if (error instanceof DocumentActionError) { console.error(`${error.code}：${error.message}`); return 3; }
    if (error instanceof RootError || error instanceof IgnoreConfigurationError) { console.error(error.message); return 3; }
    console.error("內部錯誤 LDS-001：無法完成操作。");
    if (verbose) console.error(`診斷：${error instanceof Error ? error.name : "UnknownError"}`);
    return 4;
  } finally {
    reporter?.close();
    if (cancel) { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
    store?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
