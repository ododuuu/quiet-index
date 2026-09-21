import { createHash } from "node:crypto";
export function documentReference(id: number, filePath: string): string {
  return `${id}-${createHash("sha256").update(filePath).digest("hex").slice(0, 16)}`;
}
