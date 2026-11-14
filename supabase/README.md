# LabLens vector database

## Applied verification

On November 8, 2026, the initial migration was applied through the signed-in LabLens SQL Editor. Live checks confirmed pgvector 0.8.2, both tables with RLS enabled, blocked anonymous/authenticated access, backend grants, `vector(1536)`, and a restricted security-invoker search function. The configured backend API key successfully accessed both tables and executed a read-only synthetic-vector search. Tables were empty immediately after setup; embeddings ingestion is a separate milestone.

Apply `migrations/202611080001_lablens_vectors.sql` once in the LabLens Supabase SQL Editor as the project database owner. The migration is transactional and intentionally fails if the application tables already exist; it never silently replaces an unknown schema. This SQL Editor application is not recorded automatically in Supabase CLI migration history. Reconcile that history before introducing `supabase db push`.

## Storage

The next ingestion milestone populated 10 sources and 23 chunks using `text-embedding-3-small`. A second unchanged ingestion requested zero new embeddings and retained 23 chunks. Six hand-selected English/Roman Urdu queries retrieved their expected source in the top three. See `data/evaluation/retrieval-smoke.json` and the project README for commands and limits.

- `public.lablens_sources`: source identity, URL, publisher, dates, attribution, local excerpt hash and full metadata JSON.
- `public.lablens_chunks`: exact passage, section, ordinal, local UTF-16 offsets, embedding input and `vector(1536)` embedding.
- A composite foreign key ties every chunk to its exact source-document hash. Future document replacement must remove/replace the old chunks and update source metadata in one transaction.
- The schema accepts only `text-embedding-3-small`. Query and document embeddings must use the same model and 1536 dimensions. Changing providers/models requires an explicit migration and re-embedding the corpus.
- Exact cosine search is sufficient for the initial 23 passages. Add an approximate index only when corpus size and retrieval measurements justify it.

## Access

Row Level Security is enabled on both tables. Public, anonymous and authenticated browser roles receive no table or search-function access. The existing service role receives backend CRUD access and search execution. The search function is security-invoker with an empty search path, validates dimensions/model/limits, rejects zero query vectors and returns source citations alongside results. Cosine similarity is not a medical confidence score.

Keep `SUPABASE_SECRET_KEY` on the server. Do not put it in `NEXT_PUBLIC_` variables. The public application endpoint will need its own request validation and usage limits before deployment.

## Verification

Run `verify-schema.sql` in the SQL Editor to check extension, RLS, grants, vector type and function access. All booleans should be true, and the vector type should be `vector(1536)` (optionally schema-qualified).

From the app directory, after `.env.local` is configured:

```bash
nvm use
npm run db:verify
```

The script checks API authentication, both tables and a read-only search with a synthetic nonzero vector. It does not print keys or write test vectors. Passing this check proves connectivity and schema readiness; it does not evaluate semantic retrieval quality. No reference rows are loaded by the schema migration.
