import { keywordTerms } from "./hybrid.ts";

export const customRerankCandidateLimit = 10;

const definitionQuestion = /\b(what (?:is|are)|what (?:does|do).+ (?:measure|mean)|mean(?:ing)?|matlab|kya (?:hai|hain|measure)|kis cheez)\b/i;
const resultsQuestion = /\b(high|low|normal|range|zyada|kam|result(?:s)?)\b/i;
const definitionSection = /^(what (?:is|are)\b|overview\b)/i;
const resultsSection = /\b(results?|range)\b/i;
const intentWords = new Set("matlab measure measures mean meaning karta karti karte kaam test tests blood count report result results normal range high low understand".split(" "));
const comparisonQuestion = /\b(vs|versus|same as|compar(?:e|ed|ison)|differ(?:ent|ence)|far[qk]|muqabla)\b/i;
const comparisonEvidence = /\b(not the same as|different from|differs? from|whereas|unlike|while|in contrast)\b/i;
const comparisonFillers = new Set("compare compared comparison vs versus same different difference between from with farq fark muqabla kya batao hota hoti hote dono".split(" "));

function comparisonTerms(text: string) {
  return keywordTerms(text.replace(/\b(?:hemoglobin\s+)?a1c\b/gi, "hba1c"));
}

export function rerankWithRules<T extends { source_title: string; section: string; content: string }>(
  question: string, hybrid: readonly T[],
): T[] {
  const terms = keywordTerms(question).filter((term) => !intentWords.has(term));
  const comparedTerms = comparisonQuestion.test(question)
    ? comparisonTerms(question).filter((term) => !intentWords.has(term) && !comparisonFillers.has(term))
    : [];
  const wantsResults = resultsQuestion.test(question);
  const wantsDefinition = !wantsResults && definitionQuestion.test(question);

  const ranked = hybrid.slice(0, customRerankCandidateLimit).map((passage, index) => {
    const title = new Set(keywordTerms(passage.source_title));
    const section = new Set(keywordTerms(passage.section));
    const content = new Set(keywordTerms(passage.content));
    let score = 0;
    for (const term of terms) {
      if (title.has(term)) score += 3;
      if (section.has(term)) score += 2;
      if (content.has(term)) score += 1;
    }
    // A matching section only helps when the passage also names a query term.
    if (score > 0 && ((wantsDefinition && definitionSection.test(passage.section))
      || (wantsResults && resultsSection.test(passage.section)))) score += 4;
    if (comparedTerms.length >= 2) {
      const evidenceTerms = new Set(comparisonTerms(passage.content));
      if (comparedTerms.every((term) => evidenceTerms.has(term))) {
        score += 4;
        const directlyCompares = passage.content.split(/[.!?\n]+/).some((sentence) => {
          if (!comparisonEvidence.test(sentence)) return false;
          const sentenceTerms = new Set(comparisonTerms(sentence));
          return comparedTerms.every((term) => sentenceTerms.has(term));
        });
        if (directlyCompares) score += 6;
      }
    }
    return { passage, index, score };
  });
  ranked.sort((first, second) => second.score - first.score || first.index - second.index);
  return [...ranked.map(({ passage }) => passage), ...hybrid.slice(customRerankCandidateLimit)];
}
