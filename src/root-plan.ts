export class RootError extends Error {}

export type PathPlatform = "posix" | "win32";
export type RootOperationKind = "existing" | "independent" | "merge" | "subtree";

export interface ParsedFsPath {
  platform: PathPlatform;
  original: string;
  drive: string | null;
  uncHost: string | null;
  uncShare: string | null;
  parts: readonly string[];
}

export interface RootRef {
  registered: string;
  actual: string;
}

export interface RootOperationPlan {
  kind: RootOperationKind;
  requested: string;
  actual: string;
  registeredRoot: string;
  mergedRoots: string[];
  subtree: string | null;
}

export function runtimePathPlatform(): PathPlatform {
  return process.platform === "win32" ? "win32" : "posix";
}

export function parseFsPath(value: string, platform: PathPlatform = runtimePathPlatform()): ParsedFsPath {
  if (platform === "win32") {
    const raw = value.replaceAll("/", "\\");
    if (/^[A-Za-z]:(?![\\])/u.test(raw)) {
      throw new RootError(`磁碟代號路徑不完整：${value}；請使用 ${raw.slice(0, 2)}\\ 表示該磁碟根目錄。`);
    }
    if (raw.startsWith("\\\\")) {
      const segs = raw.slice(2).split(/\\+/u).filter(Boolean);
      if (segs.length < 2) throw new RootError(`UNC 路徑不完整：${value}；請包含主機與共用名稱。`);
      return {
        platform, original: value, drive: null,
        uncHost: segs[0]!.toLowerCase(), uncShare: segs[1]!.toLowerCase(),
        parts: segs.slice(2),
      };
    }
    const match = /^([A-Za-z]:)(?:\\(.*))?$/u.exec(raw);
    if (!match) throw new RootError(`路徑不是絕對磁碟或 UNC 路徑：${value}`);
    const rest = (match[2] ?? "").replace(/\\+$/u, "");
    return {
      platform, original: value, drive: match[1]!.toLowerCase(),
      uncHost: null, uncShare: null,
      parts: rest.length ? rest.split(/\\+/u).filter(Boolean) : [],
    };
  }
  if (!value.startsWith("/")) throw new RootError(`路徑不是絕對路徑：${value}`);
  return {
    platform, original: value, drive: null, uncHost: null, uncShare: null,
    parts: value.split("/").filter(Boolean),
  };
}

function volumeKey(parsed: ParsedFsPath): string {
  if (parsed.drive) return `drive:${parsed.drive}`;
  if (parsed.uncHost) return `unc:${parsed.uncHost}\\${parsed.uncShare}`;
  return "posix";
}

function normalizePart(part: string, platform: PathPlatform): string {
  return platform === "win32" ? part.toLowerCase() : part;
}

export function equalPath(left: ParsedFsPath, right: ParsedFsPath): boolean {
  if (left.platform !== right.platform || volumeKey(left) !== volumeKey(right)) return false;
  if (left.parts.length !== right.parts.length) return false;
  return left.parts.every((part, index) => normalizePart(part, left.platform) === normalizePart(right.parts[index]!, left.platform));
}

export function isPathInside(parent: ParsedFsPath, child: ParsedFsPath): boolean {
  if (parent.platform !== child.platform || volumeKey(parent) !== volumeKey(child)) return false;
  if (parent.parts.length > child.parts.length) return false;
  return parent.parts.every((part, index) => normalizePart(part, parent.platform) === normalizePart(child.parts[index]!, parent.platform));
}

export function strictlyCovers(parent: ParsedFsPath, child: ParsedFsPath): boolean {
  return isPathInside(parent, child) && !equalPath(parent, child);
}

export function samePath(left: string, right: string, platform: PathPlatform = runtimePathPlatform()): boolean {
  try { return equalPath(parseFsPath(left, platform), parseFsPath(right, platform)); }
  catch { return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right; }
}

export function coversPath(parent: string, child: string, platform: PathPlatform = runtimePathPlatform()): boolean {
  try { return isPathInside(parseFsPath(parent, platform), parseFsPath(child, platform)); }
  catch { return false; }
}

export function mostSpecificRoot<T extends { actual: string }>(roots: readonly T[], platform: PathPlatform): T {
  return roots.reduce((best, item) => {
    const bestParts = parseFsPath(best.actual, platform).parts.length;
    const itemParts = parseFsPath(item.actual, platform).parts.length;
    return itemParts > bestParts ? item : best;
  });
}

export function planRootOperation(
  requested: { resolved: string; actual: string },
  existing: readonly RootRef[],
  platform: PathPlatform = runtimePathPlatform(),
): RootOperationPlan {
  const requestedParsed = parseFsPath(requested.actual, platform);
  const parsedExisting = existing.flatMap(item => {
    try { return [{ ...item, parsed: parseFsPath(item.actual, platform) }]; }
    catch { return []; }
  });

  const same = parsedExisting.filter(item => equalPath(item.parsed, requestedParsed));
  if (same[0]) {
    return {
      kind: "existing", requested: requested.resolved, actual: requested.actual,
      registeredRoot: same[0].registered, mergedRoots: [], subtree: null,
    };
  }

  const parents = parsedExisting.filter(item => strictlyCovers(item.parsed, requestedParsed));
  if (parents[0]) {
    const parent = mostSpecificRoot(parents, platform);
    return {
      kind: "subtree", requested: requested.resolved, actual: requested.actual,
      registeredRoot: parent.registered, mergedRoots: [], subtree: requested.resolved,
    };
  }

  const children = parsedExisting.filter(item => strictlyCovers(requestedParsed, item.parsed));
  if (children.length) {
    return {
      kind: "merge", requested: requested.resolved, actual: requested.actual,
      registeredRoot: requested.resolved,
      mergedRoots: children.map(item => item.registered).sort(),
      subtree: null,
    };
  }

  return {
    kind: "independent", requested: requested.resolved, actual: requested.actual,
    registeredRoot: requested.resolved, mergedRoots: [], subtree: null,
  };
}
