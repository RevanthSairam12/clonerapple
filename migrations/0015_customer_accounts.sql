alter table users
  add column if not exists phone text;

create table if not exists customer_addresses (
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  name         text not null,
  phone        text not null,
  line1        text not null,
  line2        text,
  city         text not null,
  state        text not null,
  pincode      text not null,
  is_default   boolean not null default false,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_customer_addresses_user_active
  on customer_addresses(user_id, deleted_at, created_at desc);

create unique index if not exists idx_customer_addresses_one_default
  on customer_addresses(user_id)
  where is_default = true and deleted_at is null;

alter table customer_addresses enable row level security;
