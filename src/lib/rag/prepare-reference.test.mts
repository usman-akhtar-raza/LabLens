import assert from "node:assert/strict";
import test from "node:test";
import { prepareReference, referenceMaxBytes } from "./prepare-reference.ts";

const metadata = {
  title: "Blood Smear", url: "https://medlineplus.gov/lab-tests/blood-smear/",
  accessedOn: "2026-11-18", topics: [],
};
const bytes = new TextEncoder().encode("A reference paragraph.");

test("upload preparation defaults optional topics and preserves deterministic CLI identities", () => {
  const first = prepareReference("reference.txt", bytes, metadata);
  assert.deepEqual(first.document.topics, ["CBC reference"]);
  assert.equal(first.document.id, "medlineplus-blood-smear");
  assert.deepEqual(first, prepareReference("reference.txt", bytes, metadata));
});

test("upload preparation rejects invalid input before embeddings or database writes", () => {
  assert.throws(() => prepareReference("file.pdf", bytes, metadata), /\.md or \.txt/);
  assert.throws(() => prepareReference("file.txt", new Uint8Array(referenceMaxBytes + 1), metadata), /128 KiB/);
  assert.throws(() => prepareReference("file.txt", new Uint8Array([0xff]), metadata), /UTF-8/);
  assert.throws(() => prepareReference("file.txt", new Uint8Array(), metadata), /nonempty/);
  assert.throws(() => prepareReference("file.txt", bytes, { ...metadata, url: "https://example.com/" }), /canonical/);
  assert.throws(() => prepareReference("file.txt", bytes, { ...metadata, accessedOn: "2026-02-30" }));
});
