import path from "node:path";
import { isWindowsVolumeSystemPath } from "./builtin-paths.js";
import { runtimePathPlatform, type PathPlatform } from "./root-plan.js";

const IGNORED_SEGMENT = /(?:^|[\\/])(?:\.git|node_modules|\.localdocsearch)(?:[\\/]|$)/i;

export function shouldIgnoreWatchPath(
  relativeOrAbsolute: string,
  root?: string,
  platform: PathPlatform = runtimePathPlatform(),
): boolean {
  const normalized = relativeOrAbsolute.replace(/\\/g, "/");
  if (IGNORED_SEGMENT.test(normalized)) return true;
  const base = path.posix.basename(normalized);
  if (base.startsWith("~$")) return true;
  if (!root) return isWindowsVolumeSystemPath(relativeOrAbsolute, platform);
  const flavor = platform === "win32" ? path.win32 : path.posix;
  return isWindowsVolumeSystemPath(flavor.resolve(root, relativeOrAbsolute), platform);
}
