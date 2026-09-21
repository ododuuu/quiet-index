import { Parser } from "htmlparser2";
import PostalMime from "postal-mime";
import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";

const separators = new Set(["p", "div", "br", "hr", "li", "tr", "table", "section", "article", "header", "footer", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "title"]);
const ignored = new Set(["script", "style", "template"]);

export function htmlBlocks(html: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let content = "", heading: string | null = null, headingTag = false, suppressed = 0;
  const flush = () => {
    const text = content.replace(/\s+/g, " ").trim();
    content = "";
    if (!text) return;
    if (headingTag) heading = text;
    blocks.push({ ordinal: blocks.length, heading, content: text, locationKind: "section",
      locationValue: `網頁擷取段落 ${blocks.length + 1}` });
  };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (ignored.has(name)) suppressed++;
      if (suppressed) return;
      if (separators.has(name)) flush();
      if (/^(?:h[1-6]|title)$/.test(name)) headingTag = true;
      if (name === "td" || name === "th") content += " ";
      if (name === "a" && attributes.href && !/^(?:javascript|data):/i.test(attributes.href.trim())) {
        content += ` ${attributes.href} `;
      }
    },
    ontext(text) { if (!suppressed) content += text; },
    onclosetag(name) {
      if (ignored.has(name)) { suppressed--; return; }
      if (suppressed) return;
      if (separators.has(name)) flush();
      if (/^(?:h[1-6]|title)$/.test(name)) headingTag = false;
      if (name === "td" || name === "th") content += " ";
    },
  }, { decodeEntities: true });
  parser.end(html);
  flush();
  return blocks;
}

export function decodeHtml(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data);
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder("utf-8").decode(data);
  let charset = "utf-8";
  const parser = new Parser({ onopentag(name, attrs) {
    if (name !== "meta") return;
    if (attrs.charset) charset = attrs.charset;
    else if (attrs["http-equiv"]?.toLowerCase() === "content-type") {
      charset = attrs.content?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? charset;
    }
  } });
  parser.end(Buffer.from(data.subarray(0, 8192)).toString("latin1"));
  return new TextDecoder(charset).decode(data);
}

export const htmlParser: DocumentParser = { extension: ".html", parse: data => htmlBlocks(decodeHtml(data)) };
export const mhtParser: DocumentParser = {
  extension: ".mht",
  async parse(data) {
    const header = Buffer.from(data.subarray(0, 64 * 1024)).toString("latin1").split(/\r?\n\r?\n/, 1)[0]!;
    if (!/^content-type:\s*(?:multipart\/|text\/(?:html|plain))/im.test(header)) {
      throw Object.assign(new Error("缺少 MHTML MIME 標頭"), { code: "MHT_FORMAT_ERROR" });
    }
    const mail = await PostalMime.parse(data, { maxNestingDepth: 32, maxHeadersSize: 2 * 1024 * 1024 });
    if (mail.html) return htmlBlocks(mail.html);
    return (mail.text ?? "").split(/\r?\n/).flatMap((content, index) => content.trim() ? [{
      ordinal: index, heading: null, content, locationKind: "section" as const, locationValue: `MHTML 文字段落 ${index + 1}`,
    }] : []);
  },
};
