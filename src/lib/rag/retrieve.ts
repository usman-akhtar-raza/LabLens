import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { embedTexts, EMBEDDING_MODEL } from "./embeddings.ts";

export const passageSchema = z.object({
  chunk_id: z.string(), source_id: z.string(), source_title: z.string(), source_url: z.url(),
  section: z.string(), content: z.string(), start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().positive(), document_sha256: z.string(), attribution: z.string(),
});

const matchSchema = passageSchema.extend({
  similarity: z.number().finite().min(-1.00001).max(1.00001),
});

export async function retrieveChunks(question: string, clients: { openai: OpenAI; supabase: SupabaseClient }, limit = 5) {
  const text = question.trim();
  if (!text || text.length > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Question must contain 1–1000 characters; limit must be 1–20");
  }
  const [embedding] = await embedTexts(clients.openai, [text]);
  const { data, error } = await clients.supabase.rpc("match_lablens_chunks", {
    query_embedding: embedding, query_model: EMBEDDING_MODEL, match_count: limit, min_similarity: 0,
  });
  if (error) throw new Error(`Vector retrieval failed (${error.code || "unknown"})`);
  return z.array(matchSchema).parse(data);
}
