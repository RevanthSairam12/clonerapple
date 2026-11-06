-- SECURITY (L-1): `schema_migrations` was created by the runner without RLS or
-- a revoke, so the publishable key could list every applied migration through
-- PostgREST. The ledger is internal; RLS with no policies plus no grants for
-- the API roles removes it from the public surface. The runner connects as the
-- table owner and is unaffected.
--
-- Role checks keep a local Postgres without the Supabase roles working, and the
-- whole block is a no-op on a database where the table does not exist yet.

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'alter table schema_migrations enable row level security';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on schema_migrations from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on schema_migrations from authenticated';
    end if;
  end if;
end $$;
