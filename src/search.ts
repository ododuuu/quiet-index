import { documentReference } from "./document-reference.js";
import path from "node:path";
import type { DocumentStatus } from "./model.js";
import type { IndexStore, StoredBlockRow, StoredDocumentRow } from "./store.js";

export function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function parseTypes(value: string): string[] {
  const types = value.split(",").map(item => item.trim().replace(/^\./, "").toLowerCase());
  if (types.some(type => !type || type.length > 254 || !/^[^./\\\x00-\x1f]+$/u.test(type))) {
    throw new Error("--type 必須是副檔名清單，以逗號分隔且不可有空項目、路徑分隔符或多餘的句點。");
  }
  return [...new Set(types.map(type => `.${type}`))];
}

// 每個正規化 UTF-16 單位對應原文範圍；以 grapheme 保留組合字元的來源。
function normalizedRanges(content: string): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  let normalized = "";
  for (const { segment, index } of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(content)) {
    const part = segment.normalize("NFKC");
    normalized += part;
    for (let i = 0; i < part.length; i++) { starts.push(index); ends.push(index + segment.length); }
  }
  if (normalized !== content.normalize("NFKC")) {
    // 某些相鄰 grapheme 在 NFKC 後仍會組合；以完整前綴重算該少見情境。
    normalized = "";
    starts.length = 0;
    ends.length = 0;
    let offset = 0;
    for (const character of content) {
      const next = content.slice(0, offset + character.length).normalize("NFKC");
      let common = 0;
      while (common < normalized.length && common < next.length && normalized[common] === next[common]) common++;
      const start = starts[common] ?? offset;
      starts.length = common;
      ends.length = common;
      for (let i = common; i < next.length; i++) { starts.push(start); ends.push(offset + character.length); }
      normalized = next;
      offset += character.length;
    }
  }
  // 大小寫轉換的語境（例如希臘 final sigma）由 normalize() 整串處理。
  // 範圍只依每個 code point 轉小寫後的長度展開，保留 İ 等一對多映射。
  const lowerStarts: number[] = [];
  const lowerEnds: number[] = [];
  let offset = 0;
  for (const character of normalized) {
    for (let i = 0; i < character.toLowerCase().length; i++) {
      lowerStarts.push(starts[offset]!);
      lowerEnds.push(ends[offset + character.length - 1]!);
    }
    offset += character.length;
  }
  return { starts: lowerStarts, ends: lowerEnds };
}

const snippetChunkSize = 32 * 1024;

/**
 * Map just the requested normalized UTF-16 offsets back to the source. Chunks
 * are only an optimisation: an unexpected context-sensitive normalization
 * change returns null so callers can retain the known-correct full mapping.
 */
