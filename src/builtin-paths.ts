import { parseFsPath, runtimePathPlatform, type PathPlatform } from "./root-plan.js";

const WINDOWS_VOLUME_SYSTEM_DIRECTORIES: Record<string, true> = {
  "$recycle.bin": true,
  "system volume information": true,
};

/** Windows volume／UNC share root 下的精確系統目錄及其後代。 */
export function isWindowsVolumeSystemPath(
  candidate: string,
  platform: PathPlatform = runtimePathPlatform(),
): boolean {
  if (platform !== "win32") return false;
  try {
    const first = parseFsPath(candidate, platform).parts[0];
    return first !== undefined && WINDOWS_VOLUME_SYSTEM_DIRECTORIES[first.toLowerCase()] === true;
  } catch {
    return false;
  }
}

/** 使用者直接指定系統目錄本身作為 root。 */
export function isWindowsVolumeSystemRoot(
  candidate: string,
  platform: PathPlatform = runtimePathPlatform(),
): boolean {
  if (platform !== "win32") return false;
  try {
    const parsed = parseFsPath(candidate, platform);
    const first = parsed.parts[0];
    return parsed.parts.length === 1 && first !== undefined
      && WINDOWS_VOLUME_SYSTEM_DIRECTORIES[first.toLowerCase()] === true;
  } catch {
    return false;
  }
}
