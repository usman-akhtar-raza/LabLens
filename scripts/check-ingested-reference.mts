import assert from "node:assert/strict";
import { retrieveRankings } from "../src/lib/rag/hybrid.ts";
import { rerankWithRules } from "../src/lib/rag/custom-rerank.ts";
import { rerankCandidateLimit, rerankPassages } from "../src/lib/rag/rerank.ts";
import { createClients, reportFailure } from "./ai-runtime.mts";

async function check() {
  const [sourceId, question, mode] = process.argv.slice(2);
  assert.ok(/^medlineplus-[a-z0-9-]+$/.test(sourceId ?? "") && question?.trim() && (!mode || mode === "--before"),
    'Usage: npm run reference:check -- <source-id> "<question>" [--before]');
  const clients = createClients();
  if (mode === "--before") {
    const { count, error } = await clients.supabase.from("lablens_sources")
      .select("id", { count: "exact", head: true }).eq("id", sourceId);
    if (error) throw new Error(`Source baseline check failed (${error.code})`);
    assert.equal(count, 0, "Source already exists in the index");
  }
  const { semantic, keyword, hybrid } = await retrieveRankings(question, clients);
  const rankings = { semantic, BM25: keyword, hybrid };
  if (mode === "--before") {
    for (const [name, passages] of Object.entries(rankings)) {
      assert.ok(passages.every((p) => p.source_id !== sourceId), `${name} already indexes this reference`);
    }
    console.log(`PASS: ${sourceId} absent from all retrieval paths before ingestion.`);
    return;
  }
  const candidates = hybrid.slice(0, rerankCandidateLimit);
  const all = {
    ...rankings,
    custom: rerankWithRules(question, candidates),
    OpenAI: await rerankPassages(question, candidates, clients.openai),
  };
  const ranks = Object.fromEntries(Object.entries(all).map(([name, passages]) =>
    [name, passages.findIndex((p) => p.source_id === sourceId) + 1]));
  console.table(ranks);
  for (const [name, rank] of Object.entries(ranks)) {
    assert.ok(rank >= 1 && rank <= 3, `${name} did not return the new source in its top 3`);
  }
}

check().catch(reportFailure);
