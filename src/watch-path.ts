import path from "node:path";

const IGNORED_SEGMENT = /(?:^|[\\/])(?:\.git|node_modules|\.localdocsearch)(?:[\\/]|$)/i;

export function shouldIgnoreWatchPath(relativeOrAbsolute: string): boolean {
  const normalized = relativeOrAbsolute.replace(/\\/g, "/");
  if (IGNORED_SEGMENT.test(normalized)) return true;
  const base = path.posix.basename(normalized);
  return base.startsWith("~$");
}
