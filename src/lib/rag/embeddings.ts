import type OpenAI from "openai";
import { z } from "zod";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const embeddingSchema = z.object({
  index: z.number().int().nonnegative(),
  embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS)
    .refine((vector) => vector.some((value) => value !== 0), "Zero embedding is invalid"),
});

export function orderEmbeddings(data: unknown, count: number): number[][] {
  const rows = z.array(embeddingSchema).length(count).parse(data);
  if (new Set(rows.map((row) => row.index)).size !== count || rows.some((row) => row.index >= count)) {
    throw new Error("Embedding response indices do not match inputs");
  }
  return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

export async function embedTexts(client: OpenAI, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (texts.length > 64 || texts.some((text) => !text.trim() || text.length > 12000)) {
    throw new Error("Embedding batch must contain 1–64 nonempty texts, each at most 12000 characters");
  }
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    encoding_format: "float",
    input: texts,
  });
  if (response.model !== EMBEDDING_MODEL) throw new Error("Unexpected embedding model");
  return orderEmbeddings(response.data, texts.length);
}
