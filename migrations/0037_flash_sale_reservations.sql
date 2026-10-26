-- 0037: Flash-sale reservations, waiting list and payment reconciliation.
--
-- The online checkout already claims stock in the order transaction and
-- releases it through the append-only movement ledger. What it lacked was a
-- deadline: an unpaid order could hold a unit for hours. This file adds the
-- reservation window, the durable reconciliation lease, a waiting list whose
-- invitations hold stock through `stock.reserved`, and a tracked refund
-- obligation for a late capture that cannot be fulfilled.
--
-- Additive only. No existing row is rewritten and no data is removed.
-- `orders` already has row level security (0013); every new table enables RLS
-- in this same file with no policies, so only the DATABASE_URL connection
-- (the table owner) can read or write it.
--
-- Runner notes (scripts/migrate.mjs): the file runs as one implicit
-- transaction. Constraint replacements are the only rewrites.

-- ------------------------------------------------- payment status vocabulary
-- PROCESSING means "the customer may have been charged but the outcome is not
-- yet reliably known". It is deliberately distinct from FAILED: a definitive
-- failure may release stock after the grace window, while an unresolved
-- payment keeps its claim until the reconciliation window ends.

do $$
declare
  status_constraint text;
begin
  for status_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_attribute a
      on a.attrelid = t.oid and a.attname = 'status' and a.attnum = any (c.conkey)
    where t.relname = 'orders' and c.contype = 'c'
  loop
    execute format('alter table orders drop constraint %I', status_constraint);
  end loop;
end
$$;

