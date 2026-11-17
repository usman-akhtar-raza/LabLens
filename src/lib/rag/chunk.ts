import { createHash } from "node:crypto";
import type { ReferenceChunk, SourceDocument } from "./schema.ts";

export const CHUNKER_VERSION = "section-word-window-v1";
export const DEFAULT_CHUNK_OPTIONS = { maxWords: 160, overlapWords: 24 };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type ChunkInput = Pick<SourceDocument, "id" | "title" | "sourceUrl" | "attribution" | "content" | "contentSha256">;
type Section = { title: string; start: number; end: number };

function curatedSections(document: ChunkInput): Section[] {
  const headings = [...document.content.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*\r?$/gm)];
  if (headings[0]?.[1] !== "#" || headings[0][2] !== document.title || headings.length < 2 || headings.slice(1).some((heading) => heading[1] !== "##")) {
    throw new Error(`Expected one matching title and level-two sections: ${document.id}`);
  }
  if (document.content.slice(0, headings[0].index).trim() || document.content.slice(headings[0].index + headings[0][0].length, headings[1].index).trim()) {
    throw new Error(`All reference content must belong to a section: ${document.id}`);
  }
  return headings.slice(1).map((heading, index) => ({
    title: heading[2], start: heading.index + heading[0].length,
    end: headings[index + 2]?.index ?? document.content.length,
  }));
}

function uploadedSections(document: ChunkInput, format: "markdown" | "text"): Section[] {
  const { content, title } = document;
  if (format === "text") return [{ title: "Reference text", start: 0, end: content.length }];

  const sections: Section[] = [];
  let sectionTitle = title;
  let start = 0;
  let fence: string | undefined;
  for (const match of content.matchAll(/^(?:\uFEFF)?[ \t]{0,3}(?:(`{3,}|~{3,})(.*)|(#{1,6})[ \t]+(.*))\r?$/gm)) {
    const [, marker, suffix, , heading] = match;
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && !suffix.trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (content.slice(start, match.index).trim()) sections.push({ title: sectionTitle, start, end: match.index });
    sectionTitle = heading.replace(/[ \t]+#+[ \t]*$/, "").trim() || title;
    start = match.index + match[0].length;
  }
  if (content.slice(start).trim()) sections.push({ title: sectionTitle, start, end: content.length });
  return sections;
}

/** Offsets are zero-based UTF-16 positions in the original file. */
export function chunkDocument(
  document: ChunkInput,
  options = DEFAULT_CHUNK_OPTIONS,
  format: "curated" | "markdown" | "text" = "curated",
): ReferenceChunk[] {
  const { maxWords, overlapWords } = options;
  if (!Number.isInteger(maxWords) || maxWords < 1 || !Number.isInteger(overlapWords) || overlapWords < 0 || overlapWords >= maxWords) {
    throw new Error("Chunk sizes must be integers: maxWords > overlapWords >= 0");
  }
  if (document.contentSha256 !== sha256(document.content)) {
    throw new Error(`Content hash mismatch: ${document.id}`);
  }
  const sections = format === "curated" ? curatedSections(document) : uploadedSections(document, format);
  if (!sections.length) throw new Error(`No reference content: ${document.id}`);
  const chunks: ReferenceChunk[] = [];
  sections.forEach(({ title, start: bodyStart, end: bodyEnd }, sectionIndex) => {
    const body = document.content.slice(bodyStart, bodyEnd);
    const words = [...body.matchAll(/\S+/gu)];
    if (!words.length) throw new Error(`Empty section: ${document.id}: ${title}`);
    let start = 0;
    while (start < words.length) {
      let end = Math.min(start + maxWords, words.length);
      // Prefer a sentence/paragraph boundary in the latter half of the window.
      if (end < words.length) {
        for (let candidate = end; candidate > start + Math.floor(maxWords / 2); candidate--) {
          const last = words[candidate - 1];
          const gap = body.slice(last.index + last[0].length, words[candidate].index);
          if (/[.!?]["')\]]?$/.test(last[0]) || /\r?\n\s*\r?\n/.test(gap)) {
            end = candidate;
            break;
          }
        }
      }
      const startOffset = bodyStart + words[start].index;
      const last = words[end - 1];
      const endOffset = bodyStart + last.index + last[0].length;
      const text = document.content.slice(startOffset, endOffset);
      const identity = JSON.stringify([format === "curated" ? CHUNKER_VERSION : `${CHUNKER_VERSION}-${format}`, document.id, document.contentSha256, maxWords, overlapWords, sectionIndex, startOffset, endOffset]);
      chunks.push({
        id: `${document.id}-${sha256(identity).slice(0, 24)}`,
        sourceId: document.id,
        sourceTitle: document.title,
        sourceUrl: document.sourceUrl,
        section: title,
        sectionIndex,
        ordinal: chunks.length,
        text,
        embeddingText: `${document.title} > ${title}\n\n${text}`,
        wordCount: end - start,
        startOffset,
        endOffset,
        documentSha256: document.contentSha256,
        attribution: document.attribution,
      });
      if (end === words.length) break;
      start = Math.max(start + 1, end - overlapWords);
    }
  });
  return chunks;
}
