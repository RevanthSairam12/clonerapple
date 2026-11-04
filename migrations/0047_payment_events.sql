-- 0047: Payment event timeline and one-payment-per-gateway-id.
--
-- Two additive changes, both needed by the PayU Phase 1 work:
--
--   * `orders.payu_mihpayid` gets a partial unique index. A gateway payment id
--     (mihpayid) may only ever attach to one order, so a replayed or forged
--     callback cannot mark a second order paid with the same capture. The
--     index is partial because most orders legitimately have no mihpayid.
--
--   * `payment_events` records every callback decision (browser return, PayU
--     webhook, reconciler tick, staff verification) as an append-only row so
--     Store Admin can show a Payment timeline. Only sanitised fields are
--     stored: never a raw PayU payload, card data, secret or customer detail.
--     The table is immutable at the database level, like store_admin_audit.
--
-- No existing data is rewritten. RLS is enabled with no policies, matching the
-- rule that a new table ships with RLS in its own migration file.

create unique index if not exists idx_orders_mihpayid_unique
  on orders (payu_mihpayid)
  where payu_mihpayid is not null;

create table if not exists payment_events (
  id           bigserial primary key,
  order_id     text not null references orders(id) on delete cascade,
  txnid        text not null,
  -- redirect | webhook | reconcile | admin
  source       text not null check (source in ('redirect', 'webhook', 'reconcile', 'admin')),
  -- Raw PayU status / unmappedstatus pair, lowercased. No PII.
  payu_status  text not null default '',
  -- What the server decided: paid, failed, cancelled, pending, processing,
  -- unchanged, rejected.
  outcome      text not null,
  reason       text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists idx_payment_events_order
  on payment_events (order_id, created_at desc, id desc);

create index if not exists idx_payment_events_txnid
  on payment_events (txnid, created_at desc);

create or replace function forbid_payment_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'payment events are immutable';
end;
$$;

drop trigger if exists payment_events_immutable on payment_events;
create trigger payment_events_immutable
  before update or delete on payment_events
  for each row execute function forbid_payment_event_mutation();

alter table payment_events enable row level security;
