-- 0039: Sale pricing and the sale-mode switch.
--
-- A sale price is stored next to the regular price and applies only while sale
-- mode is live. The storefront resolver decides which one is charged; this
-- migration only adds storage. Every sale-price write appends to
-- `price_history` with `price_kind = 'sale'` (or `'sale_cleared'`), so sale
-- changes are as auditable as regular price changes.
--
-- `sale_settings` is a one-row switch read on every request. `starts_at` and
-- `ends_at` are timestamptz and are always compared against the database
-- clock, never a browser clock. RLS is enabled in the same file; the admin
-- connection (DATABASE_URL) is the only reader/writer.
--
-- Additive only: no existing row is read or rewritten.

alter table products
  add column if not exists sale_price_paise integer
  check (sale_price_paise is null or (sale_price_paise > 0 and sale_price_paise <= 100000000));

alter table product_variants
  add column if not exists sale_price_paise integer
  check (sale_price_paise is null or (sale_price_paise > 0 and sale_price_paise <= 100000000));

alter table price_history
  add column if not exists price_kind text not null default 'regular'
  check (price_kind in ('regular', 'sale', 'sale_cleared'));

create table if not exists sale_settings (
  id          text primary key,
  enabled     boolean not null default false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

alter table sale_settings enable row level security;

insert into sale_settings (id)
values ('default')
on conflict (id) do nothing;
