-- 0046: Non-destructive reverting for theme settings.
--
-- The old content panel deleted a site_settings row when an editor reset a
-- theme value. The merged Website screen keeps the same one-click reset, but
-- stores the previous value instead of destroying it: `archived_at` marks the
-- row as inactive, the storefront readers ignore archived rows, and the next
-- save clears the column again — the same pattern content_blocks has used
-- since 0033.
--
-- Additive only: one nullable column. RLS is already enabled on site_settings
-- (0002) with a public read policy; this file adds no policy.

alter table site_settings
  add column if not exists archived_at timestamptz;

create index if not exists idx_site_settings_archived
  on site_settings (archived_at)
  where archived_at is null;
