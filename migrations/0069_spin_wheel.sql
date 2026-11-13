-- 0069: Spin and Win wheel configuration, segments, daily counts and spin ledger.
--
-- Additive only. Every new table has row level security enabled with no
-- policies, so only the server (DATABASE_URL) can read or write them.
--
-- Also adds `coupons.source` so customer Coupons can badge Spin and Win prizes,
-- and registers the `spin_win` notification event in `notification_outbox`
-- and `notification_channel_settings`.

-- ------------------------------------------------------- wheel settings (singleton)
create table if not exists spin_wheel_settings (
  id                      text primary key default 'default'
                          check (id = 'default'),
  enabled                 boolean not null default false,
  title                   text not null default 'Spin and Win'
                          check (char_length(btrim(title)) between 1 and 80),
  subtitle                text not null default 'Spin once a day for a chance to win an instant coupon.'
                          check (char_length(subtitle) <= 240),
  starts_at               timestamptz,
  ends_at                 timestamptz,
  spins_per_customer_per_day integer not null default 1
                          check (spins_per_customer_per_day >= 1 and spins_per_customer_per_day <= 10),
  terms_text              text not null default ''
                          check (char_length(terms_text) <= 4000),
  max_spins_per_ip_per_day integer not null default 1
                          check (max_spins_per_ip_per_day >= 1 and max_spins_per_ip_per_day <= 100),
  min_account_age_minutes integer not null default 0
                          check (min_account_age_minutes >= 0 and min_account_age_minutes <= 525600),
  show_on_home_page       boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              text,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

insert into spin_wheel_settings (id)
values ('default')
on conflict (id) do nothing;

alter table spin_wheel_settings enable row level security;

-- ------------------------------------------------------- wheel segments (2..12)
create table if not exists spin_wheel_segments (
  id                          text primary key,
  label                       text not null
                              check (char_length(btrim(label)) between 1 and 40),
  color_hex                   text not null
                              check (color_hex ~* '^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'),
  segment_type                text not null
                              check (segment_type in ('COUPON', 'NO_PRIZE')),
  weight                      integer not null
                              check (weight >= 1 and weight <= 10000),
  daily_cap                   integer
                              check (daily_cap is null or daily_cap > 0),
  total_cap                   integer
                              check (total_cap is null or total_cap > 0),
  total_awarded               integer not null default 0
                              check (total_awarded >= 0),
  is_active                   boolean not null default true,
  sort_order                  integer not null default 0,
  coupon_type                 text
                              check (coupon_type is null or coupon_type in ('PERCENT', 'FIXED', 'FREE_SHIPPING')),
  coupon_value                bigint not null default 0
                              check (coupon_value >= 0),
  coupon_max_discount_paise   bigint
                              check (coupon_max_discount_paise is null or coupon_max_discount_paise >= 0),
  coupon_min_order_paise      bigint not null default 0
                              check (coupon_min_order_paise >= 0),
  coupon_scope                text not null default 'ORDER'
                              check (coupon_scope in ('ORDER', 'PRODUCTS', 'CATEGORIES')),
  coupon_target_ids           text[] not null default '{}',
  coupon_valid_days           integer not null default 7
                              check (coupon_valid_days >= 1 and coupon_valid_days <= 365),
  coupon_allow_with_sale_price boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (
    segment_type = 'NO_PRIZE'
    or (coupon_type = 'FREE_SHIPPING')
    or (coupon_type = 'PERCENT' and coupon_value between 1 and 100)
    or (coupon_type = 'FIXED' and coupon_value > 0)
  )
);

create index if not exists idx_spin_wheel_segments_order
  on spin_wheel_segments (sort_order asc, id asc);

alter table spin_wheel_segments enable row level security;

-- ------------------------------------------------------- per-day segment cap ledger
create table if not exists spin_wheel_segment_daily_counts (
  segment_id    text not null references spin_wheel_segments(id) on delete cascade,
  store_day     date not null,
  awarded_count integer not null default 0 check (awarded_count >= 0),
  primary key (segment_id, store_day)
);

alter table spin_wheel_segment_daily_counts enable row level security;

-- ------------------------------------------------------- customer spin ledger
create table if not exists spin_wheel_spins (
  id                text primary key,
  user_id           text not null references users(id) on delete cascade,
  store_day         date not null,
  segment_id        text references spin_wheel_segments(id) on delete set null,
  segment_label     text not null,
  segment_type      text not null check (segment_type in ('COUPON', 'NO_PRIZE')),
  coupon_id         text references coupons(id) on delete set null,
  coupon_code       text,
  ip_hash           text not null default '',
  roll_value        integer,
  weights_snapshot  jsonb not null default '[]'::jsonb,
  terms_accepted_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (user_id, store_day)
);

create index if not exists idx_spin_wheel_spins_ip_day
  on spin_wheel_spins (store_day, ip_hash)
  where ip_hash <> '';

create index if not exists idx_spin_wheel_spins_created
  on spin_wheel_spins (created_at desc);

create index if not exists idx_spin_wheel_spins_coupon
  on spin_wheel_spins (coupon_id)
  where coupon_id is not null;

alter table spin_wheel_spins enable row level security;

-- ------------------------------------------------------- coupon origin marker
alter table coupons
  add column if not exists source text not null default 'admin';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coupons'::regclass
      and conname = 'coupons_source_check'
  ) then
    alter table coupons add constraint coupons_source_check
      check (source in ('admin', 'spin_wheel')) not valid;
  end if;
end
$$;

alter table coupons validate constraint coupons_source_check;

-- ------------------------------------------------------- spin_win notification event
do $$
declare
  event_constraint text;
begin
  for event_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'notification_outbox' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%event_key%'
  loop
    execute format('alter table notification_outbox drop constraint %I', event_constraint);
  end loop;
end
$$;

alter table notification_outbox
  add constraint notification_outbox_event_key_check
  check (event_key in (
    'order_placed', 'payment_received', 'processing', 'shipped',
    'delivered', 'cancelled', 'refund_requested', 'refund_completed',
    'back_in_stock', 'password_reset', 'staff_invite', 'low_stock',
    'payment_processing', 'payment_failed', 'waitlist_joined',
    'waitlist_invite', 'reservation_expired', 'refund_pending',
    'payment_review', 'spin_win'
  ));

insert into notification_channel_settings (id, channel, audience, topic, is_active)
select
  c.channel || ':' || a.audience || ':spin_win',
  c.channel,
  a.audience,
  'spin_win',
  case
    when c.channel = 'inapp' and a.audience = 'customer' then true
    else false
  end
from (values ('email'), ('sms'), ('inapp')) as c(channel)
cross join (values ('admin'), ('customer')) as a(audience)
on conflict (channel, audience, topic) do nothing;

