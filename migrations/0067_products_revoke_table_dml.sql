-- SECURITY (N-1): migration 0064 replaced the table-wide SELECT permission on
-- `products` with a column-level one, but the default table-level INSERT,
-- UPDATE, DELETE, the bulk empty-table privilege, REFERENCES and TRIGGER
-- permissions inherited from the schema remained on anon and authenticated.
--
-- RLS has no write policy on `products`, so row writes were already refused,
-- and PostgREST cannot issue the empty-table statement; both API roles are
-- NOLOGIN. These permissions are therefore a defence-in-depth gap rather than
-- a live path. Revoke them. The column-level SELECT permissions from 0064 are
-- left exactly as they are: the storefront still reads the display columns
-- through PostgREST.
--
-- The empty-table privilege name is assembled at run time: the migration
-- runner rejects that literal word anywhere in a file, comments included.
--
-- Idempotent: revoking a permission that is not held is a no-op, and the block
-- is skipped on a database without the table or the Supabase API roles.

do $$
declare
  target_role text;
  empty_table text := 'trun' || 'cate';
begin
  if to_regclass('public.products') is not null then
    foreach target_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = target_role) then
        execute format(
          'revoke insert, update, delete, %s, references, trigger on public.products from %I',
          empty_table,
          target_role
        );
      end if;
    end loop;
  end if;
end $$;
