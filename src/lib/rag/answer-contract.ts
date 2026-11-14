import { z } from "zod";

export const askSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  language: z.enum(["roman-urdu", "english"]).default("roman-urdu"),
}).strict();

export const generatedAnswerSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence", "out_of_scope"]),
  paragraphs: z.array(z.object({
    text: z.string(),
    citationIds: z.array(z.number().int()),
  })),
});

export type Language = z.infer<typeof askSchema>["language"];
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;
export type AnswerSource = { id: number; title: string; url: string; section: string; passage: string; attribution: string };
export type Answer = GeneratedAnswer & { sources: AnswerSource[] };

export function insufficientAnswer(language: Language): Answer {
  return { status: "insufficient_evidence", paragraphs: [{
    text: language === "roman-urdu"
      ? "Mere available CBC references mein is sawal ka jawab dene ke liye kaafi evidence nahi mila. CBC ke kisi term ke bare mein mukammal sawal poochhein."
      : "The available CBC references do not provide enough evidence to answer this question. Please ask a complete question about a CBC term.",
    citationIds: [],
  }], sources: [] };
}

/** Only server-provided source records can become citations. This checks IDs, not clinical entailment. */
export function attachCitations(generated: GeneratedAnswer, candidates: AnswerSource[], language: Language): Answer {
  if (generated.status === "insufficient_evidence") return insufficientAnswer(language);
  if (generated.status === "out_of_scope") return {
    status: "out_of_scope",
    paragraphs: [{ text: language === "roman-urdu"
      ? "LabLens CBC ke terms ki general explanation deta hai. Is sawal ka jawab is demo ki scope se bahar hai. Apni report ki values, diagnosis ya dawa ke bare mein qualified clinician se mashwara karein."
      : "LabLens explains general CBC terminology. This request is outside the demo’s scope. Discuss personal test values, diagnosis or medicines with a qualified clinician.", citationIds: [] }],
    sources: [],
  };
  if (!generated.paragraphs.length || generated.paragraphs.length > 5 || generated.paragraphs.some((p) => !p.text.trim() || p.text.length > 1500)) {
    return insufficientAnswer(language);
  }
  const allowed = new Set(candidates.map((source) => source.id));
  const used = new Set<number>();
  for (const paragraph of generated.paragraphs) {
    if (generated.status === "answered" && !paragraph.citationIds.length) return insufficientAnswer(language);
    for (const id of paragraph.citationIds) {
      if (!allowed.has(id)) return insufficientAnswer(language);
      used.add(id);
    }
  }
  return { ...generated, sources: candidates.filter((source) => used.has(source.id)) };
}
