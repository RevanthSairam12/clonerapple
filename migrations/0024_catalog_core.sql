-- 0024: Catalog core — category tree and product condition.
--
-- Categories gain a parent so the back office can show a tree. The storefront
-- still resolves products by category_id, so a parent is grouping only: it
-- never changes which category a product belongs to.
--
-- Conditions are reference data (New / Refurbished / Used). Products point at
-- one optionally; the badge text stays free-form so the storefront is not
-- forced to change copy on migration.

alter table categories
  add column if not exists parent_id text references categories(id) on delete set null;

create index if not exists idx_categories_parent
  on categories(parent_id) where parent_id is not null;

create table if not exists conditions (
  id          text primary key,
  label       text not null check (char_length(label) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into conditions (id, label, sort_order) values
  ('new', 'New', 10),
  ('refurbished', 'Refurbished', 20),
  ('used', 'Used', 30)
on conflict (id) do nothing;

alter table products
  add column if not exists condition_id text references conditions(id) on delete set null;

-- Manual adjustments carry a short note ("two units damaged in transit"). The
-- column is additive so existing seed/sale rows keep working.
alter table stock_movements
  add column if not exists note text not null default '' check (char_length(note) <= 300);

alter table conditions enable row level security;
