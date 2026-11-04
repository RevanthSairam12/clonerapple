-- Additive refund initiation and terminal history. Existing RECORDED refunds
-- remain the completed ledger; no historical rows are changed.
create table if not exists refund_requests (
  id text primary key,
  order_id text not null references orders(id),
  return_id text references return_requests(id),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR',
  method text not null check (method in ('cash', 'upi', 'card_machine', 'bank_transfer', 'other')),
  reason text not null default '' check (char_length(reason) <= 300),
  note text not null default '' check (char_length(note) <= 500),
  created_by text not null references store_admins(id),
  created_at timestamptz not null default now()
);
alter table refund_requests enable row level security;
create index if not exists idx_refund_requests_order on refund_requests(order_id, created_at);
create index if not exists idx_refund_requests_return on refund_requests(return_id) where return_id is not null;

create table if not exists refund_request_events (
  request_id text primary key references refund_requests(id),
  status text not null check (status in ('COMPLETED', 'FAILED', 'REJECTED')),
  refund_id text unique references refunds(id),
  created_by text not null references store_admins(id),
  created_at timestamptz not null default now(),
  check ((status = 'COMPLETED') = (refund_id is not null))
);
alter table refund_request_events enable row level security;

create or replace function forbid_refund_lifecycle_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'refund lifecycle history is immutable';
end;
$$;
create or replace trigger refund_requests_immutable
  before update or delete on refund_requests
  for each row execute function forbid_refund_lifecycle_mutation();
create or replace trigger refund_request_events_immutable
  before update or delete on refund_request_events
  for each row execute function forbid_refund_lifecycle_mutation();

-- A completion must identify precisely the matching completed ledger row.
create or replace function validate_refund_completion() returns trigger
language plpgsql as $$
begin
  if new.status = 'COMPLETED' and not exists (
    select 1 from refund_requests q join refunds f on f.id = new.refund_id
    where q.id = new.request_id and f.order_id = q.order_id
      and f.return_id is not distinct from q.return_id
      and f.amount_paise = q.amount_paise and f.currency = q.currency
      and f.method = q.method and char_length(btrim(coalesce(f.provider_ref, ''))) between 1 and 120
  ) then
    raise exception 'refund completion must match its request and have a reference';
  end if;
  return new;
end;
$$;
create or replace trigger refund_completion_matches_request
  before insert on refund_request_events
  for each row execute function validate_refund_completion();
