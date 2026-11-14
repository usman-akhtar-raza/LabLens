import { z } from "zod";

export const sourceSchema = z.object({
  id: z.string().regex(/^medlineplus-[a-z0-9-]+$/),
  title: z.string().min(1),
  sourceUrl: z.url().refine((url) => {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "medlineplus.gov" && parsed.pathname.startsWith("/lab-tests/");
  }, "Only approved MedlinePlus medical-test pages are allowed"),
  publisher: z.literal("MedlinePlus, National Library of Medicine"),
  language: z.literal("en"),
  accessedOn: z.iso.date(),
  publisherUpdatedOn: z.iso.date().nullable(),
  clinicalReviewStatus: z.literal("not_clinician_reviewed"),
  contentMode: z.literal("selected_verbatim_excerpts"),
  contentPath: z.string().regex(/^documents\/[a-z0-9-]+\.md$/),
  topics: z.array(z.string().min(1)).min(1),
  attribution: z.literal("Source: MedlinePlus, National Library of Medicine."),
  reuse: z.object({
    status: z.literal("public_domain_us_government"),
    policyUrl: z.literal("https://medlineplus.gov/about/using/usingcontent/"),
    checkedOn: z.iso.date(),
    scope: z.literal("Medical-test text only; no images, encyclopedia, drug monographs, or linked third-party content."),
  }).strict(),
}).strict();

export const manifestSchema = z.object({
  version: z.literal(1),
  sources: z.array(sourceSchema).min(1),
}).strict().superRefine(({ sources }, ctx) => {
  for (const key of ["id", "sourceUrl", "contentPath"] as const) {
    if (new Set(sources.map((source) => source[key])).size !== sources.length) {
      ctx.addIssue({ code: "custom", message: `Duplicate source ${key}` });
    }
  }
});

export type SourceMetadata = z.infer<typeof sourceSchema>;

export type SourceDocument = SourceMetadata & {
  content: string;
  contentSha256: string;
};

export type ReferenceChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  section: string;
  sectionIndex: number;
  ordinal: number;
  text: string;
  embeddingText: string;
  wordCount: number;
  startOffset: number;
  endOffset: number;
  documentSha256: string;
  attribution: string;
};
