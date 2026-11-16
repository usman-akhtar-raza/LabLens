import { z } from "zod";
import { EMBEDDING_MODEL } from "./embeddings.ts";
import { passageSchema, retrieveChunks } from "./retrieve.ts";

export const hybridCandidateLimit = 20;
export const fusionConstant = 60;

const stopWords = new Set("a an the is are of in on to for and or as do does what which my i use should same ka ki ke kya hai hain yeh mein aur ko se kartay".split(" "));
const keywordAliases: Readonly<Record<string, string>> = {
  rwd: "rdw",
  platlets: "platelets",
  bleading: "bleeding",
  hemaglobin: "hemoglobin",
  hemotacrit: "hematocrit",
  differntial: "differential",
  hct: "hematocrit",
  hgb: "hemoglobin",
};

const keywordRowSchema = passageSchema.omit({ source_title: true, source_url: true, attribution: true }).extend({
  embedding_text: z.string(),
  source: z.object({ title: z.string(), source_url: z.url(), attribution: z.string() }),
}).transform(({ source, embedding_text, ...passage }) => ({
  text: embedding_text,
  passage: { ...passage, source_title: source.title, source_url: source.source_url, attribution: source.attribution },
}));

function tokens(text: string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => !stopWords.has(term));
}

async function retrieveKeywordChunks(question: string, supabase: Parameters<typeof retrieveChunks>[1]["supabase"], normalizeKeywords: boolean) {
  const terms = keywordTerms(question, normalizeKeywords);
  if (!terms.length) return [];

  // Read the current reference corpus without transferring its vectors.
  const pageSize = 100;
  const rows: z.infer<typeof keywordRowSchema>[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("lablens_chunks")
      .select("chunk_id:id,source_id,section,content,start_offset,end_offset,document_sha256,embedding_text,source:lablens_sources!inner(title,source_url,attribution)")
      .eq("embedding_model", EMBEDDING_MODEL)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Keyword retrieval failed (${error.code || "unknown"})`);
    const page = z.array(keywordRowSchema).parse(data);
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  // BM25 over the same title, section, and passage text used for embeddings.
  const documents = rows.map(({ text, passage }) => {
    const terms = tokens(text);
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    return { passage, length: terms.length, frequencies };
  });
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
  if (!averageLength) return [];

  const weightedTerms = terms.map((term) => {
    const frequency = documents.filter((document) => document.frequencies.has(term)).length;
    return { term, idf: Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)) };
  });
  const k1 = 1.2;
  const b = 0.75;
  return documents.map(({ passage, length, frequencies }) => {
    const norm = k1 * (1 - b + b * length / averageLength);
    const score = weightedTerms.reduce((sum, { term, idf }) => {
      const frequency = frequencies.get(term) ?? 0;
      return sum + idf * frequency * (k1 + 1) / (frequency + norm);
    }, 0);
    return { passage, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.passage.chunk_id.localeCompare(b.passage.chunk_id))
    .slice(0, hybridCandidateLimit)
    .map(({ passage }) => passage);
}

export function keywordTerms(text: string, normalize = true) {
  return [...new Set(tokens(text).map((term) =>
    normalize && Object.hasOwn(keywordAliases, term) ? keywordAliases[term] : term,
  ))];
}

type Passage = z.infer<typeof passageSchema>;

export async function retrieveRankings(question: string, clients: Parameters<typeof retrieveChunks>[1], { normalizeKeywords = true } = {}) {
  const [semantic, keyword] = await Promise.all([
    retrieveChunks(question, clients, hybridCandidateLimit),
    retrieveKeywordChunks(question, clients.supabase, normalizeKeywords),
  ]);

  const scores = new Map<string, { passage: Passage; score: number }>();
  for (const ranking of [semantic, keyword]) {
    ranking.forEach((passage, index) => {
      const previous = scores.get(passage.chunk_id);
      scores.set(passage.chunk_id, {
        passage: previous?.passage ?? passage,
        score: (previous?.score ?? 0) + 1 / (fusionConstant + index + 1),
      });
    });
  }
  const hybrid = [...scores.values()]
    .sort((a, b) => b.score - a.score || a.passage.chunk_id.localeCompare(b.passage.chunk_id))
    .map(({ passage }) => passage);
  return { semantic, keyword, hybrid };
}
