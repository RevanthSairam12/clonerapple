-- 0007: move media uploads to Supabase Storage (public bucket).
--
-- bytea blobs in the media table grow the database (free tier: 500 MB) and
-- stream through the Next.js server on every page view. Storage serves them
-- from Supabase's CDN instead. Additive only:
--   * new storage_path column marks Storage-backed rows (null = legacy)
--   * legacy bytea rows keep working — the serve route falls back to them
--   * the public 'media' bucket is created here, so nothing needs dashboard
--     clicks; objects get uuid filenames so listings can't be guessed

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

alter table media add column if not exists storage_path text;

comment on column media.storage_path is 'Object path in the public media bucket when Storage-backed, else null (legacy bytea rows).';
