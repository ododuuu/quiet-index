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

export const supportedExtensions = new Set([".md", ".txt", ".xml", ".docx", ".pptx", ".xlsx", ".pdf", ".doc", ".xls", ".mht", ".mhtml", ".html", ".htm", ".xhtml", ".adoc", ".msg", ".vsd"]);

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
