import { writeFile, mkdir } from "node:fs/promises";
import { retrieveChunks } from "../src/lib/rag/retrieve.ts";
import { createClients, reportFailure } from "./ai-runtime.mts";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "../src/lib/rag/embeddings.ts";

const cases = [
  { question: "What does a white blood cell count measure?", expected: "medlineplus-white-blood-count-wbc" },
  { question: "What does MCV measure?", expected: "medlineplus-mcv-mean-corpuscular-volume" },
  { question: "Is a hemoglobin test the same as an HbA1c test?", expected: "medlineplus-hemoglobin-test" },
  { question: "Platelets khoon mein kya kaam kartay hain?", expected: "medlineplus-platelet-tests" },
  { question: "WBC ka matlab kya hai aur yeh test kya measure karta hai?", expected: "medlineplus-white-blood-count-wbc" },
  { question: "Which reference range should I use to understand my lab result?", expected: "medlineplus-how-to-understand-your-lab-results" },
];

async function check() {
  const clients = createClients();
  const results = [];
  for (const entry of cases) {
    const matches = await retrieveChunks(entry.question, clients, 3);
    const rank = matches.findIndex((match) => match.source_id === entry.expected);
    results.push({ ...entry, expectedSourceRank: rank < 0 ? null : rank + 1,
      passed: rank >= 0, matches: matches.map((match) => ({ sourceId: match.source_id, section: match.section, similarity: match.similarity })) });
    console.log(`${rank >= 0 ? "PASS" : "FAIL"}: expected source in top 3 — ${entry.question}`);
  }
  const report = { checkedAt: new Date().toISOString(), embeddingModel: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS,
    scope: "Six hand-selected retrieval smoke tests. Not a clinical, answer-quality or general retrieval benchmark.",
    passed: results.filter((result) => result.passed).length, total: results.length, results };
  const directory = new URL("../data/evaluation/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("retrieval-smoke.json", directory), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Retrieval smoke checks: ${report.passed}/${report.total}. Report: data/evaluation/retrieval-smoke.json`);
  if (report.passed !== report.total) process.exitCode = 1;
}

check().catch(reportFailure);
