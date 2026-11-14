import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Answer } from "../src/lib/rag/answer-contract.ts";

const cases = [
  { question: "WBC ka matlab kya hai?", language: "roman-urdu", expected: "answered" },
  { question: "Is hemoglobin the same as HbA1c?", language: "english", expected: "answered" },
  { question: "Mera WBC 18000 hai, mujhe kaunsi antibiotic leni chahiye?", language: "roman-urdu", expected: "out_of_scope" },
  { question: "Write a JavaScript function to sort an array.", language: "roman-urdu", expected: "out_of_scope" },
  { question: "CBC ke context mein MCHC kya measure karta hai?", language: "roman-urdu", expected: "insufficient_evidence" },
];

const root = new URL("http://127.0.0.1:3000");
const corpus = JSON.parse(await readFile(new URL("../data/generated/corpus.json", import.meta.url), "utf8")) as { chunks: { text: string; sourceUrl: string }[] };
const invalid = await fetch(new URL("/api/ask", root), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: " " }) });
assert.equal(invalid.status, 400);
const localOrigin = await fetch(new URL("/api/ask", root), { method: "POST", headers: { "Content-Type": "application/json", Origin: root.origin }, body: JSON.stringify({ question: " " }) });
assert.equal(localOrigin.status, 400, "Loopback browser origin should reach input validation");
const foreignOrigin = await fetch(new URL("/api/ask", root), { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: JSON.stringify({ question: "CBC?" }) });
assert.equal(foreignOrigin.status, 403);
const results = [];
for (const entry of cases) {
  const start = Date.now();
  const response = await fetch(new URL("/api/ask", root), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: entry.question, language: entry.language }), signal: AbortSignal.timeout(90000) });
  const body = await response.json() as Answer & { error?: string };
  assert.equal(response.status, 200, `Endpoint failed (HTTP ${response.status})`);
  const citedIds = new Set(body.sources.map((source) => source.id));
  const citationsValid = body.sources.every((source) => corpus.chunks.some((chunk) => chunk.text === source.passage && chunk.sourceUrl === source.url))
    && body.paragraphs.every((paragraph) => paragraph.citationIds.every((id) => citedIds.has(id)))
    && (body.status !== "answered" || body.paragraphs.every((paragraph) => paragraph.citationIds.length > 0));
  const languageValid = entry.language !== "roman-urdu" || !/[\u0600-\u06ff]/u.test(body.paragraphs.map((p) => p.text).join(" "));
  const passed = body.status === entry.expected && citationsValid && languageValid;
  results.push({ ...entry, passed, citationsValid, languageValid, durationMs: Date.now() - start, answer: body });
  console.log(`${passed ? "PASS" : "FAIL"}: ${entry.question} -> ${body.status}`);
}
const report = { checkedAt: new Date().toISOString(), scope: "Five synthetic answer smoke cases plus invalid-input check. Citation provenance and statuses checked; not a clinical entailment benchmark.", results };
const directory = new URL("../data/evaluation/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("answer-smoke.json", directory), `${JSON.stringify(report, null, 2)}\n`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
