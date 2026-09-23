import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readProductVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const relative of ["../../package.json", "../package.json"]) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(here, relative), "utf8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch { /* 編譯後與原始碼的相對位置不同，試下一個。 */ }
  }
  return "0.0.0";
}

export const productVersion = readProductVersion();
