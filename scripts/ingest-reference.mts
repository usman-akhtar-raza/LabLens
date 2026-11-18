import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { prepareReference, referenceMaxBytes as maxBytes } from "../src/lib/rag/prepare-reference.ts";
import { createClients, reportFailure } from "./ai-runtime.mts";
import { ingestDocuments } from "./ingest-documents.mts";

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
  const handle = await open(file, "r");
  let bytes: Uint8Array;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) throw new Error("Provide a nonempty reference file up to 128 KiB");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read({ buffer, length: buffer.length, position: 0 });
    if (bytesRead !== stat.size) throw new Error("Reference changed while reading. Retry with a stable file.");
    bytes = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const { document, chunks } = prepareReference(file, bytes, {
    title: values.title, url: values.url, accessedOn: values["accessed-on"], topics: values.topic,
  });

  if (values["dry-run"]) {
    console.log(`Validated ${document.id}: ${chunks.length} chunks. No API calls or database writes.`);
    return;
  }
  const { count, created } = await ingestDocuments(createClients(), [document], chunks);
  console.log(`PASS: ${document.id}: ${count} indexed chunks, ${created} new embeddings generated.`);
}

ingestReference().catch(reportFailure);
