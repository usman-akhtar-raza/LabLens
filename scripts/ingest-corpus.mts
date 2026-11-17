import { readFile } from "node:fs/promises";
import { manifestSchema } from "../src/lib/rag/schema.ts";
import { chunkDocument, sha256 } from "../src/lib/rag/chunk.ts";
import { ingestDocuments } from "./ingest-documents.mts";
import { createClients, reportFailure } from "./ai-runtime.mts";

async function ingest() {
  const clients = createClients();
  const base = new URL("../data/references/", import.meta.url);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(new URL("sources.json", base), "utf8")));
  const documents = await Promise.all(manifest.sources.map(async (source) => {
    const content = await readFile(new URL(source.contentPath, base), "utf8");
    const metadata = { ...source, contentSha256: sha256(content) };
    return { metadata, chunks: chunkDocument({ ...metadata, content }) };
  }));
  const chunks = documents.flatMap((document) => document.chunks);
  const { count, created } = await ingestDocuments(clients, documents.map(({ metadata }) => metadata), chunks);
  console.log(`PASS: ${documents.length} sources and ${count} embedded chunks stored; ${created} new embeddings generated.`);
}

ingest().catch(reportFailure);
