# LabLens

A learning project for explaining CBC terminology in English and Roman Urdu using retrieved medical reference passages and source citations.

## Current milestone: cited answers and connected chat

- Next.js App Router, TypeScript, and Tailwind CSS.
- Official OpenAI JavaScript SDK, Supabase client, and Zod.
- Server-only environment template and a health endpoint.
- Ten attributed MedlinePlus reference documents with validated source metadata.
- Offline, section-based chunk generation with exact local citation offsets and content hashes.
- Supabase connection verifier, SQL migration, and backend-only vector search schema.
- OpenAI `text-embedding-3-small` embeddings at 1536 dimensions, resumable ingestion, and source-cited passage retrieval.
- The configured database contains 10 sources and 23 embedded chunks. Six selected English/Roman Urdu retrieval smoke checks passed; this is not clinical validation.
- Roman Urdu/English structured answers, server-created citations, and a connected chat interface.
- Loading, stop/retry, new-chat controls and expandable original source passages.
- Personal report uploads and clinical diagnosis/treatment are outside this demo.

## Run locally

```bash
cd /Users/mac/Desktop/RAG/lablens
nvm install
nvm use
npm ci
npm run dev
```

Open http://localhost:3000. Skip `npm ci` if dependencies are already installed.

## Environment

Copy `.env.example` to `.env.local` and fill in the values locally. The homepage and health endpoint work without credentials; answering questions requires all three credentials below.

- `OPENAI_API_KEY`: server-side OpenAI API key.
- `OPENAI_ANSWER_MODEL`: optional, defaults to `gpt-4.1-mini`. Use a Responses API model supporting structured outputs and temperature. Changing it requires rerunning answer checks.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SECRET_KEY`: server-side Supabase secret; never expose it to the browser.

Environment files are ignored by Git except for the empty `.env.example` template. Never put secret values in `NEXT_PUBLIC_` variables.

## Checks

```bash
npm run typecheck
npm run test:rag
npm run corpus:build
npm run db:verify
npm run build
```

`GET /api/health` reports whether the app process is running. It does not validate external services or credentials.

`npm run db:verify` validates the configured Supabase Data API key, both reference tables, and the vector-search function without writing any data. It requires `.env.local` and network access. See [supabase/README.md](supabase/README.md) for the migration and access model.

## Reference collection

See [data/references/README.md](data/references/README.md) for source selection, reuse permissions, excerpt limitations, metadata fields, and chunking rules. Run `npm run corpus:build` to generate `data/generated/corpus.json` without network access or credentials.

## Embeddings and retrieval

With `OPENAI_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the app's `.env.local`:

```bash
npm run corpus:ingest
npm run rag:search -- "WBC ka matlab kya hai?"
npm run rag:check
npm run rag:compare-search
```

These commands contact external APIs; embedding generation/search uses the OpenAI API. Ingestion validates the current reference files directly, generates all missing vectors before writing, then upserts source metadata and chunks. Unchanged chunks are reused without new embedding calls. Source and chunk uploads are separate requests: a failed chunk upload can leave source metadata saved, and rerunning unchanged inputs resumes it. Source-hash, chunker or model changes are deliberately rejected until transactional document replacement is implemented; no automatic deletion occurs.

The search command returns retrieved passages, citations and cosine similarity, not a generated medical answer. Similarity is not a clinical confidence score. `rag:check` runs six fixed queries and writes `data/evaluation/retrieval-smoke.json`; expected-source presence in the top three is a smoke test, not a general retrieval or clinical benchmark.

`rag:compare-search` compares semantic, hybrid, and reranked hybrid results on the same seven passage cases. Passage Hit@1 checks the first result against the labelled passage IDs. Source-level Hit@3 checks whether any of the first three passages comes from a source associated with those labels.

## Next milestone

1. Expand evaluation with clinician-reviewed reference answers and citation entailment checks.
2. Add deployment-ready authentication, persistent request quotas and monitoring before a public launch.

Initial scope is educational CBC terminology. Personal report interpretation, diagnosis, and treatment recommendations are outside this first version. Use synthetic examples for demos.

## Chat and answer API

`POST /api/ask` accepts `{ "question": "WBC ka matlab kya hai?", "language": "roman-urdu" }`. Language can also be `english`; questions are limited to 1000 characters. The route runs semantic search and BM25 over the stored title, section, and passage text, then merges up to 20 candidates from each ranking with equal-weight Reciprocal Rank Fusion. A separate model call reranks the first ten passages for direct evidence. If that call fails or times out, chat uses the original hybrid order. The route passes the first five distinct passages to the answer model and constructs citations from the server-side records. Unknown citation IDs or uncited answer paragraphs are replaced by an insufficient-evidence response. Non-answer statuses use controlled messages. Citation provenance and claim support are evaluated separately.

The UI defaults to Roman Urdu and shows plain-text explanations, numbered citation buttons, original English passages and MedlinePlus links. Chat lives only in component memory and resets on reload or New chat. Each question is independent: prior messages are not sent to the model. Ask complete questions rather than context-dependent follow-ups. Generation uses `store: false`; questions still travel to OpenAI for embedding/answer generation and vectors to Supabase for search.

The local demo rejects cross-origin browser requests (with same-port loopback aliases allowed in development), limits request bodies to 8 KB, and has an in-process limit of 12 requests/minute and two simultaneous requests. These limits reset per process and are not distributed production abuse protection. API errors are sanitized and no question text or SDK error objects are logged by application code.

With the development server running on port 3000:

```bash
npm run rag:check-answers
```

This runs five synthetic English/Roman Urdu cases covering cited answers, personal medicine requests, unrelated requests and a missing CBC term. It also checks invalid input and browser origins. Results are in `data/evaluation/answer-smoke.json`. Passing these small smoke checks is not clinical validation.

## Local tooling notes

The dev and build scripts use Webpack with Tailwind's PostCSS integration because this environment blocks Turbopack's helper-process port binding.

The initial dependency audit reports 8 moderate findings in the development linting dependency chain (`minimatch` through TypeScript ESLint). The reported remediation includes a major ESLint-config downgrade; it has not been applied automatically. Review compatible upstream updates before publishing.
