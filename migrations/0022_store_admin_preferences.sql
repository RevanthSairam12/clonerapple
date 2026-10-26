-- 0022: Per-staff preferences.
--
-- Saved order views live here rather than in localStorage so they follow the
-- staff member to another browser. One row per admin; the JSON is validated by
-- the application before it is written.

create table if not exists store_admin_preferences (
  admin_id    text primary key references store_admins(id) on delete cascade,
  saved_views jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table store_admin_preferences enable row level security;
