# LocalDocSearch Product Specification

- Version: Draft 0.1
- Date: 2026-09-03
- Status: ready for user review

## 1. Product statement

LocalDocSearch is a portable, offline Windows command-line tool that indexes one user-selected root directory and searches filenames and extracted content from common work-document formats without administrator privileges or external AI services.

## 2. Target environment

- Windows company computer.
- Node.js 22.17.0 x64 is available.
- The program runs from a user-writable directory without a traditional installer.
- No assumption is made that self-built executables, background services, native add-ons, MCP, or external data transmission are permitted.
- Package installation has been technically demonstrated for `fflate@0.8.3`, `fast-xml-parser@5.11.1`, and `pdfjs-dist@6.3.289`; formal company-policy approval remains the user's responsibility.

## 3. MVP scope

### Included document formats

| Format | Content extracted | Location retained |
|---|---|---|
| `.md` | headings and text | heading/section |
| `.txt` | plain text | line or text range |
| `.docx` | paragraphs and tables | paragraph/section/table |
| `.pptx` | slide text and, where available, speaker notes | slide number |
| `.xlsx` | displayed cell text | worksheet and cell/range |
| `.pdf` | extractable text | page number |

Filename and metadata remain searchable when content extraction fails. Scanned PDFs without a text layer are marked `no_text`; OCR is not part of the MVP.

### Explicitly excluded from the MVP

- Legacy `.doc`, `.ppt`, and `.xls` files.
- OCR, embeddings, vector databases, RAG, MCP, GUI, NTFS MFT, and USN Journal.
- External APIs receiving document content.
- Administrator privileges, Windows services, or policy bypasses.

## 4. User interface

The planned executable commands are:

```text
docsearch index <root>
docsearch search <query> [--limit <number>]
docsearch status
docsearch rebuild
```

During development, the equivalent form is:

```text
node dist/src/cli.js <command>
```

Only one active root directory is supported in the MVP. Running `index <root>` selects that root for later `search`, `status`, and `rebuild` commands.

## 5. Functional requirements

### FR-01 Root selection

- `index <root>` accepts an absolute or relative directory path.
- A nonexistent path returns a clear error and nonzero exit code without a stack trace by default.
- A path that is not a directory is rejected.

### FR-02 Recursive discovery

- The scanner recursively discovers supported files under the active root.
- It skips `.git`, `node_modules`, `.localdocsearch`, Office temporary files beginning with `~$`, and configured exclusions.
- An inaccessible directory or file is reported and skipped without stopping the entire scan.

### FR-03 Unified document model

Each parsed document contains at least:

- stable document identity;
- absolute path and filename;
- extension, size, and last-modified time;
- parsing status and optional error information;
- zero or more sections containing text, optional heading, and source location.

Search and storage code must depend on this model rather than on individual source formats.

### FR-04 Content extraction

- Each format is handled by a dedicated parser behind a common parser contract.
- A parser failure affects only that file.
- Unsupported, encrypted, corrupted, oversized, and textless documents receive distinct statuses where detection is practical.
- Parsing never modifies the source document.

### FR-05 Local index

- Parsed metadata and text are stored locally using SQLite.
- The initial implementation uses Node's built-in `node:sqlite` if it remains compatible with Node.js 22.17.0.
- At minimum, the schema separates documents from searchable sections.
- Index storage defaults to a user-writable location and is excluded from Git.

### FR-06 Incremental indexing

- A repeated index operation compares current metadata with stored metadata.
- New files are inserted, changed files are re-parsed, unchanged files are skipped, and deleted files are removed.
- Replacing one document's metadata and sections is atomic.
- The same update may run repeatedly without producing duplicate records.

### FR-07 Search behavior

- Search covers filename, optional heading, and section content.
- The first implementation uses case-insensitive normalized substring matching rather than semantic search.
- Chinese queries do not require whitespace tokenization.
- Empty or whitespace-only queries are rejected with a clear message.
- `--limit` accepts a positive integer and uses a documented default.

### FR-08 Ranking

Results are ordered using deterministic rules, initially:

1. exact filename match;
2. filename contains query;
3. heading contains query;
4. content contains query;
5. last-modified time as a secondary tie-breaker.

Exact weights remain an implementation detail but must be covered by tests.

### FR-09 Result output

Each result displays:

- full file path;
- document format;
- source location such as heading, slide, worksheet/cell, or page;
- a readable snippet around the match;
- last-modified time;
- enough ranking information for debugging when verbose output is enabled.

No-result, no-supported-file, and empty-index states use different messages.

### FR-10 Status and rebuild

- `status` reports the active root, index location, document counts by status, last successful sync, and errors.
- `rebuild` discards derived index records and recreates them from source files without deleting source documents.
- Destructive index replacement must target only the resolved LocalDocSearch data files.

### FR-11 File changes

- The MVP must support reliable updates through repeated incremental `index` operations.
- A foreground `watch` mode may be added after explicit indexing is stable.
- FileSystemWatcher-style events are treated as hints; a later reconciliation scan remains necessary because events may repeat or be missed.

## 6. Search normalization and snippets

