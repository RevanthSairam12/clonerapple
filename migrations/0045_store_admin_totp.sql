-- Store Admin TOTP safeguards.
--
-- `store_admins` already has totp_secret / totp_enabled / recovery_hash
-- (0010). This migration adds what the enrolment screen needs:
--
--   * totp_last_step — the last time step a code matched, so the same code
--     cannot be replayed inside its 30-second window.
--   * store_admin_recovery_codes — one-time backup codes, hashed at rest and
--     marked used on first success. `recovery_hash` stays because migrated
--     legacy accounts may already have a single recovery code.

alter table store_admins add column if not exists totp_last_step integer;

create table if not exists store_admin_recovery_codes (
  id         text primary key,
  admin_id   text not null references store_admins(id) on delete cascade,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

create index if not exists idx_store_admin_recovery_codes_admin
  on store_admin_recovery_codes(admin_id);

alter table store_admin_recovery_codes enable row level security;
