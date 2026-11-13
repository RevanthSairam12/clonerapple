-- 0072: Free Gifts (catalog gift-only flag, rules, redemption ledger, order item
-- markers) and Spin Wheel exact Chance % / FREE_GIFT prize support.
--
-- Additive only. Every new table has row level security enabled with no
-- policies, so only the server (DATABASE_URL) can read or write them.

-- ------------------------------------------------------- 1. Gift-only catalog flag
alter table products
  add column if not exists is_gift_only boolean not null default false;

create index if not exists idx_products_is_gift_only
  on products (is_gift_only)
  where deleted_at is null;

-- ------------------------------------------------------- 2. Free Gift rules
create table if not exists free_gift_rules (
  id                         text primary key,
  name                       text not null
                             check (char_length(btrim(name)) between 1 and 80),
  gift_product_id            text not null references products(id),
  gift_variant_id            text references product_variants(id),
  target_paise               bigint not null
                             check (target_paise > 0),
  icon_url                   text not null default ''
                             check (char_length(icon_url) <= 500),
  badge_text                 text not null default 'FREE'
                             check (char_length(btrim(badge_text)) between 1 and 24),
  unlock_message             text not null default 'You unlocked a free gift!'
                             check (char_length(btrim(unlock_message)) between 1 and 160),
  starts_at                  timestamptz,
  ends_at                    timestamptz,
  is_active                  boolean not null default true,
  show_on_product_page       boolean not null default false,
  max_gifts_total            integer
                             check (max_gifts_total is null or max_gifts_total > 0),
  per_customer_limit         integer
                             check (per_customer_limit is null or per_customer_limit > 0),
  priority                   integer not null default 0
                             check (priority >= -9999 and priority <= 9999),
  coupon_interaction         text not null default 'allow'
                             check (coupon_interaction in ('allow', 'disallow')),
  min_post_coupon_paise      bigint not null default 0
                             check (min_post_coupon_paise >= 0),
  unavailable_checkout_count integer not null default 0
                             check (unavailable_checkout_count >= 0),
  last_unavailable_at        timestamptz,
  created_by                 text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  archived_at                timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists idx_free_gift_rules_active_target
  on free_gift_rules (is_active, target_paise desc, priority desc, created_at asc)
  where archived_at is null;

create index if not exists idx_free_gift_rules_product
  on free_gift_rules (gift_product_id);

alter table free_gift_rules enable row level security;

-- ------------------------------------------------------- 3. Free Gift redemptions ledger
create table if not exists free_gift_redemptions (
  id               text primary key,
  rule_id          text not null references free_gift_rules(id),
  order_id         text not null references orders(id) on delete cascade,
  customer_user_id text,
  customer_email   text not null default '',
  gift_product_id  text not null,
  gift_variant_id  text,
  threshold_paise  bigint not null default 0 check (threshold_paise >= 0),
  quantity         integer not null default 1 check (quantity > 0),
  state            text not null check (state in ('RESERVED', 'CONSUMED', 'RELEASED')),
  release_reason   text,
  reserved_at      timestamptz not null default now(),
  consumed_at      timestamptz,
  released_at      timestamptz,
  unique (order_id, rule_id)
);

create index if not exists idx_free_gift_redemptions_rule_state
  on free_gift_redemptions (rule_id, state);

create index if not exists idx_free_gift_redemptions_user
  on free_gift_redemptions (customer_user_id)
  where customer_user_id is not null and state in ('RESERVED', 'CONSUMED');

create index if not exists idx_free_gift_redemptions_email
  on free_gift_redemptions (lower(customer_email))
  where customer_email <> '' and state in ('RESERVED', 'CONSUMED');

alter table free_gift_redemptions enable row level security;

-- ------------------------------------------------------- 4. Order items gift markers
alter table order_items
  add column if not exists is_free_gift boolean not null default false,
  add column if not exists free_gift_rule_id text references free_gift_rules(id),
  add column if not exists free_gift_badge text,
  add column if not exists free_gift_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_items'::regclass
      and conname = 'order_items_free_gift_source_check'
  ) then
    alter table order_items
      add constraint order_items_free_gift_source_check
      check (free_gift_source is null or free_gift_source in ('threshold', 'spin_wheel'));
  end if;
end
$$;

create index if not exists idx_order_items_free_gift
  on order_items (order_id, is_free_gift)
  where is_free_gift = true;

-- ------------------------------------------------------- 5. Coupons: FREE_GIFT support
alter table coupons
  add column if not exists gift_product_id text references products(id),
  add column if not exists gift_variant_id text references product_variants(id);

do $$
declare
  c_name text;
begin
  for c_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'coupons'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%type%'
  loop
    execute format('alter table coupons drop constraint %I', c_name);
  end loop;
end
$$;

alter table coupons
  add constraint coupons_type_check
  check (type in ('PERCENT', 'FIXED', 'FREE_SHIPPING', 'FREE_GIFT'));

alter table coupons
  add constraint coupons_value_by_type_check
  check (
    (type = 'PERCENT' and value between 1 and 100)
    or (type = 'FIXED' and value >= 0)
    or (type in ('FREE_SHIPPING', 'FREE_GIFT'))
  );

alter table coupons
  add constraint coupons_free_gift_product_check
  check (type <> 'FREE_GIFT' or gift_product_id is not null);

-- ------------------------------------------------------- 6. Spin wheel segments & spins: FREE_GIFT + chance %
alter table spin_wheel_segments
  add column if not exists gift_product_id text references products(id),
  add column if not exists gift_variant_id text references product_variants(id),
  add column if not exists gift_min_order_paise bigint not null default 0 check (gift_min_order_paise >= 0),
  add column if not exists gift_valid_days integer not null default 7 check (gift_valid_days >= 1 and gift_valid_days <= 365);

do $$
declare
  c_name text;
begin
  for c_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'spin_wheel_segments'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%segment_type%'
        or pg_get_constraintdef(c.oid) ilike '%coupon_type%'
      )
  loop
    execute format('alter table spin_wheel_segments drop constraint %I', c_name);
  end loop;
end
$$;

alter table spin_wheel_segments
  add constraint spin_wheel_segments_segment_type_check
  check (segment_type in ('COUPON', 'FREE_GIFT', 'NO_PRIZE'));

alter table spin_wheel_segments
  add constraint spin_wheel_segments_prize_check
  check (
    segment_type = 'NO_PRIZE'
    or (segment_type = 'FREE_GIFT' and gift_product_id is not null)
    or (
      segment_type = 'COUPON'
      and (
        coupon_type = 'FREE_SHIPPING'
        or (coupon_type = 'PERCENT' and coupon_value between 1 and 100)
        or (coupon_type = 'FIXED' and coupon_value > 0)
      )
    )
  );

do $$
declare
  c_name text;
begin
  for c_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'spin_wheel_spins'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%segment_type%'
  loop
    execute format('alter table spin_wheel_spins drop constraint %I', c_name);
  end loop;
end
$$;

alter table spin_wheel_spins
  add constraint spin_wheel_spins_segment_type_check
  check (segment_type in ('COUPON', 'FREE_GIFT', 'NO_PRIZE'));

-- Keep schema default consistent with application default ('disabled').
alter table spin_wheel_settings
  alter column reward_cooldown_mode set default 'disabled';

