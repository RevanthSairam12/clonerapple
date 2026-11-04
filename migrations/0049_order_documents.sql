-- Phase 2: stable invoice issuance and customer-requested provisional bills.
-- Historical orders are deliberately left without issuance metadata.
alter table orders add column if not exists invoice_sequence bigint;
alter table orders add column if not exists invoice_number text;
alter table orders add column if not exists invoice_issued_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_invoice_fields_paired' and conrelid = 'orders'::regclass) then
    alter table orders add constraint orders_invoice_fields_paired check (
      (invoice_sequence is null and invoice_number is null and invoice_issued_at is null)
      or (invoice_sequence is not null and invoice_sequence > 0 and invoice_number is not null and invoice_issued_at is not null)
    );
  end if;
end $$;
create unique index if not exists orders_invoice_number_unique on orders(invoice_number) where invoice_number is not null;
create unique index if not exists orders_invoice_sequence_unique on orders(invoice_sequence) where invoice_sequence is not null;
create table if not exists invoice_number_counters (
  name text primary key check (name = 'invoice'),
  last_number bigint not null default 0 check (last_number >= 0)
);
alter table invoice_number_counters enable row level security;
insert into invoice_number_counters(name,last_number) values ('invoice',0) on conflict do nothing;
create or replace function protect_invoice_counter() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then raise exception 'invoice counter is permanent'; end if;
  if new.last_number < old.last_number or new.name <> old.name then raise exception 'invoice counter cannot decrease'; end if;
  return new;
end $$;
create or replace trigger invoice_counter_monotonic before update or delete on invoice_number_counters
for each row execute function protect_invoice_counter();
create or replace function protect_issued_invoice() returns trigger language plpgsql as $$
begin
  if old.invoice_number is not null and
     (new.invoice_number is distinct from old.invoice_number or
      new.invoice_sequence is distinct from old.invoice_sequence or
      new.invoice_issued_at is distinct from old.invoice_issued_at) then
    raise exception 'issued invoice identity is immutable';
  end if;
  return new;
end $$;
create or replace trigger orders_invoice_immutable before update on orders for each row execute function protect_issued_invoice();
create table if not exists bill_request_reasons (
  id text primary key,
  label text not null check (char_length(label) between 1 and 160),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table bill_request_reasons enable row level security;
create table if not exists bill_requests (
  id text primary key,
  order_id text not null unique references orders(id),
  user_id text not null references users(id),
  reason_id text references bill_request_reasons(id),
  reason_label text not null check (char_length(reason_label) between 1 and 160),
  other_text text not null default '' check (char_length(other_text) <= 300),
  created_at timestamptz not null default now(),
  check ((reason_id is not null and other_text = '') or (reason_id is null and char_length(other_text) between 1 and 300))
);
alter table bill_requests enable row level security;
create index if not exists bill_requests_user_time on bill_requests(user_id,created_at);
create or replace function protect_bill_request() returns trigger language plpgsql as $$
begin raise exception 'bill requests are immutable'; end $$;
create or replace trigger bill_requests_immutable before update or delete on bill_requests for each row execute function protect_bill_request();