function chunkedOffsets(content: string, normalized: string, start: number, end: number):
  { startOffset: number; endOffset: number } | null {
  let normalizedOffset = 0;
  let startOffset: number | undefined;
  let endOffset: number | undefined;
  let chunkStart = 0;
  let chunkEnd = 0;
  const mapChunk = (sourceStart: number, sourceEnd: number): boolean => {
    const source = content.slice(sourceStart, sourceEnd);
    const chunkNormalized = normalize(source);
    if (normalized.slice(normalizedOffset, normalizedOffset + chunkNormalized.length) !== chunkNormalized) return false;
    const chunkNormalizedEnd = normalizedOffset + chunkNormalized.length;
    if ((start >= normalizedOffset && start < chunkNormalizedEnd) || (end >= normalizedOffset && end < chunkNormalizedEnd)) {
      // Most CJK, Latin and identifier text maps one source code point at a
      // time. Verify that property before using it; combining sequences and
      // context-sensitive case changes deliberately fall back below.
      let sourceOffset = 0;
      let localNormalizedOffset = 0;
      let direct = true;
      while (sourceOffset < source.length) {
        const pointEnd = codePointEnd(source, sourceOffset);
        const pointNormalized = normalize(source.slice(sourceOffset, pointEnd));
        if (chunkNormalized.slice(localNormalizedOffset, localNormalizedOffset + pointNormalized.length) !== pointNormalized) {
          direct = false; break;
        }
        const normalizedPointEnd = localNormalizedOffset + pointNormalized.length;
        if (start >= normalizedOffset + localNormalizedOffset && start < normalizedOffset + normalizedPointEnd) startOffset = sourceStart + sourceOffset;
        if (end >= normalizedOffset + localNormalizedOffset && end < normalizedOffset + normalizedPointEnd) endOffset = sourceStart + pointEnd;
        sourceOffset = pointEnd;
        localNormalizedOffset = normalizedPointEnd;
      }
      if (!direct || localNormalizedOffset !== chunkNormalized.length) {
        const ranges = normalizedRanges(source);
        if (ranges.starts.length !== chunkNormalized.length) return false;
        if (start >= normalizedOffset && start < chunkNormalizedEnd) startOffset = sourceStart + ranges.starts[start - normalizedOffset]!;
        if (end >= normalizedOffset && end < chunkNormalizedEnd) endOffset = sourceStart + ranges.ends[end - normalizedOffset]!;
      }
    }
    normalizedOffset = chunkNormalizedEnd;
    return true;
  };
  // Intl.Segmenter over a multi-megabyte source can itself retain a large
  // segmentation structure. Split only at code point boundaries here; a
  // normalization that crosses a boundary is detected by mapChunk and falls
  // back to normalizedRanges(), whose Segmenter input is bounded to one chunk.
  while (chunkStart < content.length) {
    chunkEnd = Math.min(content.length, chunkStart + snippetChunkSize);
    if (chunkEnd < content.length && chunkEnd > chunkStart) {
      const preceding = codePointBefore(content, chunkEnd);
      if (preceding < chunkEnd) chunkEnd = preceding;
      while (chunkEnd < content.length && chunkEnd - chunkStart < snippetChunkSize) chunkEnd = codePointEnd(content, chunkEnd);
    }
    if (!mapChunk(chunkStart, chunkEnd)) return null;
    chunkStart = chunkEnd;
  }
  if (normalizedOffset !== normalized.length || startOffset === undefined || endOffset === undefined) return null;
  return { startOffset, endOffset };
}

type CollectedText = { characters: string[]; hasMore: boolean };

function codePointBefore(value: string, offset: number): number {
  let start = offset - 1;
  if (start > 0 && value.charCodeAt(start) >= 0xdc00 && value.charCodeAt(start) <= 0xdfff
    && value.charCodeAt(start - 1) >= 0xd800 && value.charCodeAt(start - 1) <= 0xdbff) start--;
  return start;
}

function codePointEnd(value: string, offset: number): number {
  return offset + String.fromCodePoint(value.codePointAt(offset)!).length;
}

function collectForward(value: string, start: number, end: number, limit: number): CollectedText {
  const characters: string[] = [];
  let offset = start;
  let previousWhitespace = false;
  while (offset < end) {
    const point = String.fromCodePoint(value.codePointAt(offset)!);
    offset += point.length;
    const whitespace = /\s/u.test(point);
    if (whitespace && previousWhitespace) continue;
    previousWhitespace = whitespace;
    if (characters.length === limit) return { characters, hasMore: true };
    characters.push(whitespace ? " " : point);
  }
  return { characters, hasMore: false };
}

function collectBackward(value: string, start: number, end: number, limit: number): CollectedText {
  const reverse: string[] = [];
  let offset = end;
  let previousWhitespace = false;
  let hasMore = false;
  while (offset > start) {
    const pointStart = codePointBefore(value, offset);
    const point = value.slice(pointStart, offset);
    offset = pointStart;
    const whitespace = /\s/u.test(point);
    if (whitespace && previousWhitespace) continue;
    previousWhitespace = whitespace;
    if (reverse.length === limit) hasMore = true;
    else reverse.push(whitespace ? " " : point);
  }
  return { characters: reverse.reverse(), hasMore };
}

