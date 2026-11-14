-- LabLens CBC reference storage. Apply once in the project's SQL Editor.
-- All objects are created in one transaction. Existing app tables are untouched.
begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

do $$
begin
  if not exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector' and n.nspname = 'extensions'
  ) then
    raise exception 'pgvector must be installed in the extensions schema';
  end if;
end;
$$;

create table public.lablens_sources (
  id text primary key,
  title text not null check (length(btrim(title)) > 0),
  source_url text not null unique check (source_url ~ '^https://medlineplus[.]gov/lab-tests/[a-z0-9-]+/$'),
  publisher text not null,
  language text not null check (language = 'en'),
  accessed_on date not null,
  publisher_updated_on date,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  attribution text not null,
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, content_sha256)
);

create table public.lablens_chunks (
  id text primary key,
  source_id text not null,
  document_sha256 text not null,
  section text not null check (length(btrim(section)) > 0),
  section_index integer not null check (section_index >= 0),
  chunk_ordinal integer not null check (chunk_ordinal >= 0),
  content text not null check (length(btrim(content)) > 0),
  embedding_text text not null check (length(btrim(embedding_text)) > 0),
  word_count integer not null check (word_count > 0),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  embedding extensions.vector(1536) not null,
  embedding_model text not null check (embedding_model = 'text-embedding-3-small'),
  created_at timestamptz not null default now(),
  foreign key (source_id, document_sha256)
    references public.lablens_sources(id, content_sha256) on delete cascade,
  unique (source_id, document_sha256, chunk_ordinal),
  check ((embedding operator(extensions.<#>) embedding) < 0)
);

-- No browser-side access. Only the existing backend service role can read/write.
alter table public.lablens_sources enable row level security;
alter table public.lablens_chunks enable row level security;
revoke all on public.lablens_sources, public.lablens_chunks from public, anon, authenticated;
grant select, insert, update, delete on public.lablens_sources, public.lablens_chunks to service_role;

-- Exact cosine search is appropriate for the initial 23-chunk corpus.
-- No approximate index is needed at this size.
create function public.match_lablens_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 5,
  min_similarity double precision default 0,
  query_model text default 'text-embedding-3-small'
)
returns table (
  chunk_id text,
  source_id text,
  source_title text,
  source_url text,
  section text,
  content text,
  start_offset integer,
  end_offset integer,
  document_sha256 text,
  attribution text,
  similarity double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if query_embedding is null or extensions.vector_dims(query_embedding) <> 1536 then
    raise exception 'Query embedding must contain 1536 dimensions' using errcode = '22023';
  end if;
  if (query_embedding operator(extensions.<#>) query_embedding) >= 0 then
    raise exception 'Query embedding must be nonzero' using errcode = '22023';
  end if;
  if match_count is null or match_count < 1 or match_count > 20 then
    raise exception 'match_count must be between 1 and 20' using errcode = '22023';
  end if;
  if min_similarity is null or not (min_similarity between -1 and 1) then
    raise exception 'min_similarity must be between -1 and 1' using errcode = '22023';
  end if;
  if query_model is distinct from 'text-embedding-3-small' then
    raise exception 'Query model must match stored embedding model' using errcode = '22023';
  end if;
  return query
    select c.id, c.source_id, s.title, s.source_url, c.section, c.content,
      c.start_offset, c.end_offset, c.document_sha256, s.attribution,
      (1 - (c.embedding operator(extensions.<=>) query_embedding))::double precision
    from public.lablens_chunks c
    join public.lablens_sources s
      on s.id = c.source_id and s.content_sha256 = c.document_sha256
    where c.embedding_model = query_model
      and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
    order by c.embedding operator(extensions.<=>) query_embedding, c.id
    limit match_count;
end;
$$;

revoke all on function public.match_lablens_chunks(extensions.vector, integer, double precision, text)
  from public, anon, authenticated;
grant execute on function public.match_lablens_chunks(extensions.vector, integer, double precision, text)
  to service_role;

comment on table public.lablens_sources is 'Attributed English CBC reference excerpts; not clinician-reviewed.';
comment on table public.lablens_chunks is 'Section-based passages with UTF-16 local Markdown offsets and 1536-dimensional embeddings.';

notify pgrst, 'reload schema';
commit;

-- Read-only confirmation in the SQL Editor's Results panel.
select 'LabLens vector schema ready' as status,
  (select extversion from pg_extension where extname = 'vector') as pgvector_version,
  (select count(*) from public.lablens_sources) as source_count,
  (select count(*) from public.lablens_chunks) as chunk_count;
