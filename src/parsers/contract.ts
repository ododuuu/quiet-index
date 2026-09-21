import type { TextBlock } from "../model.js";

export interface DocumentParser {
  readonly extension: string;
  parse(content: Uint8Array): TextBlock[] | Promise<TextBlock[]>;
}
