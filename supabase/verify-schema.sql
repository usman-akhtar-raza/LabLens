-- Read-only verification. Every boolean should be true; dimensions should be vector(1536).
select
  'LabLens schema verified' as status,
  (select extversion from pg_extension where extname = 'vector') as pgvector_version,
  (select count(*) = 2 and bool_and(c.relrowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('lablens_sources', 'lablens_chunks')) as rls_enabled,
  not (has_table_privilege('anon', 'public.lablens_sources', 'SELECT')
    or has_table_privilege('anon', 'public.lablens_chunks', 'SELECT')) as anon_access_blocked,
  not (has_table_privilege('authenticated', 'public.lablens_sources', 'SELECT')
    or has_table_privilege('authenticated', 'public.lablens_chunks', 'SELECT')) as authenticated_access_blocked,
  (has_table_privilege('service_role', 'public.lablens_sources', 'SELECT')
    and has_table_privilege('service_role', 'public.lablens_chunks', 'SELECT')) as backend_access_ready,
  (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
    where a.attrelid = 'public.lablens_chunks'::regclass and a.attname = 'embedding') as embedding_type,
  (select not p.prosecdef from pg_proc p
    where p.oid = 'public.match_lablens_chunks(extensions.vector,integer,double precision,text)'::regprocedure) as rpc_security_invoker,
  (not has_function_privilege('anon', 'public.match_lablens_chunks(extensions.vector,integer,double precision,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.match_lablens_chunks(extensions.vector,integer,double precision,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.match_lablens_chunks(extensions.vector,integer,double precision,text)', 'EXECUTE')) as rpc_restricted;
