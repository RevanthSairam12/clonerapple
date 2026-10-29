-- 0041: Coupons and their redemption ledger.
--
-- Three new tables. Every one has row level security enabled in this file,
-- with no policies: only the server (DATABASE_URL) reads or writes them.
-- `orders.discount_paise` and `orders.coupon_code` already exist from 0014;
-- this file adds the stable coupon id and the snapshot, and gives every
-- order line its share of the discount so line totals add up to the order
-- total.
--
-- Money is integer paise. `coupons.value` is a percentage for PERCENT and
-- paise for FIXED; FREE_SHIPPING carries 0.

create table if not exists coupons (
  id                      text primary key,
  code                    text not null,
  name                    text not null default '',
  description             text not null default '',
  type                    text not null
                          check (type in ('PERCENT', 'FIXED', 'FREE_SHIPPING')),
  value                   bigint not null default 0
                          check (value >= 0),
  scope                   text not null default 'ORDER'
                          check (scope in ('ORDER', 'PRODUCTS', 'CATEGORIES', 'BRANDS')),
  status                  text not null default 'active'
                          check (status in ('active', 'paused', 'archived')),
  starts_at               timestamptz,
  ends_at                 timestamptz,
  total_redemption_limit  integer
                          check (total_redemption_limit is null or total_redemption_limit > 0),
  per_customer_limit      integer
                          check (per_customer_limit is null or per_customer_limit > 0),
  min_order_paise         bigint not null default 0
                          check (min_order_paise >= 0),
  max_discount_paise      bigint
                          check (max_discount_paise is null or max_discount_paise >= 0),
  only_new_customers      boolean not null default false,
  allow_with_sale_price   boolean not null default false,
  allowed_customer_groups text[],
  restricted_to_emails    text[],
  created_by              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  archived_at             timestamptz,
  check (code = upper(code)),
  check (char_length(code) between 3 and 32),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (
    (type = 'PERCENT' and value between 1 and 100)
    or (type = 'FIXED' and value >= 0)
    or (type = 'FREE_SHIPPING')
  )
);

-- Case-insensitive uniqueness even if a row was written outside this app.
create unique index if not exists idx_coupons_code_upper
  on coupons (upper(code));

create index if not exists idx_coupons_status
  on coupons (status, created_at desc);

-- Exactly one of product_id / category_id / brand_id is set per row.
create table if not exists coupon_targets (
  id          bigserial primary key,
  coupon_id   text not null references coupons(id) on delete cascade,
  product_id  text references products(id) on delete cascade,
  category_id text references categories(id) on delete cascade,
  brand_id    text references brands(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (num_nonnulls(product_id, category_id, brand_id) = 1)
);

create index if not exists idx_coupon_targets_coupon
  on coupon_targets (coupon_id);

create unique index if not exists idx_coupon_targets_product
  on coupon_targets (coupon_id, product_id)
  where product_id is not null;

create unique index if not exists idx_coupon_targets_category
  on coupon_targets (coupon_id, category_id)
  where category_id is not null;

create unique index if not exists idx_coupon_targets_brand
  on coupon_targets (coupon_id, brand_id)
  where brand_id is not null;

-- Append-style redemption ledger. Rows are never deleted: a released use
-- stays visible in the store-admin usage log and can be restored by a late
-- verified payment.
create table if not exists coupon_redemptions (
  id                 bigserial primary key,
  coupon_id          text not null references coupons(id),
  order_id           text not null references orders(id) on delete cascade,
  customer_user_id   text references users(id) on delete set null,
  customer_email     text not null default '',
  discount_paise     bigint not null default 0
                     check (discount_paise >= 0),
  state              text not null default 'RESERVED'
                     check (state in ('RESERVED', 'CONSUMED', 'RELEASED')),
  created_at         timestamptz not null default now(),
  consumed_at        timestamptz,
  released_at        timestamptz,
  release_reason     text,
  unique (coupon_id, order_id)
);

create index if not exists idx_coupon_redemptions_coupon_state
  on coupon_redemptions (coupon_id, state);

create index if not exists idx_coupon_redemptions_coupon_user
  on coupon_redemptions (coupon_id, customer_user_id, state);

create index if not exists idx_coupon_redemptions_coupon_email
  on coupon_redemptions (coupon_id, lower(customer_email), state);

create index if not exists idx_coupon_redemptions_order
  on coupon_redemptions (order_id);

alter table coupons            enable row level security;
alter table coupon_targets     enable row level security;
alter table coupon_redemptions enable row level security;

-- Stable link from the order to the coupon, plus the exact snapshot the
-- customer saw. `coupon_code` (0014) stays as the human-readable snapshot.
alter table orders
  add column if not exists coupon_id text,
  add column if not exists coupon_snapshot jsonb;

-- The share of the order discount allocated to each line. The sum of these
-- equals `orders.discount_paise`, and `line_total_paise - discount_paise`
-- is the net value of the line for returns and refunds.
alter table order_items
  add column if not exists discount_paise bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_items'::regclass
      and conname = 'order_items_discount_check'
  ) then
    alter table order_items add constraint order_items_discount_check
      check (discount_paise >= 0 and discount_paise <= line_total_paise) not valid;
  end if;
end
$$;

alter table order_items validate constraint order_items_discount_check;