alter table orders
  add constraint orders_status_check
  check (status in ('CREATED', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'));

-- -------------------------------------------------- reservation lifecycle
-- reservation_state is independent of the payment status:
--   NONE     legacy/POS row, no reservation window
--   ACTIVE   stock claimed, held until reservation_expires_at
--   CONSUMED payment verified, the claim became a sale
--   RELEASED a definitive failure/cancellation gave the stock back
--   EXPIRED  the window closed before payment, so the stock was given back
-- The order status still says CREATED/PENDING/PROCESSING/FAILED/CANCELLED.

alter table orders
  add column if not exists reservation_state text not null default 'NONE';
alter table orders
  add column if not exists reservation_expires_at timestamptz;
alter table orders
  add column if not exists reservation_released_at timestamptz;
alter table orders
  add column if not exists reservation_released_reason text not null default '';
alter table orders
  add column if not exists processing_deadline timestamptz;

alter table orders
  drop constraint if exists orders_reservation_state_check;
alter table orders
  add constraint orders_reservation_state_check
  check (reservation_state in ('NONE', 'ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED'));

-- Durable reconciliation lease and bounded retry bookkeeping. A worker claims
-- a due row by moving next_reconcile_at forward, so two instances cannot both
-- ask PayU about the same transaction in the same tick. A crashed worker's
-- claim becomes due again instead of being lost.
alter table orders add column if not exists reconcile_attempts integer not null default 0;
alter table orders add column if not exists consecutive_reconcile_failures integer not null default 0;
alter table orders add column if not exists next_reconcile_at timestamptz;
alter table orders add column if not exists last_reconcile_at timestamptz;
alter table orders add column if not exists last_reconcile_error text not null default '';
alter table orders add column if not exists reconciliation_flagged_at timestamptz;

create index if not exists idx_orders_reservation_due
  on orders(reservation_expires_at)
  where reservation_state = 'ACTIVE';

create index if not exists idx_orders_reconcile_due
  on orders(next_reconcile_at)
  where status in ('CREATED', 'PENDING', 'PROCESSING');

create index if not exists idx_orders_payment_processing
  on orders(created_at desc)
  where status = 'PROCESSING';

create index if not exists idx_orders_reservation_released
  on orders(reservation_released_at desc)
  where reservation_released_at is not null;

-- --------------------------------------------------------- waiting list
-- One row per customer/product request. FIFO order is (created_at, id); no
-- mutable position column can drift when an earlier entry is cancelled.
-- A customer may hold at most one ACTIVE or INVITED entry per product.

create table if not exists waiting_list_entries (
  id                    text primary key,
  product_id            text not null references products(id) on delete cascade,
  user_id               text not null references users(id) on delete cascade,
  status                text not null default 'ACTIVE'
                        check (status in ('ACTIVE', 'INVITED', 'PURCHASED', 'EXPIRED', 'CANCELLED')),
  invited_at            timestamptz,
  invitation_expires_at timestamptz,
  last_purchase_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_waiting_list_one_active
  on waiting_list_entries(product_id, user_id)
  where status in ('ACTIVE', 'INVITED');

create index if not exists idx_waiting_list_fifo
  on waiting_list_entries(product_id, created_at, id)
  where status = 'ACTIVE';

create index if not exists idx_waiting_list_user
  on waiting_list_entries(user_id, created_at desc);

-- A held invitation is exclusive stock: `stock.reserved` is raised by the same
-- transaction and released on expiry or consumed by a checkout. The token is
-- stored as a SHA-256 hash; the raw link value exists only in the message and
-- the customer's browser.
create table if not exists stock_reservations (
  id                    text primary key,
  product_id            text not null references products(id) on delete cascade,
  user_id               text not null references users(id) on delete cascade,
  waiting_list_entry_id text references waiting_list_entries(id) on delete set null,
  quantity              integer not null default 1 check (quantity > 0),
  status                text not null default 'HELD'
                        check (status in ('HELD', 'CLAIMED', 'EXPIRED', 'CANCELLED')),
  token_hash            text not null unique,
  expires_at            timestamptz not null,
  claimed_order_id      text references orders(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- At most one live invitation per product. This is the database-level guard
-- that stops two allocation workers from offering the same unit.
create unique index if not exists idx_stock_reservations_one_held
  on stock_reservations(product_id)
  where status = 'HELD';

create index if not exists idx_stock_reservations_due
  on stock_reservations(expires_at)
  where status = 'HELD';

create index if not exists idx_stock_reservations_user
  on stock_reservations(user_id, created_at desc);

alter table waiting_list_entries enable row level security;
alter table stock_reservations  enable row level security;

-- --------------------------------------------------- refund obligations
-- A verified payment can arrive after its reserved stock was released and the
-- units are gone. The order is paid (the money was taken) but cannot be
-- fulfilled. This row is the durable "a refund is owed" obligation. It stays
-- PENDING until refunds recorded against the order cover its amount, then it
-- becomes RECORDED with the last refund id. Refund rows themselves remain
-- append-only and immutable.

create table if not exists refund_obligations (
  id           text primary key,
  order_id     text not null references orders(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  reason       text not null default '' check (char_length(reason) <= 300),
  status       text not null default 'PENDING'
               check (status in ('PENDING', 'RECORDED', 'CANCELLED')),
  refund_id    text references refunds(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists idx_refund_obligations_one_pending
  on refund_obligations(order_id)
  where status = 'PENDING';

create index if not exists idx_refund_obligations_pending
  on refund_obligations(created_at)
  where status = 'PENDING';

alter table refund_obligations enable row level security;

-- ------------------------------------------------------ sale state view
-- 0023 built the view before PROCESSING existed, so an unresolved payment fell
-- through to PENDING (which reads as "awaiting payment"). Surface it as its own
-- state so the account pages can explain that the bank may have been debited.

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
  (
    select count(*)::bigint from refunds r
    where r.order_id = o.id
      and lower(coalesce(r.status::text, '')) in ('recorded', 'refunded', 'succeeded', 'success', 'completed')
  ) as refund_count,
  case
    when exists (
      select 1 from refunds r
      where r.order_id = o.id
        and lower(coalesce(r.status::text, '')) in ('recorded', 'refunded', 'succeeded', 'success', 'completed')
    ) then 'REFUNDED'
    when o.status = 'PROCESSING' then 'PROCESSING'
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
from orders o;

-- ------------------------------------------------ notification vocabulary
-- The outbox and the settings matrix both key on the topic. Replace the
-- event_key check so the new reservation, waiting-list and refund messages can
-- queue; existing rows keep passing.

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
    'payment_review'
  ));

-- New topics start with the same conservative default as the existing
-- matrix: only staff in-app is on. The one exception is the waiting-list
-- invitation email, because an invitation the customer never hears about
-- cannot be claimed. Every other channel stays a deliberate owner action.
insert into notification_channel_settings (id, channel, audience, topic, is_active)
select
  c.channel || ':' || a.audience || ':' || t.topic,
  c.channel,
  a.audience,
  t.topic,
  case
    when c.channel = 'inapp' and a.audience = 'admin' then true
    when c.channel = 'email' and a.audience = 'customer'
      and t.topic = 'waitlist_invite' then true
    else false
  end
from (values ('email'), ('sms'), ('inapp')) as c(channel)
cross join (values ('admin'), ('customer')) as a(audience)
cross join (values
  ('payment_processing'), ('payment_failed'), ('waitlist_joined'),
  ('waitlist_invite'), ('reservation_expired'), ('refund_pending'),
  ('payment_review')
) as t(topic)
on conflict (channel, audience, topic) do nothing;
