-- 0003: store uploaded media bytes in the database.
--
-- Public/uploads worked locally but a rebuild/redeploy loses the files (and
-- they never worked on read-only filesystems). Binary column + serve route
-- keeps everything in Supabase. Additive only; existing rows keep their
-- file-based URLs and keep working.

alter table media add column if not exists data bytea;
alter table media add column if not exists is_db_stored boolean not null default false;

comment on column media.data is 'Raw image bytes when is_db_stored, else null (legacy rows point at public/uploads).';
