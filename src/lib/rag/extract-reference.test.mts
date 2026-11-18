import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prepareFileReference, referenceFileMaxBytes } from "./extract-reference.ts";
import { prepareReference } from "./prepare-reference.ts";

const metadata = {
  title: "Extraction fixture", url: "https://medlineplus.gov/lab-tests/blood-smear/",
  accessedOn: "2026-11-18",
};
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

test("PDF, legacy DOC and DOCX produce the same searchable text and stable retry identities", async () => {
  const identities: string[] = [];
  for (const format of ["pdf", "doc", "docx"]) {
    const bytes = await fixture(`reference.${format}`);
    const first = await prepareFileReference(`reference.${format}`, bytes, metadata);
    assert.equal(first.chunks[0].text, "Synthetic document extraction fixture. White blood cells are the topic.");
    assert.equal(first.document.contentPath, `reference.${format}`);
    assert.match(first.document.contentSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(first, await prepareFileReference(`reference.${format}`, bytes, metadata));
    identities.push(first.chunks[0].id);
  }
  assert.equal(new Set(identities).size, 1);
});

test("binary extraction rejects malformed, empty and oversized inputs", async () => {
  await assert.rejects(prepareFileReference("file.pdf", Buffer.from("fake pdf"), metadata), /do not match/);
  await assert.rejects(prepareFileReference("file.docx", Buffer.from("fake docx"), metadata), /do not match/);
  await assert.rejects(prepareFileReference("file.pdf", Buffer.from("%PDF-1.4 broken"), metadata), /could not be read/);
  await assert.rejects(prepareFileReference("empty.pdf", await fixture("empty.pdf"), metadata), /OCR/);
  await assert.rejects(prepareFileReference("file.pdf", new Uint8Array(referenceFileMaxBytes + 1), metadata), /5 MiB/);
  await assert.rejects(prepareFileReference("file.exe", Buffer.from("unsupported"), metadata), /Expected/);
});

test("existing Markdown and text files retain their chunk IDs", async () => {
  for (const [file, text] of [["sample.txt", "Reference text."], ["sample.md", "# Title\n\n## Definition\n\nReference text."]]) {
    const bytes = new TextEncoder().encode(text);
    assert.deepEqual(await prepareFileReference(file, bytes, metadata), prepareReference(file, bytes, metadata));
  }
});