export function makeSnippet(content: string, query: string): { text: string; truncated: boolean } {
  const normalized = normalize(content);
  const position = normalized.indexOf(query);
  if (position < 0) throw new Error("命中片段的來源沒有查詢文字。");
  const endPosition = position + query.length - 1;
  const mapped = chunkedOffsets(content, normalized, position, endPosition);
  const ranges = mapped ? null : normalizedRanges(content);
  const startOffset = mapped?.startOffset ?? ranges!.starts[position]!;
  const endOffset = mapped?.endOffset ?? ranges!.ends[endPosition]!;
  const matched = collectForward(content, startOffset, endOffset, 161);
  if (matched.characters.length >= 159 && matched.characters.length <= 160 && !matched.hasMore) {
    const after = collectForward(content, endOffset, content.length, 1);
    return { text: matched.characters.join("") + (matched.characters.length === 159 && after.characters.length > 0 ? "…" : ""), truncated: false };
  }
  const truncated = matched.characters.length > 160 || matched.hasMore;
  const before = truncated ? { characters: [], hasMore: false } : collectBackward(content, 0, startOffset, 45);
  const leftCount = Math.min(45, before.characters.length, Math.max(0, 158 - matched.characters.length));
  const rightCount = Math.max(0, 158 - leftCount - matched.characters.length);
  const after = collectForward(content, endOffset, content.length, rightCount);
  const text = `${before.hasMore || before.characters.length > leftCount ? "…" : ""}${before.characters.slice(before.characters.length - leftCount).join("")}${matched.characters.slice(0, 158).join("")}${after.characters.join("")}${after.hasMore || matched.characters.length > 158 || matched.hasMore ? "…" : ""}`.trim();
  return { text, truncated };
}

export interface SearchResult {
  reference: string;
  path: string;
  extension: string;
  modifiedAtMs: number;
  heading: string | null;
  location: string | null;
  snippet: string;
  rank: number;
  reason: string;
  filenameOnly: boolean;
  status: DocumentStatus;
  snippetTruncated: boolean;
  condition?: string;
}

export type SearchMode = "phrase" | "all-terms";

interface RankedSearchResult {
  result: SearchResult;
  documentId: number;
  ordinal: number | null;
  sourceKind: "filename" | "heading" | "content";
}

export interface SearchResultPage {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  start: number;
  end: number;
  results: SearchResult[];
}

export interface SearchResultSet {
  readonly total: number;
  readonly dataVersion: number;
  page(page: number, pageSize: number): SearchResultPage;
}

function queryTerms(rawQuery: string, mode: SearchMode): { query: string; terms: string[] } {
  const query = normalize(rawQuery.trim());
  if (!query) throw new Error("搜尋文字不可為空白。");
  const terms = mode === "all-terms"
    ? [...new Set(rawQuery.trim().split(/\s+/u).map(normalize).filter(Boolean))]
    : [query];
  return { query, terms };
}

function includesAll(value: string, terms: readonly string[]): boolean {
  return terms.every(term => value.includes(term));
}

function snippetTerm(source: string, terms: readonly string[]): string {
  const normalized = normalize(source);
  return terms.map(term => ({ term, position: normalized.indexOf(term) })).filter(hit => hit.position >= 0)
    .sort((a, b) => a.position - b.position)[0]!.term;
}

type SelectedBlock = { block: StoredBlockRow; source: string; coverage: number; headingHit: boolean };

