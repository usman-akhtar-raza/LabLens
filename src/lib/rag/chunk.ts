import { createHash } from "node:crypto";
import type { ReferenceChunk, SourceDocument } from "./schema.ts";

export const CHUNKER_VERSION = "section-word-window-v1";
export const DEFAULT_CHUNK_OPTIONS = { maxWords: 160, overlapWords: 24 };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Offsets are zero-based UTF-16 positions in the original Markdown file. */
export function chunkDocument(
  document: SourceDocument,
  options = DEFAULT_CHUNK_OPTIONS,
): ReferenceChunk[] {
  const { maxWords, overlapWords } = options;
  if (!Number.isInteger(maxWords) || maxWords < 1 || !Number.isInteger(overlapWords) || overlapWords < 0 || overlapWords >= maxWords) {
    throw new Error("Chunk sizes must be integers: maxWords > overlapWords >= 0");
  }
  if (document.contentSha256 !== sha256(document.content)) {
    throw new Error(`Content hash mismatch: ${document.id}`);
  }
  const headings = [...document.content.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*\r?$/gm)];
  if (headings[0]?.[1] !== "#" || headings[0][2] !== document.title || headings.length < 2 || headings.slice(1).some((heading) => heading[1] !== "##")) {
    throw new Error(`Expected one matching title and level-two sections: ${document.id}`);
  }
  if (document.content.slice(0, headings[0].index).trim() || document.content.slice(headings[0].index + headings[0][0].length, headings[1].index).trim()) {
    throw new Error(`All reference content must belong to a section: ${document.id}`);
  }
  const chunks: ReferenceChunk[] = [];
  headings.slice(1).forEach((heading, sectionIndex) => {
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[sectionIndex + 2]?.index ?? document.content.length;
    const body = document.content.slice(bodyStart, bodyEnd);
    const words = [...body.matchAll(/\S+/gu)];
    if (!words.length) throw new Error(`Empty section: ${document.id}: ${heading[2]}`);
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
      const identity = JSON.stringify([CHUNKER_VERSION, document.id, document.contentSha256, maxWords, overlapWords, sectionIndex, startOffset, endOffset]);
      chunks.push({
        id: `${document.id}-${sha256(identity).slice(0, 24)}`,
        sourceId: document.id,
        sourceTitle: document.title,
        sourceUrl: document.sourceUrl,
        section: heading[2],
        sectionIndex,
        ordinal: chunks.length,
        text,
        embeddingText: `${document.title} > ${heading[2]}\n\n${text}`,
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