- Normalize query and searchable text with Unicode normalization and case folding appropriate to JavaScript.
- Preserve original text for display.
- Produce snippets from original text, centered near the first or highest-value match.
- Collapse line breaks and excessive whitespace only for result display.
- Do not implement complex Chinese segmentation until measured queries demonstrate a need.

## 7. Proposed architecture

```text
CLI
 ├─ Index command ──> SyncService ──> FileScanner
 │                         │              │
 │                         │              └─ discovered files
 │                         ├─> ParserRegistry ──> format parsers
 │                         └─> IndexStore (SQLite)
 │
 └─ Search command ─> SearchService ──> IndexStore
                              └─ normalization, ranking, snippets
```

Primary modules:

- `cli`: parse commands, validate CLI arguments, format user-facing output.
- `FileScanner`: discover candidate files and isolate filesystem errors.
- `ParserRegistry`: select a parser by file extension.
- `DocumentParser`: common parsing contract.
- Format parsers: Markdown/text, DOCX, PPTX, XLSX, and PDF.
- `SyncService`: compare filesystem state with index state and coordinate updates.
- `IndexStore`: own SQLite schema, transactions, persistence, and raw queries.
- `SearchService`: normalize queries, rank matches, group results, and create snippets.

## 8. Initial data model

### Document

- `id`: internal stable integer key.
- `path`: unique normalized absolute path.
- `filename`: display filename.
- `extension`: normalized lowercase extension.
- `size_bytes`: file size at last indexing.
- `modified_at_ms`: source modification timestamp.
- `indexed_at_ms`: successful processing timestamp.
- `status`: `indexed`, `no_text`, `unsupported`, `too_large`, or `error`.
- `error_code` and `error_message`: nullable diagnostic fields.

### Section

- `id`: internal integer key.
- `document_id`: parent document foreign key.
- `ordinal`: stable order within the document.
- `heading`: optional section title.
- `content`: searchable original text.
- `location_kind`: `section`, `line`, `slide`, `sheet_cell`, or `page`.
- `location_value`: human-readable location data.

## 9. Error and exit-code policy

- Expected user errors display concise Chinese messages without raw stack traces.
- Unexpected internal errors include a stable error code and optional verbose diagnostic output.
- One unreadable document does not make the indexing command fail if other documents can be processed.
- Command exit codes distinguish success, invalid usage, invalid root/configuration, and fatal internal failure.

## 10. Non-functional requirements

### Privacy and security

- No telemetry or network request is required for indexing and searching.
- Logs must not include full document content.
- Test fixtures must not contain company files or copied company text.
- SQLite indexes are treated as sensitive derived copies of source documents.

### Portability

- Target Node.js 22.17.0 x64.
- Avoid native npm add-ons requiring compilation or administrator privileges.
- Support execution from a user-writable portable project directory.

### Performance

Provisional baseline for measurement, not a promise until Windows testing:

- 1,000 mixed test documents after indexing.
- Warm search target: under 2 seconds at the 95th percentile.
- Unchanged incremental scan should avoid content parsing.
- Record initial index time, unchanged scan time, search latency, index size, and process memory.

## 11. Test strategy

- Unit tests cover normalization, extension filtering, parser selection, snippets, ranking, and change detection.
- Parser contract tests run the same expectations against every supported format.
- Integration tests create temporary directories and verify scan-to-index-to-search behavior.
- Fixture tests cover Chinese paths, Chinese queries, empty files, corrupted files, encrypted/unsupported cases where practical, and source deletion.
- Regression tests accompany every fixed defect.
- User acceptance runs separately on the company Windows computer.

## 12. Milestones

### M0 — Foundation

- Project structure, strict TypeScript, tests, SPEC, decision log, status, and handoff process.

### M1 — Vertical slice

- CLI, root validation, Markdown/text scanning, common model, SQLite persistence, substring search, snippets, and automated tests.

### M2 — Office formats

- DOCX, PPTX, and XLSX parsers using ZIP/XML packages already tested in the company environment.

### M3 — PDF

- Text-based PDF parser, page locations, and explicit no-text/encrypted/error behavior.

### M4 — Incremental reliability

- New/changed/deleted detection, transactions, rebuild, exclusions, status, and error reporting.

### M5 — Quality and delivery

- Ranking refinement, performance measurements, Windows acceptance, portable run instructions, README, demo, and application evidence.

MCP and OCR remain later optional work and cannot delay M1–M5.

## 13. Acceptance criteria for the usable MVP

The MVP is accepted when the user can place supported files under one Windows root directory and:

1. index the directory without administrator privileges;
2. search Chinese or English text in filenames and extractable content;
3. see a path, location, snippet, and modification time for each result;
4. receive useful messages for no results, no supported files, invalid roots, unreadable files, and textless PDFs;
5. update the index after files are added, modified, or deleted;
6. run automated tests successfully;
7. review recorded performance measurements;
8. operate the tool without any document content being sent outside the computer.

## 14. Decisions requiring user confirmation

1. **Index location**: default to `%LOCALAPPDATA%\\LocalDocSearch` (recommended) or store beside the portable program.
2. **Search freshness**: make `search` perform a quick incremental sync automatically, or require the user to run `index` first.
3. **Maximum file size**: accept the provisional 100 MB per-file limit or choose another value.

These decisions do not block the M0 project foundation but should be resolved before M1 behavior is finalized.
