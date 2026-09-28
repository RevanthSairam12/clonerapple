-- 0002: Row Level Security for the admin tables.
--
-- The public site reads content via the Supabase REST API with the
-- publishable (anon) key, so every table the site reads must be readable by
-- the anon role — and every admin-only table must NOT be. Without these
-- policies the publishable key exposes admin_users / admin_sessions
-- (including password hashes) to anyone.
--
-- Additive only: enables RLS and creates policies; drops nothing.
-- Re-runnable: idempotent guards on every statement.

alter table content_blocks enable row level security;
alter table site_settings   enable row level security;
alter table media           enable row level security;
alter table admin_users     enable row level security;
alter table admin_sessions  enable row level security;

-- Public site reads (anon role): read-only on public content.
-- drop policy if exists keeps the file re-runnable (policies are not part
-- of the destructive guard — dropping a policy we recreate next line is safe).
drop policy if exists "public read content_blocks" on content_blocks;
create policy "public read content_blocks"
  on content_blocks for select
  to anon, authenticated
  using (true);

drop policy if exists "public read site_settings" on site_settings;
create policy "public read site_settings"
  on site_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "public read media" on media;
create policy "public read media"
  on media for select
  to anon, authenticated
  using (true);

-- admin_users / admin_sessions get NO anon policy: with RLS enabled and no
-- policy, the anon/authenticated roles see zero rows. Only the table owner
-- (the DATABASE_URL connection used by the admin panel) bypasses RLS.
