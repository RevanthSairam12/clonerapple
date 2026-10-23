alter table orders
  add column if not exists channel text default 'web',
  add column if not exists fulfilment_status text default 'PENDING',
  add column if not exists scheduled_for timestamptz,
  add column if not exists delivery_slot text,
  add column if not exists payment_method text,
  add column if not exists subtotal_paise bigint default 0,
  add column if not exists discount_paise bigint default 0,
  add column if not exists shipping_paise bigint default 0,
  add column if not exists total_paise bigint,
  add column if not exists coupon_code text,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists staff_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

update orders
set
  channel = coalesce(channel, 'web'),
  fulfilment_status = coalesce(fulfilment_status, 'PENDING'),
  subtotal_paise = coalesce(subtotal_paise, round(amount * 100)::bigint),
  discount_paise = coalesce(discount_paise, 0),
  shipping_paise = coalesce(shipping_paise, 0),
  total_paise = coalesce(total_paise, round(amount * 100)::bigint);

create table if not exists order_items (
  id                bigserial primary key,
  order_id          text not null references orders(id) on delete cascade,
  line_number       integer not null,
  product_id        text not null default '',
  product_name      text not null default '',
  quantity          integer not null default 1,
  unit_price_paise  bigint not null default 0,
  line_total_paise  bigint not null default 0,
  currency          text not null default 'INR',
  created_at        timestamptz not null default now(),
  unique (order_id, line_number)
);

create index if not exists idx_order_items_order
  on order_items(order_id, line_number);

