import assert from "node:assert/strict";
import test from "node:test";
import { EMBEDDING_DIMENSIONS, orderEmbeddings } from "./embeddings.ts";

const vector = (value: number) => [value, ...Array<number>(EMBEDDING_DIMENSIONS - 1).fill(0)];

test("out-of-order API embeddings are paired to their original inputs", () => {
  const result = orderEmbeddings([{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }], 2);
  assert.equal(result[0][0], 1);
  assert.equal(result[1][0], 2);
});

test("missing, duplicate and out-of-range indices cannot silently corrupt input pairing", () => {
  for (const rows of [
    [{ index: 0, embedding: vector(1) }],
    [{ index: 0, embedding: vector(1) }, { index: 0, embedding: vector(2) }],
    [{ index: 0, embedding: vector(1) }, { index: 2, embedding: vector(2) }],
  ]) assert.throws(() => orderEmbeddings(rows, 2));
});

test("wrong-sized, non-finite and zero vectors fail before database upload", () => {
  for (const embedding of [[1], vector(0), vector(Number.NaN), vector(Infinity)]) {
    assert.throws(() => orderEmbeddings([{ index: 0, embedding }], 1));
  }
});
