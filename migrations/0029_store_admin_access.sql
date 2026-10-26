-- 0029: Store staff access — profile columns for the staff screens.
--
-- Phase 9 adds staff management (create, edit, deactivate, reset password)
-- and a profile page. Everything the staff list shows now lives on
-- `store_admins`; no new table is needed because staff are created with a
-- one-time temporary password rather than an emailed invitation (there is no
-- outbound mail provider yet, so an invite link could not be delivered).
--
-- Additive only. No existing table, row or policy is touched.
--
-- Runner notes (scripts/migrate.mjs):
--   * One implicit transaction per file. Do not add BEGIN/COMMIT.
--   * Destructive schema changes and data wipes are refused outright.
--   * `alter table ... add column if not exists` is the only shape used here.

alter table store_admins
  add column if not exists phone text not null default '',
  add column if not exists avatar_media_id text
    references store_media(id) on delete set null,
  add column if not exists last_login_at timestamptz,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- A staff phone is a short display string, not a validated international
-- number: the store only needs a way to reach the person behind an account.
alter table store_admins
  add constraint store_admins_phone_length
  check (char_length(phone) <= 40) not valid;

-- The audit viewer reads newest-first with no actor filter often enough to
-- deserve its own index; 0010 indexes actor, action and entity but not time.
create index if not exists idx_store_audit_created
  on store_admin_audit(created_at desc, id desc);

-- Store staff are looked up by email on every login and staff screen.
create index if not exists idx_store_admins_active
  on store_admins(is_active, role);
