import { acquireWriteLock } from "./write-lock.js";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { documentStatuses, type Diagnostic, type SyncSummary, type DocumentRecord, type DocumentStatus, type TextBlock } from "./model.js";
import { throwIfAborted, yieldToEvents, type ProgressUpdate } from "./progress.js";

export function defaultDatabasePath(): string {
  const base = process.env.LOCALDOCSEARCH_DATA_DIR
    ?? (process.platform === "win32" ? process.env.LOCALAPPDATA : process.env.XDG_DATA_HOME)
    ?? (process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local") : path.join(os.homedir(), ".local", "share"));
  return path.join(base, "LocalDocSearch", "index.db");
}

export interface StoredDocumentRow {
  id: number;
  path: string;
  filename: string;
  extension: string;
  size_bytes: number;
  modified_at_ms: number;
  status: DocumentStatus;
}

export interface StoredBlockRow {
  ordinal: number;
  heading: string | null;
  content: string;
  location_kind: TextBlock["locationKind"];
  location_value: string;
}

type StoredBlockDatabaseRow = StoredBlockRow & { id: number };
const textChunkBytes = 64 * 1024;
const bloomBytes = 1024;

function bloomHash(value: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

function buildBloom(blocks: readonly TextBlock[]): Uint8Array {
  const bloom = new Uint8Array(bloomBytes);
  for (const block of blocks) {
    const value = `${block.heading ?? ""}\u0000${block.content}`.normalize("NFKC").toLowerCase();
    for (let index = 0; index + 2 < value.length; index++) {
      const gram = value.slice(index, index + 3);
      for (const seed of [0x811c9dc5, 0x9e3779b9]) { const bit = bloomHash(gram, seed) % (bloomBytes * 8); bloom[bit >>> 3]! |= 1 << (bit & 7); }
    }
  }
  return bloom;
}

function bloomMayContain(bloom: Uint8Array, term: string): boolean {
  if (term.length < 3) return true;
  for (let index = 0; index + 2 < term.length; index++) {
    const gram = term.slice(index, index + 3);
    for (const seed of [0x811c9dc5, 0x9e3779b9]) { const bit = bloomHash(gram, seed) % (bloomBytes * 8); if (!(bloom[bit >>> 3]! & (1 << (bit & 7)))) return false; }
  }
  return true;
}

// A payload only has to contain one trigram to be worth reading: the exact
// query can cross a payload boundary, and the complete owning block is still
// verified below.  Requiring every trigram here would incorrectly discard a
// long query split over payloads.
function bloomMayContainAny(bloom: Uint8Array, terms: readonly string[]): boolean {
  return terms.some(term => {
    if (term.length < 3) return true;
    for (let index = 0; index + 2 < term.length; index++) {
      const gram = term.slice(index, index + 3);
      let present = true;
      for (const seed of [0x811c9dc5, 0x9e3779b9]) {
        const bit = bloomHash(gram, seed) % (bloomBytes * 8);
        if (!(bloom[bit >>> 3]! & (1 << (bit & 7)))) { present = false; break; }
      }
      if (present) return true;
    }
    return false;
  });
}

function splitText(value: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + textChunkBytes);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
    chunks.push(value.slice(start, end)); start = end;
  }
  return chunks;
}

function compressText(value: string): Uint8Array {
  return brotliCompressSync(Buffer.from(value, "utf8"), { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } });
}

export interface SearchCandidate {
  document: StoredDocumentRow;
  blocks: StoredBlockRow[];
}

export interface StreamingCandidate {
  document: StoredDocumentRow;
  blocks: Iterable<StoredBlockRow>;
}

