import path from "node:path";
import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type XmlNode = Record<string, unknown>;

export class OfficeFileError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const xmlParser = new XMLParser({
  preserveOrder: true,
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  htmlEntities: true,
});

const maximumExpandedBytes = 200 * 1024 * 1024;

export class OfficePackage {
  private readonly files: Record<string, Uint8Array>;

  constructor(data: Uint8Array) {
    if (data.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => data[index] === byte)) {
      throw new OfficeFileError("OFFICE_ENCRYPTED_OR_LEGACY", "檔案是加密或舊版 Office 容器");
    }
    let expanded = 0;
    try {
      this.files = unzipSync(data, { filter: info => {
        if (!info.name.endsWith(".xml") && !info.name.endsWith(".rels")) return false;
        expanded += info.originalSize;
        if (expanded > maximumExpandedBytes) throw new OfficeFileError("OFFICE_TOO_LARGE", "Office 解壓後內容超過大小上限");
        return true;
      } });
    } catch (error) {
      if (error instanceof OfficeFileError) throw error;
      throw new OfficeFileError("OFFICE_CORRUPT", "Office ZIP 檔案無法解壓");
    }
  }

  has(name: string): boolean { return this.files[name] !== undefined; }

  names(): string[] { return Object.keys(this.files); }

  xml(name: string): XmlNode[] {
    const bytes = this.files[name];
    if (!bytes) throw new OfficeFileError("OFFICE_MISSING_PART", `Office 檔案缺少 ${name}`);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (XMLValidator.validate(value) !== true) throw new OfficeFileError("OFFICE_CORRUPT_XML", `Office XML 無法解析：${name}`);
    return xmlParser.parse(value) as XmlNode[];
  }

  optionalXml(name: string): XmlNode[] | null { return this.has(name) ? this.xml(name) : null; }
}

export function tag(node: XmlNode): string | null {
  return Object.keys(node).find(key => key !== ":@" && key !== "#text" && key !== "?xml") ?? null;
}

export function children(node: XmlNode): XmlNode[] {
  const key = tag(node);
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? value as XmlNode[] : [];
}

export function first(nodes: XmlNode[], name: string): XmlNode | undefined {
  return nodes.find(node => tag(node) === name);
}

export function descendants(nodes: XmlNode[], name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const node of nodes) {
    if (tag(node) === name) found.push(node);
    found.push(...descendants(children(node), name));
  }
  return found;
}

export function attribute(node: XmlNode, name: string): string | null {
  const attrs = node[":@"] as Record<string, unknown> | undefined;
  const value = attrs?.[`@_${name}`];
  return value === undefined ? null : String(value);
}

export function text(node: XmlNode): string {
  return children(node).map(child => {
    if (typeof child["#text"] === "string") return child["#text"] as string;
    return text(child);
  }).join("");
}

export function taggedText(nodes: XmlNode[], name: string): string {
  return descendants(nodes, name).map(text).join("");
}

export function relationships(pkg: OfficePackage, file: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const relation of relationshipEntries(pkg, file)) {
    if (!relation.external) result.set(relation.id, relation.target);
  }
  return result;
}

interface RelationshipEntry {
  id: string;
  target: string;
  type: string;
  external: boolean;
}

function relationshipEntries(pkg: OfficePackage, file: string): RelationshipEntry[] {
  const xml = pkg.optionalXml(file);
  if (!xml) return [];
  const result: RelationshipEntry[] = [];
  for (const relation of descendants(xml, "Relationship")) {
    const id = attribute(relation, "Id");
    const target = attribute(relation, "Target");
    if (!id || !target) continue;
    result.push({ id, target, type: attribute(relation, "Type") ?? "",
      external: attribute(relation, "TargetMode")?.toLowerCase() === "external" });
  }
  return result;
}

export function hyperlinkRelationships(pkg: OfficePackage, file: string): Map<string, string> {
  return new Map(relationshipEntries(pkg, file)
    .filter(relation => relation.type.endsWith("/hyperlink"))
    .map(relation => [relation.id, relation.target]));
}

export function searchableLinkTargets(targets: Iterable<string>): string[] {
  const result = new Set<string>();
  for (const target of targets) {
    const trimmed = target.trim();
    if (!trimmed) continue;
    result.add(trimmed);
    try {
      const decoded = decodeURI(trimmed);
      if (decoded !== trimmed) result.add(decoded);
    } catch {
      // 保留無法解碼的原始連結。
    }
  }
  return [...result];
}

export function resolvePart(source: string, target: string): string {
  const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(source), target));
  if (resolved.startsWith("../") || resolved === "..") throw new OfficeFileError("OFFICE_CORRUPT", "Office 檔案包含無效的關聯路徑");
  return resolved;
}

export function relationshipFile(part: string): string {
  return path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
}
