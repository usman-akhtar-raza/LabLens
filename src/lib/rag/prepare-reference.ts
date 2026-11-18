import { sourceSchema } from "./schema.ts";
import { chunkDocument, sha256 } from "./chunk.ts";

export const referenceMaxBytes = 128 * 1024;
const canonicalReference = /^https:\/\/medlineplus\.gov\/lab-tests\/([a-z0-9-]+)\/$/;

export function prepareReference(file: string, bytes: Uint8Array, values: {
  title: string; url: string; accessedOn: string; topics?: string[];
}) {
  const extension = (file.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (extension !== ".md" && extension !== ".txt") throw new Error("Expected a .md or .txt file");
  const slug = canonicalReference.exec(values.url)?.[1];
  if (!slug) throw new Error("Use a canonical MedlinePlus medical-test URL ending in /");
  const metadata = sourceSchema.extend({ contentPath: sourceSchema.shape.title.max(255) }).parse({
    id: `medlineplus-${slug}`,
    title: values.title.trim(),
    sourceUrl: values.url,
    publisher: "MedlinePlus, National Library of Medicine",
    language: "en",
    accessedOn: values.accessedOn,
    publisherUpdatedOn: null,
    clinicalReviewStatus: "not_clinician_reviewed",
    contentMode: "selected_verbatim_excerpts",
    contentPath: file.split(/[\\/]/).at(-1)!,
    topics: values.topics?.length ? values.topics : ["CBC reference"],
    attribution: "Source: MedlinePlus, National Library of Medicine.",
    reuse: {
      status: "public_domain_us_government",
      policyUrl: "https://medlineplus.gov/about/using/usingcontent/",
      checkedOn: values.accessedOn,
      scope: "Medical-test text only; no images, encyclopedia, drug monographs, or linked third-party content.",
    },
  });

  if (!bytes.length || bytes.length > referenceMaxBytes) throw new Error("Provide a nonempty reference file up to 128 KiB");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Reference file must be UTF-8 text");
  }
  if (!content.trim() || content.includes("\0")) throw new Error("Reference must contain readable text");
  const document = { ...metadata, contentSha256: sha256(content) };
  const chunks = chunkDocument({ ...document, content }, undefined, extension === ".md" ? "markdown" : "text");
  if (chunks.length > 500 || chunks.some(({ embeddingText }) => embeddingText.length > 12000)) {
    throw new Error("Reference exceeds the ingestion limit. Reduce the file or split unusually long lines or words.");
  }

  return { document, chunks };
}
