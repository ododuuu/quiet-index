export const documentStatuses = ["indexed", "no_text", "unsupported", "too_large", "encrypted", "error"] as const;
export type DocumentStatus = typeof documentStatuses[number];

export interface TextBlock {
  ordinal: number;
  heading: string | null;
  content: string;
  locationKind: "section" | "line" | "slide" | "sheet_cell" | "page";
  locationValue: string;
}

export interface DocumentRecord {
  path: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  modifiedAtMs: number;
  status: DocumentStatus;
  errorCode: string | null;
  errorMessage: string | null;
  blocks: TextBlock[];
}

export const supportedExtensions = new Set([
  ".md", ".txt", ".xml", ".java", ".sql", ".js",
  ".docx", ".pptx", ".xlsx", ".xlsm", ".odt", ".rtf", ".csv", ".pdf", ".doc", ".xls",
  ".mht", ".mhtml", ".html", ".htm", ".xhtml", ".adoc", ".msg", ".vsd",
]);

export const TEXT_PARSE_VERSION = 1;
export const textParseExtensions = new Set([".txt", ".md", ".adoc", ".xml", ".java", ".sql", ".js"]);

export function needsTextParseUpgrade(
  previous: { status: DocumentStatus; parse_version?: number | null },
  extension: string,
): boolean {
  if (!textParseExtensions.has(extension)) return false;
  if (previous.status === "too_large") return false;
  return (previous.parse_version ?? 0) < TEXT_PARSE_VERSION;
}

export interface Diagnostic {
  stage: "scan" | "read" | "parse" | "store";
  path: string;
  code: string;
  message: string;
}

export interface SkippedCounts {
  builtin: number;
  user: number;
  unsupported: number;
  link: number;
}

export interface SyncSummary {
  found: number;
  updated: number;
  added: number;
  reprocessed: number;
  unchanged: number;
  removed: number;
  parserCalls: number;
  statuses: Record<DocumentStatus, number>;
  skipped: SkippedCounts;
  readErrors: number;
  elapsedMs: number;
}

export function emptyStatusCounts(): Record<DocumentStatus, number> {
  return Object.fromEntries(documentStatuses.map(status => [status, 0])) as Record<DocumentStatus, number>;
}
