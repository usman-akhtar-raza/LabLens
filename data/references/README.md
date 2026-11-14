# CBC reference collection

Source: MedlinePlus, National Library of Medicine.

## Selection and provenance

This is a small English educational corpus, manually curated from 10 MedlinePlus medical-test pages accessed on November 7, 2026. The Markdown files contain **selected verbatim excerpts**, not full-page snapshots or clinician-authored summaries. Links were flattened, list markers standardized, and whitespace normalized. Selected passages may omit intervening paragraphs or sentences; consult the linked source for complete context. Section headings retain the original source wording. No personal reports or patient data are included.

Topics: CBC overview/preparation, RBC, WBC, hemoglobin, hematocrit, platelet count/function distinction, MCV, RDW, differential counts, and reference-range limitations. Universal numerical normal ranges, personalized diagnosis, and treatment are not included.

`sources.json` records stable IDs, canonical URLs, publisher, access date, language, topic labels, excerpt mode, attribution, local content path, reuse policy and verification date. `publisherUpdatedOn` is deliberately null: an article-specific date was not verified. Access dates and dates of cited references must not be treated as publisher review dates. The corpus has **not been reviewed by a clinician**.

Original sources remain English. Future Roman Urdu answers must be evaluated for medical meaning; they are not approved translations of these pages.

## Reuse

MedlinePlus identifies its medical-test information as public domain and requests attribution:

https://medlineplus.gov/about/using/usingcontent/

This permission does not cover all MedlinePlus material. This collection excludes images, drug monographs, encyclopedia content, and text from linked third-party references. There is no claim of NLM endorsement.

## Chunking

Run from the project root:

```bash
npm run corpus:build
npm run test:rag
```

The builder validates the entire manifest and all documents before replacing `data/generated/corpus.json`. It needs no API keys or network access. Edit the Markdown/manifest files, then rebuild; do not edit generated chunks.

- Each chunk belongs to exactly one `##` section of one document.
- Maximum 160 whitespace-delimited words, with up to 24 words of overlap inside long sections. These are word counts, not model token counts.
- Prefers sentence or paragraph endings in the latter half of a long window; falls back to word boundaries for long sentences. Hard splits can separate medical qualifiers, so retrieval/answer evaluation is still required.
- Citation text is an exact substring of the local Markdown. Zero-based, end-exclusive offsets use JavaScript UTF-16 code units and refer to that local file, not the live web page.
- Embedding input includes the document title and section heading for context. Source passage text stays separate.
- IDs are deterministic for the document content, offsets, chunker version and configuration. Changing a document changes its chunk IDs; future ingestion must replace/delete the old document's chunks.
- SHA-256 identifies the **local excerpt file**, not the full upstream page. It detects local changes; it does not prove medical accuracy or ongoing source freshness.

The generated artifact includes source metadata and hashes alongside chunks. It contains no vectors itself. `npm run corpus:ingest` reads the current source files and stores embeddings in Supabase, while `npm run rag:search` retrieves cited passages. The six fixed retrieval smoke queries are recorded under `data/evaluation/`; they do not establish clinical accuracy. Medical answer generation is a later milestone.
