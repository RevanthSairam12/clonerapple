-- 0010: Store admin foundation — accounts, sessions and the audit log.
--
-- Option B from the design: the store admin is a completely separate identity
-- store from `admin_users`. It has its own tables and its own cookie
-- (`store_admin_session`), so the content panel's `getSession()` physically
-- cannot authenticate a store admin and vice versa.
--
-- Additive only. No existing table, row or policy is touched.
--
-- Runner notes (scripts/migrate.mjs):
--   * It does NOT wrap this file in BEGIN/COMMIT. Each file is sent as one
--     simple-protocol Query message (postgres.js `unsafe()` with no params),
--     which PostgreSQL executes as one implicit transaction. Do not add
--     BEGIN/COMMIT here.
--   * It refuses destructive schema removals (table, column or database
--     removal), data wiping, and ALTER TABLE removals other than
--     constraint/policy. `create or replace trigger` is used instead of
--     remove-and-recreate.

-- ---------------------------------------------------------------- accounts

create table if not exists store_admins (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,
  name          text not null default '',
  role          text not null default 'store_admin'
                check (role in ('store_owner','store_admin','store_viewer')),
  totp_secret   text,
  totp_enabled  boolean not null default false,
  recovery_hash text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- sessions

create table if not exists store_admin_sessions (
  token_hash text primary key,                      -- SHA-256(token), as in 0004/0005
  admin_id   text not null references store_admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_admin_sessions_admin
  on store_admin_sessions(admin_id);

-- --------------------------------------------------------------- audit log
-- v1 columns (actor/action/entity/before/after) plus the v2 extensions
-- (request id, route, outcome, reason, hashed network identifiers).

create table if not exists store_admin_audit (
  id              bigserial primary key,
  actor_id        text,
  actor_email     text not null default '',
  action          text not null,             -- 'store_admin.login' | 'price.update' | …
  entity          text not null,             -- 'store_admin' | 'product' | 'order' | …
  entity_id       text not null default '',
  before          jsonb,
  after           jsonb,
  request_id      text,
  route           text not null default '',
  status          text not null default 'ok',
  reason          text not null default '',
  ip_hash         text,                      -- SHA-256; the raw IP is never stored
  user_agent_hash text,                      -- SHA-256; the raw UA is never stored
  created_at      timestamptz not null default now()
);

create index if not exists idx_store_audit_entity
  on store_admin_audit(entity, entity_id, created_at desc);
create index if not exists idx_store_audit_actor
  on store_admin_audit(actor_id, created_at desc);
create index if not exists idx_store_audit_action
  on store_admin_audit(action, created_at desc);

-- Append-only at the database level: no UPDATE or DELETE can succeed, even
-- from the application's connection role.
create or replace function forbid_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit rows are immutable';
end;
$$;

-- `create or replace trigger` needs PostgreSQL 14+ (Supabase is 15+).
create or replace trigger store_admin_audit_immutable
  before update or delete on store_admin_audit
  for each row execute function forbid_audit_mutation();

-- ---------------------------------------------------------------------- RLS
-- Enabled in the same file that creates the tables, so there is no window in
-- which the publishable (anon) key can read them. No policies: anon and
-- authenticated get zero rows. The server-side `postgres` role is the table
-- owner and is used by the application.
--
-- This does NOT touch the RLS gap on users/user_sessions/orders.

alter table store_admins         enable row level security;
alter table store_admin_sessions enable row level security;
alter table store_admin_audit    enable row level security;
