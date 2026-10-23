-- 0017: Store admin phase 2 — settings, offline payments, POS shifts,
-- receipt numbering and the POS order columns.
--
-- Additive only. No existing table, row, policy, function or trigger is
-- removed or replaced. The order_status_history actor list gains
-- 'store_admin' because manual payment marks, POS sales and voids are
-- recorded with that actor; existing 'payu' and 'system' values keep
-- passing, so the rewritten constraint validates cleanly.
--
-- The business is not GST-registered: there is deliberately no tax, HSN or
-- invoice object here. Receipts are plain numbered receipts titled
-- "Receipt / Bill of Supply" (that label lives in the UI, not the schema).
--
-- Runner notes (scripts/migrate.mjs):
--   * No BEGIN/COMMIT: the file runs as one implicit transaction.
--   * Additive and idempotent throughout; the only rewrite is a constraint
--     replacement via add-not-valid + validate + remove.
--   * Every new table gets row level security in this same file, with no
--     policies. Only the DATABASE_URL connection (table owner) can read or
--     write them. This does NOT touch the RLS gap on
--     users/user_sessions/orders.

-- ------------------------------------------------------------- settings

create table if not exists store_settings (
  key        text primary key,
  value      text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ payments

create table if not exists order_payments (
  id                   bigserial primary key,
  order_id             text not null references orders(id) on delete cascade,
  channel              text not null default 'online'
                       check (channel in ('online','pos','manual')),
  method               text not null
                       check (method in ('cash','upi','card_machine','bank_transfer','cod','other')),
  amount_paise         bigint not null check (amount_paise > 0),
  status               text not null default 'PENDING'
                       check (status in ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  provider_ref         text,
  paid_at              timestamptz,
  marked_paid_by       text references store_admins(id) on delete set null,
  received_by_staff_id text references store_admins(id) on delete set null,
  pos_shift_id         bigint,
  notes                text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_order_payments_order
  on order_payments(order_id, created_at, id);

create index if not exists idx_order_payments_shift
  on order_payments(pos_shift_id) where pos_shift_id is not null;

create unique index if not exists idx_order_payments_provider_ref
  on order_payments(provider_ref) where provider_ref is not null;

-- --------------------------------------------------------------- shifts

create table if not exists pos_shifts (
  id                   bigserial primary key,
  staff_id             text not null references store_admins(id),
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz,
  opening_float_paise  bigint not null default 0 check (opening_float_paise >= 0),
  expected_cash_paise  bigint,
  counted_cash_paise   bigint check (counted_cash_paise is null or counted_cash_paise >= 0),
  variance_paise       bigint,
  status               text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  notes                text not null default '',
  created_at           timestamptz not null default now()
);

-- One open shift per staff member.
create unique index if not exists idx_pos_shifts_one_open
  on pos_shifts(staff_id) where status = 'OPEN';

create index if not exists idx_pos_shifts_opened
  on pos_shifts(opened_at desc);

-- order_payments.pos_shift_id gets its foreign key now that pos_shifts exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_payments'::regclass
      and conname = 'order_payments_shift_fkey'
  ) then
    alter table order_payments add constraint order_payments_shift_fkey
      foreign key (pos_shift_id) references pos_shifts(id) not valid;
  end if;
end
$$;

alter table order_payments validate constraint order_payments_shift_fkey;

-- ------------------------------------------------------ receipt counter

-- Receipt numbers are allocated in a locked transaction (UPDATE ... RETURNING)
-- and are never reused and never reset — a voided sale leaves a gap on
-- purpose.
create table if not exists receipt_counters (
  name        text primary key,
  next_number bigint not null default 1 check (next_number > 0)
);

insert into receipt_counters (name, next_number)
values ('pos_receipt', 1)
on conflict (name) do nothing;

-- ------------------------------------------- orders: pos receipt columns

alter table orders
  add column if not exists pos_shift_id bigint,
  add column if not exists pos_receipt_no text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'orders'::regclass
      and conname = 'orders_pos_shift_fkey'
  ) then
    alter table orders add constraint orders_pos_shift_fkey
      foreign key (pos_shift_id) references pos_shifts(id) not valid;
  end if;
end
$$;

alter table orders validate constraint orders_pos_shift_fkey;

create unique index if not exists idx_orders_pos_receipt_no
  on orders(pos_receipt_no) where pos_receipt_no is not null;

create index if not exists idx_orders_pos_shift
  on orders(pos_shift_id) where pos_shift_id is not null;

-- ------------------------------------- history actor: allow store_admin

-- 0014 limited order_status_history.actor to ('payu','system'); manual
-- payment marks, POS sales and voids are written by store staff, so the
-- list gains 'store_admin'. The replacement goes in NOT VALID, is
-- validated (existing rows all pass), and only then replaces the old one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_status_history'::regclass
      and conname = 'order_status_history_actor_v2_check'
  ) then
    alter table order_status_history
      add constraint order_status_history_actor_v2_check
      check (actor in ('payu', 'system', 'store_admin')) not valid;
  end if;
end
$$;

alter table order_status_history validate constraint order_status_history_actor_v2_check;

alter table order_status_history drop constraint order_status_history_actor_check;

-- ------------------------------------------------------------- triggers

create or replace function forbid_receipt_counter_reset() returns trigger
language plpgsql as $$
begin
  if new.next_number < old.next_number then
    raise exception 'receipt counters only move forward';
  end if;
  return new;
end;
$$;

create or replace trigger receipt_counters_no_reset
  before update on receipt_counters
  for each row execute function forbid_receipt_counter_reset();

-- ------------------------------------------------------------------ RLS

alter table store_settings    enable row level security;
alter table order_payments    enable row level security;
alter table pos_shifts        enable row level security;
alter table receipt_counters  enable row level security;
