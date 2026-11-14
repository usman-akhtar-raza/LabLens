import assert from "node:assert/strict";
import test from "node:test";
import { askSchema, attachCitations } from "./answer-contract.ts";

const sources = [{ id: 2, title: "WBC", url: "https://medlineplus.gov/lab-tests/white-blood-count-wbc/", section: "Definition", passage: "Reference passage.", attribution: "MedlinePlus" }];
test("only actual retrieved source records become citations", () => {
  const result = attachCitations({ status: "answered", paragraphs: [{ text: "Explanation.", citationIds: [2] }] }, sources, "roman-urdu");
  assert.equal(result.status, "answered");
  assert.deepEqual(result.sources, sources);
});
test("fabricated citation IDs and uncited explanations fall back without showing claims", () => {
  for (const citationIds of [[99], [], [2, 99]]) {
    const result = attachCitations({ status: "answered", paragraphs: [{ text: "Unverified claim.", citationIds }] }, sources, "roman-urdu");
    assert.equal(result.status, "insufficient_evidence");
    assert.equal(result.sources.length, 0);
    assert.ok(!result.paragraphs[0].text.includes("Unverified"));
  }
});
test("scope responses cannot masquerade as evidence-backed answers", () => {
  const result = attachCitations({ status: "out_of_scope", paragraphs: [{ text: "Unverified medical claim.", citationIds: [2] }] }, sources, "roman-urdu");
  assert.equal(result.status, "out_of_scope");
  assert.equal(result.sources.length, 0);
  assert.ok(!result.paragraphs[0].text.includes("Unverified"));
});
test("requests reject unbounded history, empty questions, long questions and invalid languages", () => {
  for (const request of [{ question: " " }, { question: "x".repeat(1001) }, { question: "CBC?", language: "invalid" }, { question: "CBC?", history: [] }]) {
    assert.equal(askSchema.safeParse(request).success, false);
  }
  assert.equal(askSchema.parse({ question: " CBC? " }).language, "roman-urdu");
});
