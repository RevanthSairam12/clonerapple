-- 0011: Store catalogue — core tables, indexes and row level security.
--
-- Additive only. No existing table, row, policy, function or trigger is
-- modified. The reference tables (brands, units, attributes, attribute
-- options and product attribute values) live in 0012.
--
-- Money is stored as integer paise. The business is not registered for GST,
-- so there is deliberately no tax, HSN or invoice table in this migration and
-- no product_tax / product_costs table.
--
-- Soft deletion is used everywhere the storefront may need history:
-- categories/products carry deleted_at, and child rows that can be removed
-- carry is_active (images also carry deleted_at).
--
-- Runner notes (scripts/migrate.mjs):
--   * It does NOT wrap this file in BEGIN/COMMIT. Each file is sent as one
--     simple-protocol Query message, which PostgreSQL executes as one implicit
--     transaction. Do not add BEGIN/COMMIT here.
--   * It refuses destructive schema removals and data wiping. This file only
--     adds objects; the only "drop" statements are idempotent policy recreates
--     that touch no rows.
--   * RLS is enabled in this same file so there is no window in which the
--     publishable (anon) key can read a catalogue table without a policy.
--
-- This does NOT touch the RLS gap on users/user_sessions/orders.

-- ------------------------------------------------------------- categories

create table if not exists categories (
  id              text primary key,
  slug            text not null unique,
  name            text not null,
  title           text not null default '',
  subhead         text not null default '',
  breadcrumb_leaf text not null default '',
  count_noun      text not null default '',
  disclaimer      text not null default '',
  seo_title       text not null default '',
  seo_description text not null default '',
  nav_label       text not null default '',
  nav_href        text not null default '',
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- --------------------------------------------------------------- products
-- products.id is the id already used by the storefront, cart lines, site
-- search and orders.items[].id. It is never regenerated.

create table if not exists products (
  id               text primary key,
  category_id      text not null references categories(id),
  slug             text not null unique,
  name             text not null,
  subtitle         text not null default '',
  price_paise      integer not null check (price_paise >= 0),
  compare_at_paise integer
                   check (compare_at_paise is null or compare_at_paise >= price_paise),
  currency         text not null default 'INR',
  material         text not null default '',
  brand            text not null default '',
  description      text not null default '',
  badge            text,
  highlights       jsonb not null default '[]'::jsonb,
  in_the_box       jsonb not null default '[]'::jsonb,
  seo_title        text not null default '',
  seo_description  text not null default '',
  -- Denormalised availability, so the storefront can read it through the
  -- public SELECT policy while the stock table itself stays private.
  in_stock         boolean not null default true,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  deleted_at       timestamptz
);

-- --------------------------------------------------------- facet plumbing
-- product_facets unifies the case catalogue's compatibility list, the
-- accessory catalogue's facets map, and the material/brand display labels
-- into one filterable shape.

create table if not exists product_facets (
  product_id  text not null references products(id) on delete cascade,
  facet_key   text not null,
  facet_value text not null,
  sort_order  integer not null default 0,
  primary key (product_id, facet_key, facet_value)
);

-- Per-category sidebar contract: labels, options and the quick-pill facet.
create table if not exists facet_defs (
  category_id   text not null references categories(id) on delete cascade,
  facet_key     text not null,
  label         text not null,
  options       jsonb not null default '[]'::jsonb,
  is_quick_pill boolean not null default false,
  sort_order    integer not null default 0,
  primary key (category_id, facet_key)
);

create table if not exists product_specs (
  product_id text not null references products(id) on delete cascade,
  label      text not null,
  value      text not null,
  sort_order integer not null default 0,
  primary key (product_id, label)
);

create table if not exists product_images (
  id         text primary key,
  product_id text not null references products(id) on delete cascade,
  url        text not null,
  alt        text not null default '',
  role       text not null default 'gallery'
             check (role in ('primary','hover','gallery')),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one live primary and one live hover image per product.
create unique index if not exists idx_product_images_one_primary
  on product_images(product_id)
  where role = 'primary' and is_active and deleted_at is null;
create unique index if not exists idx_product_images_one_hover
  on product_images(product_id)
  where role = 'hover' and is_active and deleted_at is null;

-- Colours and other display-only options. They carry no price and no stock
-- yet; promoting them to purchasable SKUs is a separate project.
create table if not exists product_variants (
  id                   text primary key,
  product_id           text not null references products(id) on delete cascade,
  sku                  text unique,
  option_name          text not null default 'Colour',
  option_value         text not null,
  option_hex           text,
  price_paise_override integer
                       check (price_paise_override is null or price_paise_override >= 0),
  is_active            boolean not null default true,
  sort_order           integer not null default 0
);

create unique index if not exists idx_product_variants_option
  on product_variants(product_id, option_name, option_value);

-- ---------------------------------------------------------- price history
-- Append-only: every price change adds a row. The trigger below makes UPDATE
-- and DELETE fail even for the application's connection role.

create table if not exists price_history (
  id              bigserial primary key,
  product_id      text not null references products(id),
  variant_id      text references product_variants(id),
  old_price_paise integer,
  new_price_paise integer not null,
  currency        text not null default 'INR',
  reason          text not null default '',
  source          text not null default 'store_admin'
                  check (source in ('seed','store_admin','bulk_import','api')),
  changed_by      text,
  changed_at      timestamptz not null default now()
);

create index if not exists idx_price_history_product
  on price_history(product_id, changed_at desc);

create or replace function forbid_price_history_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'price history rows are immutable';
end;
$$;

create or replace trigger price_history_immutable
  before update or delete on price_history
  for each row execute function forbid_price_history_mutation();

-- ------------------------------------------------------------------- stock
-- A row with variant_id NULL is the product-level row. A primary key cannot
-- contain NULL, so this table uses a surrogate text id plus two partial
-- unique indexes that enforce one row per product/variant pair and one
-- product-level row.
--
-- track_inventory defaults to false: there is no inventory process yet, and a
-- stock gate would make every product unbuyable. The seed records the rows
-- without gating checkout.

create table if not exists stock (
  id                  text primary key,
  product_id          text not null references products(id) on delete cascade,
  variant_id          text references product_variants(id) on delete cascade,
  on_hand             integer not null default 0 check (on_hand >= 0),
  reserved            integer not null default 0 check (reserved >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  track_inventory     boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          text,
  constraint stock_reserved_le_on_hand check (reserved <= on_hand)
);

create unique index if not exists idx_stock_product_variant
  on stock(product_id, variant_id) where variant_id is not null;
create unique index if not exists idx_stock_product_level
  on stock(product_id) where variant_id is null;

create table if not exists stock_movements (
  id         bigserial primary key,
  product_id text not null references products(id),
  variant_id text references product_variants(id),
  delta      integer not null,
  reason     text not null default ''
             check (reason in ('seed','receipt','sale','return','adjustment','damage')),
  order_id   text references orders(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_prod
  on stock_movements(product_id, created_at desc);

-- ----------------------------------------------------------------- indexes

create index if not exists idx_products_category
  on products(category_id) where deleted_at is null;
create index if not exists idx_products_active_price
  on products(is_active, price_paise) where deleted_at is null;
create index if not exists idx_product_facets_lookup
  on product_facets(facet_key, facet_value);
create index if not exists idx_product_images_product
  on product_images(product_id, role, sort_order);
create index if not exists idx_categories_active_order
  on categories(is_active, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------------- RLS
-- Enabled in the same file that creates the tables. Public SELECT is allowed
-- only for active, non-deleted catalogue rows and the children of a visible
-- parent, so an unpublished product cannot leak its copy, facets, images or
-- variants through the publishable key.
--
-- price_history, stock and stock_movements get RLS with NO policy: anon and
-- authenticated see zero rows. Only the table owner (the DATABASE_URL
-- connection used by the store admin) bypasses RLS.

alter table categories       enable row level security;
alter table products         enable row level security;
alter table product_facets   enable row level security;
alter table facet_defs       enable row level security;
alter table product_specs    enable row level security;
alter table product_images   enable row level security;
alter table product_variants enable row level security;
alter table price_history    enable row level security;
alter table stock            enable row level security;
alter table stock_movements  enable row level security;

drop policy if exists "public read active categories" on categories;
create policy "public read active categories"
  on categories for select to anon, authenticated
  using (is_active and deleted_at is null);

drop policy if exists "public read active products" on products;
create policy "public read active products"
  on products for select to anon, authenticated
  using (is_active and deleted_at is null);

drop policy if exists "public read facets of active products" on product_facets;
create policy "public read facets of active products"
  on product_facets for select to anon, authenticated
  using (exists (
    select 1 from products p
    where p.id = product_facets.product_id
      and p.is_active
      and p.deleted_at is null
  ));

drop policy if exists "public read facet defs of active categories" on facet_defs;
create policy "public read facet defs of active categories"
  on facet_defs for select to anon, authenticated
  using (exists (
    select 1 from categories c
    where c.id = facet_defs.category_id
      and c.is_active
      and c.deleted_at is null
  ));

drop policy if exists "public read specs of active products" on product_specs;
create policy "public read specs of active products"
  on product_specs for select to anon, authenticated
  using (exists (
    select 1 from products p
    where p.id = product_specs.product_id
      and p.is_active
      and p.deleted_at is null
  ));

drop policy if exists "public read images of active products" on product_images;
create policy "public read images of active products"
  on product_images for select to anon, authenticated
  using (
    is_active
    and deleted_at is null
    and exists (
      select 1 from products p
      where p.id = product_images.product_id
        and p.is_active
        and p.deleted_at is null
    )
  );

drop policy if exists "public read variants of active products" on product_variants;
create policy "public read variants of active products"
  on product_variants for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from products p
      where p.id = product_variants.product_id
        and p.is_active
        and p.deleted_at is null
    )
  );
