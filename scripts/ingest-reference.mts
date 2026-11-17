import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { chunkDocument, sha256 } from "../src/lib/rag/chunk.ts";
import { sourceSchema } from "../src/lib/rag/schema.ts";
import { createClients, reportFailure } from "./ai-runtime.mts";
import { ingestDocuments } from "./ingest-documents.mts";

const maxBytes = 128 * 1024;
const canonicalReference = /^https:\/\/medlineplus\.gov\/lab-tests\/([a-z0-9-]+)\/$/;

async function ingestReference() {
  const { positionals: [file, ...extra], values } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: "string" },
      url: { type: "string" },
      "accessed-on": { type: "string" },
      topic: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
    },
  });
  if (!file || extra.length || !values.title?.trim() || !values.url || !values["accessed-on"]) {
    throw new Error('Usage: npm run reference:ingest -- <file.md|file.txt> --title "Source title" --url <canonical MedlinePlus medical-test URL> --accessed-on YYYY-MM-DD [--topic <topic>] [--dry-run]');
  }
  const extension = extname(file).toLowerCase();
  if (extension !== ".md" && extension !== ".txt") throw new Error("Expected a .md or .txt file");
  const slug = canonicalReference.exec(values.url)?.[1];
  if (!slug) throw new Error("Use a canonical MedlinePlus medical-test URL ending in /");
  const metadata = sourceSchema.extend({ contentPath: sourceSchema.shape.title.max(255) }).parse({
    id: `medlineplus-${slug}`,
    title: values.title.trim(),
    sourceUrl: values.url,
    publisher: "MedlinePlus, National Library of Medicine",
    language: "en",
    accessedOn: values["accessed-on"],
    publisherUpdatedOn: null,
    clinicalReviewStatus: "not_clinician_reviewed",
    contentMode: "selected_verbatim_excerpts",
    contentPath: basename(file),
    topics: values.topic ?? ["CBC reference"],
    attribution: "Source: MedlinePlus, National Library of Medicine.",
    reuse: {
      status: "public_domain_us_government",
      policyUrl: "https://medlineplus.gov/about/using/usingcontent/",
      checkedOn: values["accessed-on"],
      scope: "Medical-test text only; no images, encyclopedia, drug monographs, or linked third-party content.",
    },
  });

  const handle = await open(file, "r");
  let content: string;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) throw new Error("Provide a nonempty reference file up to 128 KiB");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read({ buffer, length: buffer.length, position: 0 });
    if (bytesRead !== stat.size) throw new Error("Reference changed while reading. Retry with a stable file.");
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      throw new Error("Reference file must be UTF-8 text");
    }
  } finally {
    await handle.close();
  }
  if (!content.trim() || content.includes("\0")) throw new Error("Reference must contain readable text");
  const document = { ...metadata, contentSha256: sha256(content) };
  const chunks = chunkDocument({ ...document, content }, undefined, extension === ".md" ? "markdown" : "text");
  if (chunks.length > 500 || chunks.some(({ embeddingText }) => embeddingText.length > 12000)) {
    throw new Error("Reference exceeds the ingestion limit. Reduce the file or split unusually long lines or words.");
  }

  if (values["dry-run"]) {
    console.log(`Validated ${document.id}: ${chunks.length} chunks. No API calls or database writes.`);
    return;
  }
  const { count, created } = await ingestDocuments(createClients(), [document], chunks);
  console.log(`PASS: ${document.id}: ${count} indexed chunks, ${created} new embeddings generated.`);
}

ingestReference().catch(reportFailure);