create table if not exists order_status_history (
  id            bigserial primary key,
  order_id      text not null references orders(id) on delete cascade,
  domain        text not null default 'payment',
  actor         text not null default 'system',
  from_status   text,
  to_status     text not null,
  payu_mihpayid text,
  payu_mode     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_order_status_history_order
  on order_status_history(order_id, created_at, id);

create or replace function forbid_order_status_history_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'order status history rows are immutable';
end;
$$;

create or replace trigger order_status_history_immutable
  before update or delete on order_status_history
  for each row execute function forbid_order_status_history_mutation();

create table if not exists order_addresses (
  id            bigserial primary key,
  order_id      text not null references orders(id) on delete cascade,
  address_type  text not null default 'shipping',
  full_name     text not null default '',
  phone         text not null default '',
  line1         text not null default '',
  line2         text,
  city          text not null default '',
  state         text not null default '',
  postal_code   text not null default '',
  country       text not null default 'IN',
  created_at    timestamptz not null default now(),
  unique (order_id, address_type)
);

create index if not exists idx_order_addresses_order
  on order_addresses(order_id);

create table if not exists order_deliveries (
  id                bigserial primary key,
  order_id          text not null unique references orders(id) on delete cascade,
  status            text not null default 'PENDING',
  delivery_method   text,
  person_name       text,
  person_phone      text,
  courier_name      text,
  carrier           text,
  tracking_number   text,
  tracking_url      text,
  scheduled_for     timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table order_deliveries
  add column if not exists delivery_method text,
  add column if not exists person_name text,
  add column if not exists person_phone text,
  add column if not exists courier_name text,
  add column if not exists tracking_url text;

create index if not exists idx_order_deliveries_status
  on order_deliveries(status, scheduled_for);

create table if not exists order_delivery_events (
  id            bigserial primary key,
  delivery_id   bigint not null references order_deliveries(id) on delete cascade,
  event_type    text not null,
  status        text,
  event_at      timestamptz not null default now(),
  details       jsonb not null default '{}'::jsonb
);

create index if not exists idx_order_delivery_events_delivery
  on order_delivery_events(delivery_id, event_at, id);

alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table order_addresses enable row level security;
alter table order_deliveries enable row level security;
alter table order_delivery_events enable row level security;

insert into order_items (
  order_id,
  line_number,
  product_id,
  product_name,
  quantity,
  unit_price_paise,
  line_total_paise,
  currency,
  created_at
)
select
  o.id,
  line.line_number::integer,
  coalesce(line.item->>'id', ''),
  coalesce(line.item->>'name', ''),
  case
    when line.item->>'quantity' ~ '^[0-9]+$'
      then greatest((line.item->>'quantity')::integer, 1)
    else 1
  end,
  case
    when line.item->>'unitPrice' ~ '^[0-9]+(\.[0-9]+)?$'
      then round((line.item->>'unitPrice')::numeric * 100)::bigint
    else 0
  end,
  case
    when line.item->>'totalPrice' ~ '^[0-9]+(\.[0-9]+)?$'
      then round((line.item->>'totalPrice')::numeric * 100)::bigint
    else 0
  end,
  coalesce(o.currency, 'INR'),
  coalesce(o.created_at, now())
from orders o
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
) with ordinality as line(item, line_number)
on conflict (order_id, line_number) do nothing;

insert into order_status_history (
  order_id,
  domain,
  actor,
  from_status,
  to_status,
  created_at
)
select
  o.id,
  'payment',
  'system',
  null,
  o.status,
  coalesce(o.updated_at, o.created_at, now())
from orders o
where not exists (
  select 1
  from order_status_history h
  where h.order_id = o.id
    and h.domain = 'payment'
    and h.from_status is null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'orders'::regclass and conname = 'orders_channel_check'
  ) then
    alter table orders add constraint orders_channel_check
      check (channel in ('web', 'pos')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'orders'::regclass and conname = 'orders_fulfilment_status_check'
  ) then
    alter table orders add constraint orders_fulfilment_status_check
      check (fulfilment_status in ('PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED', 'CANCELED')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'orders'::regclass and conname = 'orders_paise_nonnegative_check'
  ) then
    alter table orders add constraint orders_paise_nonnegative_check
      check (
        (subtotal_paise is null or subtotal_paise >= 0)
        and (discount_paise is null or discount_paise >= 0)
        and (shipping_paise is null or shipping_paise >= 0)
        and (total_paise is null or total_paise >= 0)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_items'::regclass and conname = 'order_items_quantity_check'
  ) then
    alter table order_items add constraint order_items_quantity_check
      check (quantity > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_items'::regclass and conname = 'order_items_paise_check'
  ) then
    alter table order_items add constraint order_items_paise_check
      check (unit_price_paise >= 0 and line_total_paise >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_status_history'::regclass and conname = 'order_status_history_actor_check'
  ) then
    alter table order_status_history add constraint order_status_history_actor_check
      check (actor in ('payu', 'system')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_addresses'::regclass and conname = 'order_addresses_type_check'
  ) then
    alter table order_addresses add constraint order_addresses_type_check
      check (address_type in ('billing', 'shipping')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'orders'::regclass and conname = 'orders_delivery_slot_check'
  ) then
    alter table orders add constraint orders_delivery_slot_check
      check (delivery_slot is null or delivery_slot in ('10:00-13:00', '13:00-17:00', '17:00-20:00')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_deliveries'::regclass and conname = 'order_deliveries_method_check'
  ) then
    alter table order_deliveries add constraint order_deliveries_method_check
      check (delivery_method is null or delivery_method in ('self', 'courier')) not valid;
  end if;
end
$$;

alter table orders validate constraint orders_channel_check;
alter table orders validate constraint orders_fulfilment_status_check;
alter table orders validate constraint orders_paise_nonnegative_check;
alter table order_items validate constraint order_items_quantity_check;
alter table order_items validate constraint order_items_paise_check;
alter table order_status_history validate constraint order_status_history_actor_check;
alter table order_addresses validate constraint order_addresses_type_check;
alter table orders validate constraint orders_delivery_slot_check;
alter table order_deliveries validate constraint order_deliveries_method_check;

do $refund_view$
declare
  refund_predicate text := 'false';
  refund_count text := '0::bigint';
  has_order_id boolean;
  has_status boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refunds'
      and column_name = 'order_id'
  ) into has_order_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'refunds'
      and column_name = 'status'
  ) into has_status;

  if to_regclass('public.refunds') is not null and has_order_id then
    if has_status then
      refund_predicate := $sql$exists (
        select 1 from public.refunds r
        where r.order_id = o.id
          and lower(coalesce(r.status::text, '')) in ('refunded', 'succeeded', 'success', 'completed')
      )$sql$;
      refund_count := $sql$(
        select count(*)::bigint from public.refunds r
        where r.order_id = o.id
          and lower(coalesce(r.status::text, '')) in ('refunded', 'succeeded', 'success', 'completed')
      )$sql$;
    else
      refund_predicate := $sql$exists (
        select 1 from public.refunds r where r.order_id = o.id
      )$sql$;
      refund_count := $sql$(
        select count(*)::bigint from public.refunds r where r.order_id = o.id
      )$sql$;
    end if;
  end if;

  execute format($view$
    create or replace view order_sale_state as
    select
      o.id,
      o.txnid,
      o.user_id,
      o.items,
      o.amount,
      o.currency,
      o.status,
      o.channel,
      o.fulfilment_status,
      o.scheduled_for,
      o.delivery_slot,
      o.payment_method,
      o.subtotal_paise,
      o.discount_paise,
      o.shipping_paise,
      o.total_paise,
      o.coupon_code,
      o.pricing_snapshot,
      o.staff_id,
      o.cancelled_at,
      o.cancel_reason,
      %s as refund_count,
      case
        when %s then 'REFUNDED'
        when o.status = 'FAILED' then 'PAYMENT_FAILED'
        when o.status = 'CANCELLED' or o.fulfilment_status = 'CANCELED' then 'CANCELED'
        when o.fulfilment_status = 'DELIVERED' then 'DELIVERED'
        when o.fulfilment_status = 'ON_THE_WAY' then 'ON_THE_WAY'
        when o.fulfilment_status = 'PROCESSING' then 'PROCESSING'
        when o.scheduled_for is not null
          and o.fulfilment_status in ('PENDING', 'ACCEPTED') then 'SCHEDULED'
        when o.fulfilment_status = 'ACCEPTED' then 'ACCEPTED'
        else 'PENDING'
      end as sale_state,
      o.created_at,
      o.updated_at,
      o.paid_at
    from orders o
  $view$, refund_count, refund_predicate);
end
$refund_view$;
