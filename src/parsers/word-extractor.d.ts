declare module "word-extractor" {
  interface Options { filterUnicode?: boolean; includeFooters?: boolean }
  interface WordDocument {
    getBody(options?: Options): string;
    getHeaders(options?: Options): string;
    getFooters(options?: Options): string;
    getFootnotes(options?: Options): string;
    getEndnotes(options?: Options): string;
    getAnnotations(options?: Options): string;
    getTextboxes(options?: Options): string;
  }
  export default class WordExtractor {
    extract(buffer: Buffer): Promise<WordDocument>;
  }
}
