-- Permanent staff removal retains opaque ids for historical foreign keys.
-- Existing immutable audit, refund and order-edit rows remain untouched.
alter table store_admins
  add column if not exists removed_at timestamptz;

alter table store_admins alter column phone drop not null;

create index if not exists idx_store_admins_not_removed
  on store_admins(role, is_active) where removed_at is null;
