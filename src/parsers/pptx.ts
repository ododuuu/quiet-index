import type { TextBlock } from "../model.js";
import type { DocumentParser } from "./contract.js";
import { OfficeFileError, OfficePackage, attribute, descendants, relationships, relationshipFile, resolvePart, taggedText } from "./office.js";

function paragraphs(xml: Record<string, unknown>[]): string[] {
  return descendants(xml, "p").map(node => taggedText([node], "t").trim()).filter(Boolean);
}

function slideTitle(xml: Record<string, unknown>[]): string | null {
  for (const shape of descendants(xml, "sp")) {
    const placeholder = descendants([shape], "ph")[0];
    if (placeholder && ["title", "ctrTitle"].includes(attribute(placeholder, "type") ?? "")) {
      return paragraphs([shape])[0] ?? null;
    }
  }
  return null;
}

export const pptxParser: DocumentParser = {
  extension: ".pptx",
  parse(data: Uint8Array): TextBlock[] {
    const pkg = new OfficePackage(data);
    const presentation = pkg.xml("ppt/presentation.xml");
    const presentationRels = relationships(pkg, relationshipFile("ppt/presentation.xml"));
    const slideIds = descendants(presentation, "sldId");
    const blocks: TextBlock[] = [];
    slideIds.forEach((slideId, index) => {
      const relation = presentationRels.get(attribute(slideId, "id") ?? "");
      if (!relation) throw new OfficeFileError("OFFICE_MISSING_PART", "簡報缺少投影片關聯");
      const slidePart = resolvePart("ppt/presentation.xml", relation);
      const slide = pkg.xml(slidePart);
      const content = paragraphs(slide).join("\n");
      const heading = slideTitle(slide);
      if (content) blocks.push({ ordinal: blocks.length, heading, content, locationKind: "slide", locationValue: `投影片 ${index + 1}` });

      const slideRels = relationships(pkg, relationshipFile(slidePart));
      const noteTarget = [...slideRels.values()].find(target => target.includes("notesSlide"));
      if (!noteTarget) return;
      const notePart = resolvePart(slidePart, noteTarget);
      const notes = pkg.xml(notePart);
      const bodyShapes = descendants(notes, "sp").filter(shape => {
        const placeholder = descendants([shape], "ph")[0];
        return placeholder && attribute(placeholder, "type") === "body";
      });
      const noteContent = bodyShapes.flatMap(shape => paragraphs([shape])).join("\n");
      if (noteContent) blocks.push({ ordinal: blocks.length, heading: null, content: noteContent,
        locationKind: "slide", locationValue: `投影片 ${index + 1}（講者備註）` });
    });
    return blocks;
  },
};
