-- 0012: Store catalogue — brands, units, attributes and attribute values.
--
-- Additive only. Everything here extends the core tables created in 0011.
-- RLS is enabled in this same file, before any application code can read the
-- new tables through the publishable (anon) key.
--
-- No tax, HSN, invoice, cost or import-job table is created. The business is
-- not registered for GST, and product cost data is deliberately out of scope.
--
-- Runner notes (scripts/migrate.mjs):
--   * There is no explicit transaction wrapper here; the file is executed as
--     one implicit transaction.
--   * Destructive schema changes are refused. The only "drop" statements are
--     idempotent policy recreates that touch no rows.

-- ----------------------------------------------------------------- brands
-- products.brand stays as the display label; brand_id is the join key.

create table if not exists brands (
  id          text primary key,
  slug        text not null unique,
  name        text not null,
  logo_url    text,
  description text not null default '',
  is_active   boolean not null default true,
  deleted_at  timestamptz,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table products add column if not exists brand_id text references brands(id);
create index if not exists idx_products_brand
  on products(brand_id) where deleted_at is null;

-- ------------------------------------------------------------------ units

create table if not exists units (
  id        text primary key,
  code      text not null unique,
  label     text not null,
  dimension text not null check (dimension in ('mass','volume','length','count')),
  base_code text,
  factor    numeric(18,6) not null default 1 check (factor > 0)
);

-- ------------------------------------------------------------- attributes

create table if not exists attributes (
  id                text primary key,
  key               text not null unique,
  label             text not null,
  data_type         text not null check (data_type in ('text','number','boolean','enum')),
  unit_id           text references units(id),
  is_filterable     boolean not null default false,
  is_variant_option boolean not null default false,
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  deleted_at        timestamptz
);

create table if not exists attribute_options (
  attribute_id text not null references attributes(id) on delete cascade,
  value        text not null,
  sort_order   integer not null default 0,
  primary key (attribute_id, value)
);

create table if not exists product_attribute_values (
  product_id   text not null references products(id) on delete cascade,
  attribute_id text not null references attributes(id),
  value_text   text,
  value_number numeric(18,6),
  value_bool   boolean,
  option_value text,
  primary key (product_id, attribute_id)
);

create index if not exists idx_product_attr_lookup
  on product_attribute_values(attribute_id, option_value);

-- ---------------------------------------------------------------------- RLS
-- Public reads follow the same rule as 0011: active, non-deleted reference
-- rows only, and attribute options / product values only when their parent is
-- visible. units has RLS enabled with NO policy — it is private reference data
-- that the storefront does not need, so anon and authenticated see zero rows.

alter table brands                  enable row level security;
alter table units                   enable row level security;
alter table attributes              enable row level security;
alter table attribute_options       enable row level security;
alter table product_attribute_values enable row level security;

drop policy if exists "public read active brands" on brands;
create policy "public read active brands"
  on brands for select to anon, authenticated
  using (is_active and deleted_at is null);

drop policy if exists "public read active attributes" on attributes;
create policy "public read active attributes"
  on attributes for select to anon, authenticated
  using (is_active and deleted_at is null);

drop policy if exists "public read options of active attributes" on attribute_options;
create policy "public read options of active attributes"
  on attribute_options for select to anon, authenticated
  using (exists (
    select 1 from attributes a
    where a.id = attribute_options.attribute_id
      and a.is_active
      and a.deleted_at is null
  ));

drop policy if exists "public read values of active products" on product_attribute_values;
create policy "public read values of active products"
  on product_attribute_values for select to anon, authenticated
  using (exists (
    select 1 from products p
    where p.id = product_attribute_values.product_id
      and p.is_active
      and p.deleted_at is null
  ));