export interface StoredIssue {
  path: string;
  status: DocumentStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface LastSyncReport {
  attemptedAt: string | null;
  successfulAt: string | null;
  complete: boolean | null;
  errors: string[];
  notices: string[];
  summary: SyncSummary | null;
  diagnostics: Diagnostic[];
}

export interface IndexStoreOptions {
  readOnly?: boolean;
}

export interface IndexFormatStatus {
  contentStorageVersion: string | null;
  payloadBloomVersion: string | null;
  needsUpgrade: boolean;
  completedDocuments: number;
  totalDocuments: number;
}

export interface UpgradeOptions {
  lockHeld?: boolean;
  signal?: AbortSignal;
  onProgress?: (update: ProgressUpdate) => void;
}

export class IndexStore {
  private readonly db: DatabaseSync;
  private readonly readOnly: boolean;
  readonly databasePath: string;

  constructor(databasePath = defaultDatabasePath(), options: IndexStoreOptions = {}) {
    this.databasePath = databasePath;
    this.readOnly = options.readOnly ?? false;
    if (this.readOnly) {
      this.db = new DatabaseSync(databasePath, { readOnly: true });
      this.db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 0;");
      return;
    }
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const fresh = !existsSync(databasePath);
    const release = acquireWriteLock(databasePath);
    try {
      this.db = new DatabaseSync(databasePath);
      this.db.exec("PRAGMA busy_timeout = 0");
      this.initializeSchema();
      if (fresh) {
        this.db.exec(`INSERT OR REPLACE INTO metadata(key, value) VALUES
          ('content_storage_version', '2'), ('payload_bloom_version', '1'), ('multi_root_version', '1')`);
      }
    } finally { release(); }
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
        extension TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_at_ms REAL NOT NULL,
        indexed_at_ms INTEGER NOT NULL, status TEXT NOT NULL,
        error_code TEXT, error_message TEXT
      );
      CREATE TABLE IF NOT EXISTS blocks (
        id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, heading TEXT, content TEXT NOT NULL,
        location_kind TEXT NOT NULL, location_value TEXT NOT NULL,
        UNIQUE(document_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS blocks_document_id ON blocks(document_id);
      CREATE TABLE IF NOT EXISTS block_payloads (
        block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, payload BLOB NOT NULL,
        PRIMARY KEY(block_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS document_payloads (
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, payload BLOB NOT NULL,
        PRIMARY KEY(document_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS document_blooms (
        document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, bloom BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS document_payload_blocks (
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        payload_ordinal INTEGER NOT NULL, block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        PRIMARY KEY(document_id, payload_ordinal, block_id)
      );
      CREATE INDEX IF NOT EXISTS document_payload_blocks_document_block ON document_payload_blocks(document_id, block_id);
      CREATE TABLE IF NOT EXISTS document_payload_blooms (
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        payload_ordinal INTEGER NOT NULL, bloom BLOB NOT NULL,
        PRIMARY KEY(document_id, payload_ordinal)
      );
      CREATE TABLE IF NOT EXISTS index_migration_documents (
        version TEXT NOT NULL,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        PRIMARY KEY(version, document_id)
      );
      CREATE TABLE IF NOT EXISTS roots (path TEXT PRIMARY KEY, report TEXT);
      CREATE TABLE IF NOT EXISTS document_roots (
        document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        root_path TEXT NOT NULL REFERENCES roots(path) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS document_roots_path ON document_roots(root_path);
    `);
  }

  formatStatus(): IndexFormatStatus {
    const contentStorageVersion = this.metadata("content_storage_version");
    const payloadBloomVersion = this.metadata("payload_bloom_version");
    const totalDocuments = this.hasTable("documents")
      ? Number((this.db.prepare("SELECT count(*) AS count FROM documents").get() as { count: number }).count) : 0;
    const completedDocuments = this.hasTable("index_migration_documents")
      ? Number((this.db.prepare("SELECT count(*) AS count FROM index_migration_documents WHERE version = 'payload_bloom_1'").get() as { count: number }).count) : 0;
    return { contentStorageVersion, payloadBloomVersion,
      needsUpgrade: contentStorageVersion !== "2" || payloadBloomVersion !== "1" || this.metadata("multi_root_version") !== "1",
      completedDocuments, totalDocuments };
  }

  async upgrade(options: UpgradeOptions = {}): Promise<void> {
    if (this.readOnly) throw new Error("唯讀索引不能執行升級。");
    const release = options.lockHeld ? undefined : acquireWriteLock(this.databasePath);
    try {
      throwIfAborted(options.signal);
      if (this.metadata("content_storage_version") !== "2") {
        options.onProgress?.({ stage: "upgrade", message: "升級舊索引文字儲存格式" });
        this.migratePayloads();
      }
      if (this.metadata("multi_root_version") !== "1") this.migrateMultiRoot();
      if (this.metadata("payload_bloom_version") !== "1") await this.migratePayloadBlooms(options);
    } finally { release?.(); }
  }

  private migrateMultiRoot(): void {
    if (this.metadata("multi_root_version") !== "1") {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const oldRoot = this.getRoot();
        if (oldRoot) {
          this.db.prepare("INSERT OR IGNORE INTO roots(path, report) VALUES (?, ?)").run(oldRoot, JSON.stringify(this.getLastSyncReport()));
          this.db.prepare("INSERT OR IGNORE INTO document_roots SELECT id, ? FROM documents").run(oldRoot);
        }
        this.db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('multi_root_version', '1')").run();
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
  }

  private hasTable(name: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  }

  roots(): string[] {
    return (this.db.prepare("SELECT path FROM roots ORDER BY path").all() as { path: string }[]).map(row => row.path);
  }

  registerRoot(root: string): void { this.db.prepare("INSERT OR IGNORE INTO roots(path) VALUES (?)").run(root); }

  documentRoot(id: number): string | null {
    return (this.db.prepare("SELECT root_path FROM document_roots WHERE document_id = ?").get(id) as { root_path: string } | undefined)?.root_path ?? null;
  }

  removeRoot(root: string): number {
    const release = acquireWriteLock(this.databasePath);
    try { return this.removeRootLocked(root); } finally { release(); }
  }

  private removeRootLocked(root: string): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("DELETE FROM documents WHERE id IN (SELECT document_id FROM document_roots WHERE root_path = ?)").run(root);
      this.db.prepare("DELETE FROM roots WHERE path = ?").run(root);
      if (this.getRoot() === root) {
        this.db.prepare("DELETE FROM metadata WHERE key = 'root' OR key LIKE 'last_%'").run();
        const next = this.roots()[0];
        if (next) this.setRoot(next);
      }
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  close(): void { this.db.close(); }

  getRoot(): string | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = 'root'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setRoot(root: string): void {
    this.db.prepare("INSERT INTO metadata (key, value) VALUES ('root', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(root);
  }

  getDocumentById(id: number): StoredDocumentRow | undefined {
    return this.db.prepare("SELECT id, path, filename, extension, size_bytes, modified_at_ms, status FROM documents WHERE id = ?").get(id) as StoredDocumentRow | undefined;
  }

  getDocument(filePath: string): StoredDocumentRow | undefined {
    return this.db.prepare("SELECT id, path, filename, extension, size_bytes, modified_at_ms, status FROM documents WHERE path = ?").get(filePath) as StoredDocumentRow | undefined;
  }

  upsert(document: DocumentRecord, root?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO documents
        (path, filename, extension, size_bytes, modified_at_ms, indexed_at_ms, status, error_code, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET filename=excluded.filename, extension=excluded.extension,
        size_bytes=excluded.size_bytes, modified_at_ms=excluded.modified_at_ms,
        indexed_at_ms=excluded.indexed_at_ms, status=excluded.status,
        error_code=excluded.error_code, error_message=excluded.error_message`)
        .run(document.path, document.filename, document.extension, document.sizeBytes,
          document.modifiedAtMs, Date.now(), document.status, document.errorCode, document.errorMessage);
      const row = this.getDocument(document.path)!;
      if (root) this.db.prepare("INSERT INTO document_roots(document_id, root_path) VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET root_path=excluded.root_path").run(row.id, root);
      this.db.prepare("DELETE FROM blocks WHERE document_id = ?").run(row.id);
      const insert = this.db.prepare("INSERT INTO blocks (document_id, ordinal, heading, content, location_kind, location_value) VALUES (?, ?, ?, ?, ?, ?)");
      this.db.prepare("DELETE FROM document_payloads WHERE document_id = ?").run(row.id);
      this.db.prepare("DELETE FROM document_payload_blocks WHERE document_id = ?").run(row.id);
      this.db.prepare("DELETE FROM document_payload_blooms WHERE document_id = ?").run(row.id);
      const entries: { id: number; ordinal: number; content: string }[] = [];
      for (const block of document.blocks) {
        insert.run(row.id, block.ordinal, block.heading, "", block.locationKind, block.locationValue);
        const blockId = (this.db.prepare("SELECT id FROM blocks WHERE document_id = ? AND ordinal = ?").get(row.id, block.ordinal) as { id: number }).id;
        entries.push({ id: blockId, ordinal: block.ordinal, content: block.content });
      }
      this.writeDocumentPayloads(row.id, entries);
      this.db.prepare("INSERT INTO document_blooms(document_id, bloom) VALUES (?, ?) ON CONFLICT(document_id) DO UPDATE SET bloom=excluded.bloom")
        .run(row.id, buildBloom(document.blocks));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  removeMissing(knownPaths: Set<string>, root?: string): number {
    let removed = 0;
    const rows = (root ? this.db.prepare("SELECT path FROM documents WHERE id IN (SELECT document_id FROM document_roots WHERE root_path = ?)").all(root) : this.db.prepare("SELECT path FROM documents").all()) as { path: string }[];
    const remove = this.db.prepare("DELETE FROM documents WHERE path = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        if (!knownPaths.has(row.path)) {
          remove.run(row.path);
          removed++;
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return removed;
  }

  clearDocuments(root?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (root) this.db.prepare("DELETE FROM documents WHERE id IN (SELECT document_id FROM document_roots WHERE root_path = ?)").run(root);
      else this.db.exec("DELETE FROM documents");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  candidates(types?: readonly string[], root?: string): SearchCandidate[] {
    const filters: string[] = [];
    const values: string[] = [];
    if (types) { filters.push(`extension IN (${types.map(() => "?").join(",")})`); values.push(...types); }
    if (root) { filters.push("id IN (SELECT document_id FROM document_roots WHERE root_path = ?)"); values.push(root); }
    const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const documents = this.db.prepare(`SELECT id, path, filename, extension, size_bytes, modified_at_ms, status FROM documents${where}`)
      .all(...values) as unknown as StoredDocumentRow[];
    return documents.map(document => ({ document, blocks: this.blocksFor(document.id) }));
  }

  *streamCandidates(types?: readonly string[], root?: string, terms?: readonly string[], allTerms = false): Generator<StreamingCandidate> {
    const filters: string[] = [];
    const values: string[] = [];
    if (types) { filters.push(`extension IN (${types.map(() => "?").join(",")})`); values.push(...types); }
    if (root) { filters.push("id IN (SELECT document_id FROM document_roots WHERE root_path = ?)"); values.push(root); }
    const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const documents = this.db.prepare(`SELECT id, path, filename, extension, size_bytes, modified_at_ms, status FROM documents${where}`);
    const bloom = this.db.prepare("SELECT bloom FROM document_blooms WHERE document_id = ?");
    const payloadBlooms = this.db.prepare("SELECT payload_ordinal, bloom FROM document_payload_blooms WHERE document_id = ? ORDER BY payload_ordinal");
    for (const document of documents.iterate(...values) as Iterable<StoredDocumentRow>) {
      const row = bloom.get(document.id) as { bloom: Uint8Array } | undefined;
      const possible = !terms || !row || (allTerms ? terms.some(term => bloomMayContain(row.bloom, term)) : bloomMayContain(row.bloom, terms[0]!));
      if (!possible) { yield { document, blocks: [] }; continue; }
      const summaries = payloadBlooms.all(document.id) as { payload_ordinal: number; bloom: Uint8Array }[];
      // Missing payload summaries are an old/incomplete index: retain the
      // document-level fallback rather than risking a false negative.
      const candidates = !terms || !summaries.length || terms.some(term => term.length < 3)
        ? undefined
        : summaries.filter(summary => bloomMayContainAny(summary.bloom, allTerms ? terms : [terms[0]!]))
          .map(summary => summary.payload_ordinal);
      // A trigram may straddle two compressed payloads.  The document bloom
      // has already established that the document is possible, so an empty
      // payload set must conservatively read it rather than lose that match.
      yield { document, blocks: candidates?.length ? this.streamBlocksFor(document.id, candidates) : this.streamBlocksFor(document.id) };
    }
  }

  candidateByPath(filePath: string): SearchCandidate | undefined {
    const document = this.db.prepare("SELECT id, path, filename, extension, size_bytes, modified_at_ms, status FROM documents WHERE path = ?")
      .get(filePath) as StoredDocumentRow | undefined;
    if (!document) return undefined;
    const blocks = this.blocksFor(document.id);
    return { document, blocks };
  }

  blockSource(documentId: number, ordinal: number, source: "heading" | "content"): string | null {
    const block = this.db.prepare("SELECT id FROM blocks WHERE document_id = ? AND ordinal = ?").get(documentId, ordinal) as { id: number } | undefined;
    if (!block) return null;
    const payloads = this.db.prepare("SELECT payload_ordinal FROM document_payload_blocks WHERE document_id = ? AND block_id = ? ORDER BY payload_ordinal")
      .all(documentId, block.id) as { payload_ordinal: number }[];
    // Legacy/incomplete maps remain readable through the full-document path.
    for (const blockSource of this.streamBlocksFor(documentId, payloads.length ? payloads.map(row => row.payload_ordinal) : undefined)) {
      if (blockSource.ordinal === ordinal) return source === "heading" ? blockSource.heading : blockSource.content;
    }
    return null;
  }

  private blocksFor(documentId: number): StoredBlockRow[] {
    return [...this.streamBlocksFor(documentId)];
  }

  private *streamBlocksFor(documentId: number, candidatePayloads?: readonly number[]): Generator<StoredBlockRow> {
    const blocks = this.db.prepare("SELECT id, ordinal, heading, content, location_kind, location_value FROM blocks WHERE document_id = ? ORDER BY ordinal")
      .all(documentId) as unknown as StoredBlockDatabaseRow[];
    let selectedIds: Set<number> | undefined;
    if (candidatePayloads) {
      if (!candidatePayloads.length) return;
      const placeholders = candidatePayloads.map(() => "?").join(",");
      selectedIds = new Set((this.db.prepare(`SELECT DISTINCT block_id FROM document_payload_blocks WHERE document_id = ? AND payload_ordinal IN (${placeholders})`)
        .all(documentId, ...candidatePayloads) as { block_id: number }[]).map(row => row.block_id));
      // An incomplete map must never hide content; this only occurs while an
      // interrupted old-index migration is being recovered.
      if (!selectedIds.size) selectedIds = undefined;
    }
    let payloads: { ordinal: number; payload: Uint8Array }[];
    if (selectedIds) {
      const ids = [...selectedIds]; const placeholders = ids.map(() => "?").join(",");
      payloads = this.db.prepare(`SELECT p.ordinal, p.payload FROM document_payloads p WHERE p.document_id = ? AND p.ordinal IN (
        SELECT DISTINCT payload_ordinal FROM document_payload_blocks WHERE document_id = ? AND block_id IN (${placeholders})
      ) ORDER BY p.ordinal`).all(documentId, documentId, ...ids) as { ordinal: number; payload: Uint8Array }[];
    } else {
      payloads = this.db.prepare("SELECT ordinal, payload FROM document_payloads WHERE document_id = ? ORDER BY ordinal").all(documentId) as { ordinal: number; payload: Uint8Array }[];
    }
    if (!payloads.length) {
      for (const block of blocks) {
        if (selectedIds && !selectedIds.has(block.id)) continue;
        if (!block.content) throw new Error("索引文字 payload 遺失，請執行 rebuild。");
        yield { ordinal: block.ordinal, heading: block.heading, content: block.content, location_kind: block.location_kind, location_value: block.location_value };
      }
      return;
    }
    const metadata = new Map(blocks.map(block => [block.id, block]));
    let pending: { id: number; content: string } | null = null;
    for (const payload of payloads) {
      for (const [id, content] of JSON.parse(brotliDecompressSync(payload.payload).toString("utf8")) as [number, string][]) {
        if (selectedIds && !selectedIds.has(id)) continue;
        if (pending && pending.id !== id) {
          const block = metadata.get(pending.id);
          if (!block) throw new Error("索引文字 payload 指向未知區塊，請執行 rebuild。");
          yield { ordinal: block.ordinal, heading: block.heading, content: pending.content, location_kind: block.location_kind, location_value: block.location_value };
          pending = null;
        }
        if (pending) pending.content += content;
        else pending = { id, content };
      }
    }
    if (pending) {
      const block = metadata.get(pending.id);
      if (!block) throw new Error("索引文字 payload 指向未知區塊，請執行 rebuild。");
      yield { ordinal: block.ordinal, heading: block.heading, content: pending.content, location_kind: block.location_kind, location_value: block.location_value };
    }
  }

  private writeDocumentPayloads(documentId: number, entries: { id: number; ordinal: number; content: string }[]): void {
    const insert = this.db.prepare("INSERT INTO document_payloads (document_id, ordinal, payload) VALUES (?, ?, ?)");
    const insertBlocks = this.db.prepare("INSERT INTO document_payload_blocks (document_id, payload_ordinal, block_id) VALUES (?, ?, ?)");
    const insertBloom = this.db.prepare("INSERT INTO document_payload_blooms (document_id, payload_ordinal, bloom) VALUES (?, ?, ?)");
    let batch: [number, string][] = []; let bytes = 2; let ordinal = 0;
    const flush = () => {
      if (!batch.length) return;
      insert.run(documentId, ordinal, compressText(JSON.stringify(batch)));
      for (const id of new Set(batch.map(item => item[0]))) insertBlocks.run(documentId, ordinal, id);
      // Text within a payload is intentionally kept per block: joining two
      // adjacent blocks would manufacture a false phrase candidate.
      const byBlock = new Map<number, string>();
      for (const [id, content] of batch) byBlock.set(id, (byBlock.get(id) ?? "") + content);
      insertBloom.run(documentId, ordinal, buildBloom([...byBlock.values()].map((content, index) => ({ ordinal: index, heading: null, content, locationKind: "line" as const, locationValue: "" }))));
      ordinal++; batch = []; bytes = 2;
    };
    for (const entry of [...entries].sort((a, b) => a.ordinal - b.ordinal)) {
      for (const chunk of splitText(entry.content)) {
        const item: [number, string] = [entry.id, chunk]; const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8") + (batch.length ? 1 : 0);
        if (batch.length && bytes + itemBytes > textChunkBytes) flush();
        batch.push(item); bytes += itemBytes;
      }
    }
    flush();
  }

  private migratePayloads(): void {
    if (this.metadata("content_storage_version") === "2") return;
    const rows = this.db.prepare("SELECT id, document_id, ordinal, content FROM blocks ORDER BY document_id, ordinal").all() as { id: number; document_id: number; ordinal: number; content: string }[];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const clear = this.db.prepare("UPDATE blocks SET content = '' WHERE id = ?");
      const legacy = this.db.prepare("SELECT payload FROM block_payloads WHERE block_id = ? ORDER BY ordinal");
      const groups = new Map<number, { id: number; ordinal: number; content: string }[]>();
      for (const row of rows) {
        const old = row.content || Buffer.concat((legacy.all(row.id) as { payload: Uint8Array }[]).map(item => brotliDecompressSync(item.payload))).toString("utf8");
        const group = groups.get(row.document_id) ?? []; group.push({ id: row.id, ordinal: row.ordinal, content: old }); groups.set(row.document_id, group);
      }
      for (const [documentId, entries] of groups) this.writeDocumentPayloads(documentId, entries);
      this.db.exec("DELETE FROM block_payloads");
      for (const row of rows) clear.run(row.id);
      this.db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('content_storage_version', '2')").run();
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private async migratePayloadBlooms(options: UpgradeOptions): Promise<void> {
    if (this.metadata("payload_bloom_version") === "1") return;
    const documents = this.db.prepare(`SELECT d.id, d.path FROM documents d
      WHERE NOT EXISTS (SELECT 1 FROM index_migration_documents m
        WHERE m.version = 'payload_bloom_1' AND m.document_id = d.id)
      ORDER BY d.id`).all() as { id: number; path: string }[];
    const total = Number((this.db.prepare("SELECT count(*) AS count FROM documents").get() as { count: number }).count);
    let completed = total - documents.length;
    options.onProgress?.({ stage: "upgrade", message: "建立 payload 搜尋摘要", current: completed, total });
    const blocksQuery = this.db.prepare("SELECT id, heading FROM blocks WHERE document_id = ? ORDER BY ordinal");
    const payloadsQuery = this.db.prepare("SELECT ordinal, payload FROM document_payloads WHERE document_id = ? ORDER BY ordinal");
    for (const document of documents) {
      throwIfAborted(options.signal);
      options.onProgress?.({ stage: "upgrade", message: "建立 payload 搜尋摘要", current: completed, total, path: document.path });
      const blocks = blocksQuery.all(document.id) as { id: number; heading: string | null }[];
      const metadata = new Map(blocks.map(block => [block.id, block]));
      const payloads = payloadsQuery.all(document.id) as { ordinal: number; payload: Uint8Array }[];
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare("DELETE FROM document_payload_blocks WHERE document_id = ?").run(document.id);
        this.db.prepare("DELETE FROM document_payload_blooms WHERE document_id = ?").run(document.id);
        const insertBlock = this.db.prepare("INSERT INTO document_payload_blocks(document_id, payload_ordinal, block_id) VALUES (?, ?, ?)");
        const insertBloom = this.db.prepare("INSERT INTO document_payload_blooms(document_id, payload_ordinal, bloom) VALUES (?, ?, ?)");
        let payloadIndex = 0;
        for (const payload of payloads) {
          throwIfAborted(options.signal);
          const values = JSON.parse(brotliDecompressSync(payload.payload).toString("utf8")) as [number, string][];
          const content = new Map<number, string>();
          for (const [blockId, fragment] of values) {
            if (!metadata.has(blockId)) throw new Error("索引 payload 指向未知區塊，無法安全升級。");
            content.set(blockId, (content.get(blockId) ?? "") + fragment);
          }
          for (const blockId of content.keys()) insertBlock.run(document.id, payload.ordinal, blockId);
          insertBloom.run(document.id, payload.ordinal, buildBloom([...content].map(([blockId, value], ordinal) => ({
            ordinal, heading: metadata.get(blockId)?.heading ?? null, content: value, locationKind: "line" as const, locationValue: "",
          }))));
          payloadIndex++;
          if (payloadIndex % 16 === 0) {
            options.onProgress?.({ stage: "upgrade", message: `建立 payload 搜尋摘要（payload ${payloadIndex}/${payloads.length}）`,
              current: completed, total, path: document.path });
            await yieldToEvents();
          }
        }
        this.db.prepare("INSERT OR REPLACE INTO index_migration_documents(version, document_id) VALUES ('payload_bloom_1', ?)").run(document.id);
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      completed++;
      options.onProgress?.({ stage: "upgrade", message: "建立 payload 搜尋摘要", current: completed, total, path: document.path });
      await yieldToEvents();
    }
    throwIfAborted(options.signal);
    this.db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('payload_bloom_version', '1')").run();
    options.onProgress?.({ stage: "upgrade", message: "payload 搜尋摘要升級完成", current: total, total });
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare("SELECT status, count(*) AS count FROM documents GROUP BY status").all() as { status: string; count: number }[];
    const counts = Object.fromEntries(documentStatuses.map(status => [status, 0]));
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  documentIssues(): StoredIssue[] {
    return this.db.prepare(`SELECT path, status, error_code AS errorCode, error_message AS errorMessage
      FROM documents WHERE error_code IS NOT NULL ORDER BY path`).all() as unknown as StoredIssue[];
  }

  private metadata(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  recordSync(root: string, complete: boolean, errors: string[], notices: string[], summary?: SyncSummary, diagnostics: Diagnostic[] = []): void {
    this.registerRoot(root);
    const previous = this.getLastSyncReport(root);
    const attemptedAt = new Date().toISOString();
    const rootChanged = this.getRoot() !== root;
    const set = this.db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE roots SET report = ? WHERE path = ?").run(JSON.stringify({
        attemptedAt, successfulAt: complete ? attemptedAt : previous.successfulAt, complete,
        errors, notices, summary: summary ?? null, diagnostics,
      }), root);
      set.run("root", root);
      set.run("last_sync_attempt", attemptedAt);
      set.run("last_sync_complete", complete ? "1" : "0");
      set.run("last_sync_errors", JSON.stringify(errors));
      set.run("last_sync_notices", JSON.stringify(notices));
      set.run("last_sync_summary", JSON.stringify(summary ?? null));
      set.run("last_sync_diagnostics", JSON.stringify(diagnostics));
      if (rootChanged) this.db.prepare("DELETE FROM metadata WHERE key IN ('last_successful_sync', 'last_sync')").run();
      if (complete) set.run("last_successful_sync", attemptedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getLastSyncReport(root?: string): LastSyncReport {
    if (root) {
      const row = this.db.prepare("SELECT report FROM roots WHERE path = ?").get(root) as { report: string | null } | undefined;
      if (row?.report) return JSON.parse(row.report) as LastSyncReport;
      return { attemptedAt: null, successfulAt: null, complete: null, errors: [], notices: [], summary: null, diagnostics: [] };
    }
    const parseList = (key: string): string[] => {
      try {
        const value = JSON.parse(this.metadata(key) ?? "[]");
        return Array.isArray(value) && value.every(item => typeof item === "string") ? value : [];
      } catch {
        return [];
      }
    };
    const complete = this.metadata("last_sync_complete");
    return {
      attemptedAt: this.metadata("last_sync_attempt") ?? this.metadata("last_sync"),
      successfulAt: this.metadata("last_successful_sync") ?? this.metadata("last_sync"),
      complete: complete === null ? null : complete === "1",
      errors: parseList("last_sync_errors"),
      notices: parseList("last_sync_notices"),
      summary: JSON.parse(this.metadata("last_sync_summary") ?? "null") as SyncSummary | null,
      diagnostics: JSON.parse(this.metadata("last_sync_diagnostics") ?? "[]") as Diagnostic[],
    };
  }

  getLastSync(): string | null {
    return this.getLastSyncReport().attemptedAt;
  }
}
