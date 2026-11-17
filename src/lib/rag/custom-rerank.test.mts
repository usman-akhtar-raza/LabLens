import assert from "node:assert/strict";
import test from "node:test";
import { rerankWithRules } from "./custom-rerank.ts";

test("generic count matches do not outrank a new source that names the queried alias", () => {
  const unrelated = {
    source_title: "White Blood Count (WBC)",
    section: "What is a white blood count?",
    content: "White blood count measures white blood cells.",
  };
  const relevant = {
    source_title: "Reticulocyte Count",
    section: "Reference text",
    content: "A reticulocyte count (retic count) measures reticulocytes.",
  };
  assert.equal(rerankWithRules("Retic count kya measure karta hai?", [unrelated, relevant])[0], relevant);
});
