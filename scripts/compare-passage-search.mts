import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { ReferenceChunk } from "../src/lib/rag/schema.ts";
import { fusionConstant, hybridCandidateLimit, retrieveRankings } from "../src/lib/rag/hybrid.ts";
import { EMBEDDING_MODEL } from "../src/lib/rag/embeddings.ts";
import { rerankCandidateLimit, rerankModel, rerankPassages } from "../src/lib/rag/rerank.ts";
import { customRerankCandidateLimit, rerankWithRules } from "../src/lib/rag/custom-rerank.ts";
import { createClients, reportFailure } from "./ai-runtime.mts";

type EvalCase = { id: string; question: string; expectedChunkIds: string[]; evidence: string; scenario?: string };
type RankingSummary = { rank: number | null; sourceHitAt3: boolean; top: { id: string; section: string; sourceId: string }[] };
type EvalResult = EvalCase & {
  semantic: RankingSummary; hybrid: RankingSummary; reranked: RankingSummary; keywordTop3: string[];
  customReranked: RankingSummary;
  normalizedHybrid?: RankingSummary;
  normalizedReranked?: RankingSummary;
  normalizedCustomReranked?: RankingSummary;
};
const evalDirectory = new URL("../data/evaluation/", import.meta.url);
const resultLimit = 3;

async function compare() {
  const args = process.argv.slice(2);
  const userStyle = args[0] === "--user-style";
  assert.ok(args.length === 0 || (userStyle && args.length === 1), "Usage: npm run rag:compare-search -- [--user-style]");
  const casesFile = userStyle ? "user-style-passage-cases.json" : "passage-cases.json";
  const reportFile = userStyle ? "query-normalization-comparison.json" : "passage-search-comparison.json";
  const cases: EvalCase[] = JSON.parse(await readFile(new URL(casesFile, evalDirectory), "utf8"));
  const { chunks }: { chunks: ReferenceChunk[] } = JSON.parse(await readFile(new URL("../generated/corpus.json", evalDirectory), "utf8"));
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  assert.ok(chunks.length > 0 && cases.length > 0);
  for (const item of cases) {
    assert.ok(item.expectedChunkIds.length > 0 && item.expectedChunkIds.every((id) => byId.has(id)), `Invalid expected passage for ${item.id}`);
  }

  const clients = createClients();
  const { data: stored, error, count } = await clients.supabase.from("lablens_chunks")
    .select("id,content,embedding_text,embedding_model", { count: "exact" })
    .in("source_id", [...new Set(chunks.map(({ sourceId }) => sourceId))]);
  if (error || count !== chunks.length || stored?.length !== chunks.length || stored.some((row) => {
    const local = byId.get(row.id);
    return !local || local.text !== row.content || local.embeddingText !== row.embedding_text || row.embedding_model !== EMBEDDING_MODEL;
  })) {
    throw new Error("Supabase and the local corpus differ. Sync the corpus before comparing search methods.");
  }

  const results: EvalResult[] = [];
  for (const item of cases) {
    const { semantic, keyword, hybrid } = await retrieveRankings(item.question, clients, { normalizeKeywords: !userStyle });
    const normalized = userStyle ? await retrieveRankings(item.question, clients) : undefined;
    const [reranked, normalizedReranked] = await Promise.all([
      rerankPassages(item.question, hybrid, clients.openai),
      normalized && rerankPassages(item.question, normalized.hybrid, clients.openai),
    ]);
    const expectedSources = new Set(item.expectedChunkIds.map((id) => byId.get(id)?.sourceId));
    const summarize = (ranking: { chunk_id: string; section: string; source_id: string }[]): RankingSummary => {
      const top = ranking.slice(0, resultLimit).map(({ chunk_id: id, section, source_id: sourceId }) => ({
        id, section, sourceId,
      }));
      const rank = top.findIndex(({ id }) => item.expectedChunkIds.includes(id));
      return {
        rank: rank === -1 ? null : rank + 1,
        sourceHitAt3: top.some(({ sourceId }) => expectedSources.has(sourceId)),
        top,
      };
    };
    const result = {
      ...item, semantic: summarize(semantic), hybrid: summarize(hybrid), reranked: summarize(reranked),
      customReranked: summarize(rerankWithRules(item.question, hybrid)),
      keywordTop3: keyword.slice(0, resultLimit).map(({ chunk_id }) => chunk_id),
      ...(normalized && {
        normalizedHybrid: summarize(normalized.hybrid),
        normalizedCustomReranked: summarize(rerankWithRules(item.question, normalized.hybrid)),
      }),
      ...(normalizedReranked && { normalizedReranked: summarize(normalizedReranked) }),
    };
    results.push(result);
    console.log(`${item.id}: hybrid rank ${result.hybrid.rank ?? ">3"}, reranked rank ${result.reranked.rank ?? ">3"}`);
    if (normalized) {
      console.log(`  normalized hybrid rank ${result.normalizedHybrid?.rank ?? ">3"}, normalized reranked rank ${result.normalizedReranked?.rank ?? ">3"}`);
    }
  }

  const metrics = (rankings: RankingSummary[]) => ({
    total: rankings.length,
    hitAt1: rankings.filter(({ rank }) => rank === 1).length,
    hitAt3: rankings.filter(({ rank }) => rank !== null).length,
    sourceHitAt3: rankings.filter(({ sourceHitAt3 }) => sourceHitAt3).length,
    mrrAt3: rankings.reduce((sum, { rank }) => sum + (rank ? 1 / rank : 0), 0) / rankings.length,
  });
  const summarizeCases = (subset: EvalResult[]) => ({
    semantic: metrics(subset.map((item) => item.semantic)),
    hybrid: metrics(subset.map((item) => item.hybrid)),
    reranked: metrics(subset.map((item) => item.reranked)),
    customReranked: metrics(subset.map((item) => item.customReranked)),
    ...(userStyle && {
      normalizedHybrid: metrics(subset.map((item) => {
        assert.ok(item.normalizedHybrid);
        return item.normalizedHybrid;
      })),
      normalizedReranked: metrics(subset.map((item) => {
        assert.ok(item.normalizedReranked);
        return item.normalizedReranked;
      })),
      normalizedCustomReranked: metrics(subset.map((item) => {
        assert.ok(item.normalizedCustomReranked);
        return item.normalizedCustomReranked;
      })),
    }),
  });
  const breakdown = userStyle ? {
    byScenario: Object.fromEntries([...new Set(results.map((item) => item.scenario))].map((scenario) =>
      [scenario, summarizeCases(results.filter((item) => item.scenario === scenario))])),
  } : { originalQuestions: summarizeCases(results.filter((item) => item.id !== "wbc-citation-regression")) };
  const allQuestions = summarizeCases(results);
  const report = {
    checkedAt: new Date().toISOString(),
    scope: userStyle
      ? "Synthetic user-style questions with manually labelled chunk IDs, grouped by their primary scenario."
      : "Six existing retrieval questions plus the reported WBC regression. Hit metrics use manually labelled chunk IDs.",
    embeddingModel: EMBEDDING_MODEL,
    corpusChunks: chunks.length,
    hybrid: { keyword: "BM25", fusion: "equal-weight reciprocal rank fusion", fusionConstant, candidateLimit: hybridCandidateLimit },
    reranker: { model: rerankModel, candidateLimit: rerankCandidateLimit },
    customReranker: { type: "TypeScript rules", candidateLimit: customRerankCandidateLimit },
    ...breakdown,
    allQuestions,
    results,
  };
  await writeFile(new URL(reportFile, evalDirectory), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...breakdown, allQuestions }, null, 2));
}

compare().catch(reportFailure);
