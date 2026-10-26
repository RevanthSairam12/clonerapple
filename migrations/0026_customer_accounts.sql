-- 0026: Customer accounts — status, notes, subscribers and customer settings.
--
-- Additive only. Every new table enables row level security in this same file,
-- with no policies: only the DATABASE_URL connection (table owner) can read or
-- write them.
--
-- The customer directory already reads `users` / `orders` / `customer_addresses`
-- (0008, 0009, 0015). This file adds the staff-facing parts: a block flag with
-- an audit-friendly reason, a last-seen login timestamp, append-only customer
-- notes, a login event trail, newsletter subscribers and a small key/value store
-- for customer policies.

-- ------------------------------------------------------------ users

alter table users add column if not exists is_blocked boolean not null default false;
alter table users add column if not exists blocked_at timestamptz;
alter table users add column if not exists blocked_reason text not null default '';
alter table users add column if not exists anonymised_at timestamptz;
alter table users add column if not exists last_login_at timestamptz;
alter table users add column if not exists customer_group text not null default 'retail';
alter table users add column if not exists marketing_opt_in boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_customer_group_check'
  ) then
    alter table users
      add constraint users_customer_group_check
      check (customer_group in ('retail', 'vip', 'wholesale'))
      not valid;
  end if;
end
$$;

alter table users validate constraint users_customer_group_check;

create index if not exists idx_users_blocked
  on users(is_blocked)
  where is_blocked = true;

-- ------------------------------------------------------ user sessions

-- A session row can now describe the device that created it and when it was
-- last used, so the store admin can list and revoke sessions. Client IPs are
-- never stored raw: the column is a SHA-256 hash, or null.
alter table user_sessions add column if not exists device text not null default '';
alter table user_sessions add column if not exists ip_hash text;
alter table user_sessions add column if not exists last_seen_at timestamptz;

create index if not exists idx_user_sessions_user_created
  on user_sessions(user_id, created_at desc);

-- ------------------------------------------------------ customer notes

create table if not exists customer_notes (
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  body         text not null,
  author_id    text references store_admins(id) on delete set null,
  author_name  text not null default '',
  author_email text not null default '',
  created_at   timestamptz not null default now(),
  constraint customer_notes_body_length_check check (char_length(body) between 1 and 2000)
);

create index if not exists idx_customer_notes_user_created
  on customer_notes(user_id, created_at desc, id desc);

alter table customer_notes enable row level security;

-- ------------------------------------------------------- login events

-- One row per sign-in outcome. No IP address, user agent or other identifier is
-- stored here; `device` is the coarse browser/OS label derived at sign-in.
create table if not exists user_login_events (
  id         bigserial primary key,
  user_id    text not null references users(id) on delete cascade,
  outcome    text not null
             check (outcome in ('success', 'failed', 'blocked', 'signup', 'logout')),
  device     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_user_login_events_user_created
  on user_login_events(user_id, created_at desc, id desc);

alter table user_login_events enable row level security;

-- -------------------------------------------------------- subscribers

create table if not exists newsletter_subscribers (
  id                 text primary key,
  email              text not null,
  source             text not null default 'storefront'
                     check (source in ('storefront', 'checkout', 'manual', 'import')),
  consent_at         timestamptz not null default now(),
  subscribed_at      timestamptz not null default now(),
  unsubscribed_at    timestamptz,
  unsubscribe_reason text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint newsletter_subscribers_email_lower_check check (email = lower(email))
);

create unique index if not exists idx_newsletter_subscribers_email
  on newsletter_subscribers(email);

create index if not exists idx_newsletter_subscribers_subscribed
  on newsletter_subscribers(subscribed_at desc);

alter table newsletter_subscribers enable row level security;

-- -------------------------------------------------- customer settings

create table if not exists customer_settings (
  key        text primary key,
  value      text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table customer_settings enable row level security;
