-- SECURITY (SEC-005): segregate confidential store expense receipts from public
-- storefront media into the private `expense-receipts` bucket and allow PDF receipts
-- exclusively inside that private bucket.
--
-- Store media rows already enforce RLS (enabled in 0025_catalog_operations.sql).
-- Additive and idempotent: existing public product media rows default to `media`.

alter table store_media
  add column if not exists bucket text not null default 'media';

do $$
declare
  c record;
begin
  -- Add/refresh bucket check constraint.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'store_media'::regclass
      and conname = 'store_media_bucket_check'
  ) then
    alter table store_media drop constraint store_media_bucket_check;
  end if;

  alter table store_media
    add constraint store_media_bucket_check
    check (bucket in ('media', 'expense-receipts'));

  -- Replace initial mime_type check constraint so application/pdf is permitted ONLY
  -- in the private expense-receipts bucket while public media stays image/video only.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'store_media'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* '\bmime_type\b'
  loop
    execute format('alter table store_media drop constraint %I', c.conname);
  end loop;

  alter table store_media
    add constraint store_media_mime_type_bucket_check
    check (
      mime_type in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'image/svg+xml', 'image/avif', 'video/webm', 'video/mp4'
      )
      or (bucket = 'expense-receipts' and mime_type = 'application/pdf')
    );
end $$;

create index if not exists idx_store_media_bucket_created
  on store_media (bucket, created_at desc)
  where deleted_at is null;