function rankDocument(document: StoredDocumentRow, blocks: Iterable<StoredBlockRow>, query: string, terms: readonly string[],
  mode: SearchMode): RankedSearchResult | undefined {
  const filename = normalize(document.filename);
  const filenameRank = filename === query ? 4 : includesAll(filename, terms) ? 3 : 0;
  let headingBlock: StoredBlockRow | undefined;
  let contentBlock: StoredBlockRow | undefined;
  let representative: SelectedBlock | undefined;
  const unmatched = new Set(terms.filter(term => !filename.includes(term)));
  if (!filenameRank) {
    for (const block of blocks) {
      const heading = normalize(block.heading ?? "");
      const content = normalize(block.content);
      if (mode === "all-terms") {
        for (const term of unmatched) if (heading.includes(term) || content.includes(term)) unmatched.delete(term);
      }
      if (block.heading && includesAll(heading, terms) && !headingBlock) headingBlock = block;
      if (includesAll(content, terms) && !contentBlock) contentBlock = block;
      if (mode === "all-terms") {
        const source = block.heading && terms.some(term => heading.includes(term)) ? block.heading : block.content;
        const normalizedSource = source === block.heading ? heading : content;
        const candidate: SelectedBlock = { block, source, coverage: terms.filter(term => normalizedSource.includes(term)).length,
          headingHit: source === block.heading };
        if (candidate.coverage > 0 && (!representative || candidate.coverage > representative.coverage
          || (candidate.coverage === representative.coverage && (Number(candidate.headingHit) > Number(representative.headingHit)
            || (candidate.headingHit === representative.headingHit && candidate.block.ordinal < representative.block.ordinal))))) {
          representative = candidate;
        }
      }
    }
  }
  if (mode === "all-terms" && !filenameRank && unmatched.size > 0) return undefined;
  const block = filenameRank ? undefined : headingBlock ?? contentBlock ?? representative?.block;
  const rank = filenameRank || (headingBlock ? 2 : contentBlock ? 1 : 0);
  const effectiveRank = rank || (mode === "all-terms" && representative ? 1 : 0);
  if (!effectiveRank) return undefined;
  const sourceKind = filenameRank ? "filename" : headingBlock ? "heading" : contentBlock ? "content"
    : representative?.headingHit ? "heading" : "content";
  return { result: { reference: documentReference(document.id, document.path), path: document.path, extension: document.extension,
    modifiedAtMs: document.modified_at_ms, heading: block?.heading ?? null,
    location: block?.location_value ?? null, snippet: "", rank: effectiveRank,
    reason: mode === "all-terms" ? ["", "內容（全部關鍵字）", "標題（全部關鍵字）", "檔名包含（全部關鍵字）", "檔名完全符合"][effectiveRank]!
      : ["", "內容", "標題", "檔名包含", "檔名完全符合"][effectiveRank]!,
    filenameOnly: !block, status: document.status, snippetTruncated: false },
    documentId: document.id, ordinal: block?.ordinal ?? null, sourceKind };
}

export function collectHits(store: IndexStore, rawQuery: string, types?: readonly string[], root?: string,
  mode: SearchMode = "phrase", restrictIds?: readonly number[]): RankedSearchResult[] {
  const { query, terms } = queryTerms(rawQuery, mode);
  const results: RankedSearchResult[] = [];
  const source = restrictIds
    ? store.streamCandidatesByIds(restrictIds, terms, mode === "all-terms")
    : store.streamCandidates(types, root, terms, mode === "all-terms");
  for (const { document, blocks } of source) {
    const ranked = rankDocument(document, blocks, query, terms, mode);
    if (ranked) results.push(ranked);
  }
  if (!restrictIds) {
    results.sort((a, b) => b.result.rank - a.result.rank || b.result.modifiedAtMs - a.result.modifiedAtMs
      || (a.result.path < b.result.path ? -1 : a.result.path > b.result.path ? 1 : 0));
  }
  return results;
}

function materializeHits(store: IndexStore, ranked: readonly RankedSearchResult[], rawQuery: string, mode: SearchMode,
  page: number, pageSize: number, condition?: string): SearchResultPage {
  const { terms } = queryTerms(rawQuery, mode);
  if (!Number.isSafeInteger(page) || page <= 0) throw new Error("--page 必須是正整數。");
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("每頁筆數必須是正整數。");
  const pageCount = Math.max(1, Math.ceil(ranked.length / pageSize));
  if (ranked.length > 0 && page > pageCount) throw new Error(`頁碼超出範圍；共有 ${pageCount} 頁。`);
  const offset = (page - 1) * pageSize;
  const selected = ranked.slice(offset, offset + pageSize).map(({ result, documentId, ordinal, sourceKind }) => {
    const source = sourceKind === "filename" ? path.basename(result.path)
      : ordinal === null ? path.basename(result.path) : store.blockSource(documentId, ordinal, sourceKind) ?? path.basename(result.path);
    const snippetQuery = snippetTerm(source, terms);
    const snippet = makeSnippet(source, snippetQuery);
    return condition === undefined
      ? { ...result, snippet: snippet.text, snippetTruncated: snippet.truncated }
      : { ...result, snippet: snippet.text, snippetTruncated: snippet.truncated, condition };
  });
  return { page, pageSize, total: ranked.length, pageCount,
    start: selected.length ? offset + 1 : 0, end: offset + selected.length, results: selected };
}

