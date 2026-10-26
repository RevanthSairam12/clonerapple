-- 0023: Returns, refunds and cancellation reasons.
--
-- Refunds are recorded manually — there is no PayU refund API call. A refund
-- row is append-only; corrections are made by recording another row, never by
-- editing history. Return requests carry the RMA workflow
-- (REQUESTED → APPROVED → RECEIVED → REFUNDED, or REJECTED / CANCELLED).
--
-- Stock restock happens on RECEIVED and writes stock_movements with reason
-- 'return'. Only tracked products move.

-- ----------------------------------------------------- cancellation reasons
create table if not exists cancellation_reasons (
  id         text primary key,
  label      text not null check (char_length(label) between 1 and 120),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into cancellation_reasons (id, label, sort_order) values
  ('cancel_customer_request', 'Customer asked to cancel', 10),
  ('cancel_out_of_stock', 'Item out of stock', 20),
  ('cancel_payment_failed', 'Payment failed', 30),
  ('cancel_address', 'Delivery address not serviceable', 40),
  ('cancel_duplicate', 'Duplicate order', 50),
  ('cancel_other', 'Other', 90)
on conflict (id) do nothing;

-- --------------------------------------------------------- return requests
create table if not exists return_requests (
  id            text primary key,
  order_id      text not null references orders(id) on delete cascade,
  request_id    text references order_requests(id) on delete set null,
  status        text not null default 'REQUESTED'
                check (status in ('REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'CANCELLED')),
  reason        text not null default '' check (char_length(reason) <= 300),
  customer_note text not null default '' check (char_length(customer_note) <= 1000),
  staff_note    text not null default '' check (char_length(staff_note) <= 1000),
  source        text not null default 'staff' check (source in ('staff', 'customer')),
  created_by    text references store_admins(id) on delete set null,
  decided_by    text references store_admins(id) on delete set null,
  decided_at    timestamptz,
  received_by   text references store_admins(id) on delete set null,
  received_at   timestamptz,
  refunded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_return_requests_status
  on return_requests(status, created_at desc);
create index if not exists idx_return_requests_order
  on return_requests(order_id, created_at desc);

create table if not exists return_items (
  id                bigserial primary key,
  return_id         text not null references return_requests(id) on delete cascade,
  order_item_id     bigint not null references order_items(id) on delete cascade,
  quantity          integer not null check (quantity > 0),
  condition_grade   text not null default 'RESELLABLE'
                    check (condition_grade in ('RESELLABLE', 'OPENED', 'DAMAGED', 'DEFECTIVE')),
  restock           boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (return_id, order_item_id)
);

create index if not exists idx_return_items_return
  on return_items(return_id);

-- ---------------------------------------------------------------- refunds
create table if not exists refunds (
  id           text primary key,
  order_id     text not null references orders(id) on delete cascade,
  return_id    text references return_requests(id) on delete set null,
  amount_paise bigint not null check (amount_paise > 0),
  currency     text not null default 'INR',
  method       text not null
               check (method in ('cash', 'upi', 'card_machine', 'bank_transfer', 'other')),
  provider_ref text,
  reason       text not null default '' check (char_length(reason) <= 300),
  note         text not null default '' check (char_length(note) <= 500),
  status       text not null default 'RECORDED' check (status in ('RECORDED')),
  recorded_by  text references store_admins(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_refunds_order
  on refunds(order_id, created_at desc);
create index if not exists idx_refunds_return
  on refunds(return_id) where return_id is not null;

create or replace function forbid_refund_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'refund rows are immutable';
end;
$$;

create or replace trigger refunds_immutable
  before update or delete on refunds
  for each row execute function forbid_refund_mutation();

-- ------------------------------------------------- cancellation provenance
alter table orders
  add column if not exists cancellation_reason_id text
    references cancellation_reasons(id) on delete set null;
alter table orders
  add column if not exists cancelled_by text
    references store_admins(id) on delete set null;

-- ---------------------------------------------- sale state sees the refunds
-- 0014 built order_sale_state before refunds existed, so its refund predicate
-- was baked in as false. Recreate the same column list with the recorded-refund
-- predicate now that the table is real.
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

-- ---------------------------------------------------------------------- RLS
alter table cancellation_reasons enable row level security;
alter table return_requests      enable row level security;
alter table return_items         enable row level security;
alter table refunds              enable row level security;
