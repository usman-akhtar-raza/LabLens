import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { manifestSchema } from "../src/lib/rag/schema.ts";
import { chunkDocument, sha256, CHUNKER_VERSION, DEFAULT_CHUNK_OPTIONS } from "../src/lib/rag/chunk.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataRoot = resolve(root, "data/references");
const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(dataRoot, "sources.json"), "utf8")));
const documents = await Promise.all(manifest.sources.map(async (source) => {
  const content = await readFile(resolve(dataRoot, source.contentPath), "utf8");
  return { ...source, content, contentSha256: sha256(content) };
}));
const chunks = documents.flatMap((document) => chunkDocument(document));
if (new Set(chunks.map((chunk) => chunk.id)).size !== chunks.length) throw new Error("Duplicate chunk IDs");
const output = {
  schemaVersion: 1,
  chunker: { version: CHUNKER_VERSION, ...DEFAULT_CHUNK_OPTIONS, offsetUnit: "utf16_code_units", sizeUnit: "whitespace_words" },
  sources: documents.map(({ content: _content, ...metadata }) => metadata),
  chunks,
};
const outputRoot = resolve(root, "data/generated");
await mkdir(outputRoot, { recursive: true });
const destination = resolve(outputRoot, "corpus.json");
await writeFile(`${destination}.tmp`, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await rename(`${destination}.tmp`, destination);
console.log(`Validated ${documents.length} sources; generated ${chunks.length} chunks.`);
for (const source of documents) {
  console.log(`${source.id}: ${chunks.filter((chunk) => chunk.sourceId === source.id).length} chunks`);
}
console.log("Output: data/generated/corpus.json (no API keys or network required)");
