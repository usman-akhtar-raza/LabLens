import type { ReferenceChunk, SourceMetadata } from "../src/lib/rag/schema.ts";
import { embedTexts, EMBEDDING_MODEL } from "../src/lib/rag/embeddings.ts";
import type { createClients } from "./ai-runtime.mts";

type IngestDocument = SourceMetadata & {
  contentSha256: string;
};

export async function ingestDocuments(
  clients: ReturnType<typeof createClients>, documents: IngestDocument[], chunks: ReferenceChunk[],
) {
  if (documents.length > 100 || chunks.length > 500) throw new Error("Corpus exceeds the first-version ingestion limit");

  const byId = new Map(documents.map((document) => [document.id, document]));
  async function verifySources(requireAll: boolean) {
    const { data, error } = await clients.supabase.from("lablens_sources")
      .select("id,content_sha256,title,source_url").in("id", [...byId.keys()]);
    if (error || (requireAll && data.length !== documents.length)) {
      throw new Error(`Source verification failed (${error?.code ?? "count mismatch"})`);
    }
    for (const row of data) {
      const document = byId.get(row.id);
      if (!document || document.contentSha256 !== row.content_sha256 || document.title !== row.title || document.sourceUrl !== row.source_url) {
        throw new Error("A stored source differs from the input. Use a transactional document replacement before re-ingestion.");
      }
    }
  }
  await verifySources(false);
  const { data: existing, error: chunkError } = await clients.supabase.from("lablens_chunks")
    .select("id,embedding_model,document_sha256").in("source_id", documents.map((source) => source.id)).limit(1000);
  if (chunkError) throw new Error(`Chunk preflight failed (${chunkError.code})`);
  const expected = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  for (const row of existing ?? []) {
    if (!expected.has(row.id) || row.embedding_model !== EMBEDDING_MODEL || expected.get(row.id)?.documentSha256 !== row.document_sha256) {
      throw new Error("Stored chunks differ from the current chunker/model. Explicit migration required; no rows changed.");
    }
  }
  const storedIds = new Set((existing ?? []).map((row) => row.id));
  const missing = chunks.filter((chunk) => !storedIds.has(chunk.id));
  console.log(`Validated ${documents.length} sources / ${chunks.length} chunks; ${missing.length} embeddings needed.`);
  const embedded: { chunk: typeof chunks[number]; vector: number[] }[] = [];
  // Generate every missing embedding before the first database write.
  for (let offset = 0; offset < missing.length; offset += 64) {
    const batch = missing.slice(offset, offset + 64);
    const vectors = await embedTexts(clients.openai, batch.map((chunk) => chunk.embeddingText));
    batch.forEach((chunk, index) => embedded.push({ chunk, vector: vectors[index] }));
  }
  const sourceRows = documents.map((source) => ({
    id: source.id, title: source.title, source_url: source.sourceUrl, publisher: source.publisher,
    language: source.language, accessed_on: source.accessedOn, publisher_updated_on: source.publisherUpdatedOn,
    content_sha256: source.contentSha256, attribution: source.attribution, metadata: source,
  }));
  const { error: writeSources } = await clients.supabase.from("lablens_sources").upsert(sourceRows, { onConflict: "id", ignoreDuplicates: true });
  if (writeSources) throw new Error(`Source upload failed (${writeSources.code})`);
  await verifySources(true);
  if (embedded.length) {
    const rows = embedded.map(({ chunk, vector }) => ({
      id: chunk.id, source_id: chunk.sourceId, document_sha256: chunk.documentSha256,
      section: chunk.section, section_index: chunk.sectionIndex, chunk_ordinal: chunk.ordinal,
      content: chunk.text, embedding_text: chunk.embeddingText, word_count: chunk.wordCount,
      start_offset: chunk.startOffset, end_offset: chunk.endOffset,
      embedding: vector, embedding_model: EMBEDDING_MODEL,
    }));
    const { error } = await clients.supabase.from("lablens_chunks").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Chunk upload failed (${error.code}); source metadata may already be saved. Retry is safe for unchanged inputs.`);
  }
  const { count, error: countError } = await clients.supabase.from("lablens_chunks")
    .select("id", { count: "exact", head: true }).in("source_id", documents.map(({ id }) => id));
  if (countError || count !== chunks.length) throw new Error("Uploaded chunk count verification failed");
  return { count, created: embedded.length };
}
