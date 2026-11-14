import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chunkDocument, sha256 } from "./chunk.ts";
import { manifestSchema } from "./schema.ts";
import type { SourceDocument } from "./schema.ts";

const dataRoot = new URL("../../../data/references/", import.meta.url);
const manifest = manifestSchema.parse(JSON.parse(await readFile(new URL("sources.json", dataRoot), "utf8")));
const documents: SourceDocument[] = await Promise.all(manifest.sources.map(async (source) => {
  const content = await readFile(new URL(source.contentPath, dataRoot), "utf8");
  return { ...source, content, contentSha256: sha256(content) };
}));

test("real corpus: exact citation spans, section boundaries, and complete word coverage", () => {
  const ids = new Set<string>();
  for (const document of documents) {
    const chunks = chunkDocument(document);
    const headings = [...document.content.matchAll(/^## (.+)$/gm)];
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      assert.ok(!ids.has(chunk.id));
      ids.add(chunk.id);
      assert.equal(chunk.text, document.content.slice(chunk.startOffset, chunk.endOffset));
      assert.equal(chunk.wordCount, chunk.text.split(/\s+/u).length);
      assert.ok(chunk.wordCount <= 160);
      assert.equal(chunk.sourceUrl, document.sourceUrl);
      assert.equal(chunk.documentSha256, document.contentSha256);
      assert.equal(chunk.section, headings[chunk.sectionIndex][1]);
      assert.ok(chunk.endOffset <= (headings[chunk.sectionIndex + 1]?.index ?? document.content.length));
      assert.ok(chunk.startOffset > headings[chunk.sectionIndex].index);
    }
    for (let section = 0; section < headings.length; section++) {
      const start = headings[section].index + headings[section][0].length;
      const end = headings[section + 1]?.index ?? document.content.length;
      for (const word of document.content.slice(start, end).matchAll(/\S+/gu)) {
        const offset = start + word.index;
        assert.ok(chunks.some((chunk) => chunk.startOffset <= offset && chunk.endOffset >= offset + word[0].length), `Lost word in ${document.id}`);
      }
    }
  }
});

function fixture(body: string): SourceDocument {
  const content = `# ${documents[0].title}\n\n${body}\n`;
  return { ...documents[0], content, contentSha256: sha256(content) };
}

test("oversized sentences split with bounded overlap, Unicode offsets, and no missing words", () => {
  const text = Array.from({ length: 67 }, (_, index) => `لفظ🩸${index}`).join(" ");
  const document = fixture(`## Long section\n\n${text}`);
  const chunks = chunkDocument(document, { maxWords: 12, overlapWords: 3 });
  assert.ok(chunks.length > 1);
  assert.deepEqual([...new Set(chunks.flatMap((chunk) => chunk.text.split(/\s+/u)))], text.split(" "));
  for (let index = 1; index < chunks.length; index++) {
    assert.deepEqual(chunks[index - 1].text.split(" ").slice(-3), chunks[index].text.split(" ").slice(0, 3));
  }
  for (const chunk of chunks) assert.equal(document.content.slice(chunk.startOffset, chunk.endOffset), chunk.text);
});

test("stable IDs on rerun and changed IDs when source content changes", () => {
  const original = fixture("## Definition\n\nFirst source passage.");
  assert.deepEqual(chunkDocument(original), chunkDocument(original));
  const changed = fixture("## Definition\n\nUpdated source passage.");
  assert.notEqual(chunkDocument(original)[0].id, chunkDocument(changed)[0].id);
});

test("malformed documents, tampered hashes and invalid sizes fail loudly", () => {
  assert.throws(() => chunkDocument(fixture("Missing heading")), /sections/);
  assert.throws(() => chunkDocument(fixture("## Empty")), /Empty section/);
  assert.throws(() => chunkDocument(fixture("## Definition\n\nValid."), { maxWords: 10, overlapWords: 10 }), /Chunk sizes/);
  assert.throws(() => chunkDocument({ ...documents[0], contentSha256: "wrong" }), /hash mismatch/);
});

test("manifest rejects duplicate sources, traversal paths, and unapproved source types", () => {
  assert.equal(manifestSchema.safeParse({ version: 1, sources: [manifest.sources[0], manifest.sources[0]] }).success, false);
  for (const changes of [{ contentPath: "../secrets.md" }, { sourceUrl: "https://medlineplus.gov/ency/article.htm" }]) {
    assert.equal(manifestSchema.safeParse({ version: 1, sources: [{ ...manifest.sources[0], ...changes }] }).success, false);
  }
});