export function createSearchResultSet(store: IndexStore, rawQuery: string, types?: readonly string[], root?: string,
  mode: SearchMode = "phrase"): SearchResultSet {
  const results = collectHits(store, rawQuery, types, root, mode);
  const dataVersion = store.dataVersion();
  return {
    total: results.length,
    dataVersion,
    page(page, pageSize) { return materializeHits(store, results, rawQuery, mode, page, pageSize); },
  };
}

export { materializeHits };
export type { RankedSearchResult };

export function search(store: IndexStore, rawQuery: string, limit = 20, types?: readonly string[], root?: string,
  mode: SearchMode = "phrase"): SearchResult[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("--limit 必須是正整數。");
  return createSearchResultSet(store, rawQuery, types, root, mode).page(1, limit).results;
}

export interface PassageHit {
  reason: string;
  heading: string | null;
  location: string | null;
  snippet: string;
  snippetTruncated: boolean;
}

/** Collect up to `limit` matching text blocks for one document path (title hits before content). */
export function matchingPassages(store: IndexStore, rawQuery: string, filePath: string, limit = 3,
  mode: SearchMode = "phrase"): PassageHit[] {
  const { terms } = queryTerms(rawQuery, mode);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("--passages 必須是正整數。");
  const candidate = store.candidateByPath(filePath);
  if (!candidate) return [];
  if (mode === "all-terms") {
    const searchable = [normalize(candidate.document.filename), ...candidate.blocks.flatMap(block =>
      [normalize(block.heading ?? ""), normalize(block.content)])];
    if (!terms.every(term => searchable.some(value => value.includes(term)))) return [];
  }
  type Ranked = { rank: number; ordinal: number; heading: string | null; location: string | null; source: string; reason: string; matched: string[] };
  const ranked: Ranked[] = [];
  for (const block of candidate.blocks) {
    const headingTerms = block.heading ? terms.filter(term => normalize(block.heading!).includes(term)) : [];
    const contentTerms = terms.filter(term => normalize(block.content).includes(term));
    if (headingTerms.length) {
      ranked.push({ rank: 2, ordinal: block.ordinal, heading: block.heading, location: block.location_value, source: block.heading!,
        reason: mode === "all-terms" ? `標題（多詞命中 ${headingTerms.length}/${terms.length}）` : "標題", matched: headingTerms });
    } else if (contentTerms.length) {
      ranked.push({ rank: 1, ordinal: block.ordinal, heading: block.heading, location: block.location_value, source: block.content,
        reason: mode === "all-terms" ? `內容（多詞命中 ${contentTerms.length}/${terms.length}）` : "內容", matched: contentTerms });
    }
  }
  const selected: Ranked[] = [];
  const remaining = [...ranked];
  const covered = new Set<string>();
  while (selected.length < limit && remaining.length) {
    remaining.sort((a, b) => b.matched.filter(term => !covered.has(term)).length - a.matched.filter(term => !covered.has(term)).length
      || b.matched.length - a.matched.length || b.rank - a.rank || a.ordinal - b.ordinal);
    const item = remaining.shift()!;
    selected.push(item);
    for (const term of item.matched) covered.add(term);
  }
  return selected.map(item => {
    const snippet = makeSnippet(item.source, snippetTerm(item.source, item.matched));
    return { reason: item.reason, heading: item.heading, location: item.location, snippet: snippet.text, snippetTruncated: snippet.truncated };
  });
}
