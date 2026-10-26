-- 0034_store_order_settings.sql
-- Checkout obeys Store Admin order settings: a transactional order-number
-- counter, the allocated number kept on the order row, and an explicit
-- 'release' stock movement so a failed or cancelled checkout can give a claim
-- back exactly once.
--
-- RLS is enabled on the new table in this file. Existing tables gain only
-- additive columns, indexes and constraint definitions; no order is
-- renumbered and no historical row is rewritten.

create table if not exists order_number_counters (
  name        text primary key,
  next_number bigint not null default 1 check (next_number > 0),
  updated_at  timestamptz not null default now()
);

alter table order_number_counters enable row level security;

insert into order_number_counters (name, next_number)
values ('order', 1)
on conflict (name) do nothing;

create or replace function forbid_order_number_counter_reset() returns trigger
language plpgsql as $$
begin
  if new.next_number < old.next_number then
    raise exception 'order number counters only move forward';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger order_number_counters_no_reset
  before update on order_number_counters
  for each row execute function forbid_order_number_counter_reset();

-- Allocated only when numbering is usable; legacy and historical rows stay
-- NULL so every old id resolves unchanged.
alter table orders add column if not exists order_number bigint;

create unique index if not exists idx_orders_order_number
  on orders(order_number) where order_number is not null;

create index if not exists idx_stock_movements_order
  on stock_movements(order_id) where order_id is not null;

-- stock_movements lists the allowed reasons inline. Replace that check with
-- one that also accepts 'release': the append-only movement written when a
-- claimed checkout is cancelled, failed or expired before payment.
do $$
declare
  reason_constraint text;
begin
  for reason_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'stock_movements'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%reason%'
  loop
    execute format('alter table stock_movements drop constraint %I', reason_constraint);
  end loop;
end
$$;

alter table stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('seed','receipt','sale','return','adjustment','damage','release'));
