-- 0020: Immutable order edit log.
--
-- Every change to the customer contact block or the shipping address writes one
-- row here. The before/after snapshots are masked at write time (the audit
-- policy applies to this table too), and a trigger refuses any later update or
-- delete, so the history cannot be rewritten.

create table if not exists order_edit_logs (
  id             bigserial primary key,
  order_id       text not null references orders(id) on delete cascade,
  actor_id       text references store_admins(id) on delete set null,
  actor_email    text not null default '',
  changed_fields text[] not null default '{}',
  before         jsonb not null default '{}'::jsonb,
  after          jsonb not null default '{}'::jsonb,
  reason         text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists idx_order_edit_logs_order
  on order_edit_logs(order_id, created_at desc);

alter table order_edit_logs enable row level security;

create or replace function forbid_order_edit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'order edit rows are immutable';
end;
$$;

create or replace trigger order_edit_logs_immutable
  before update or delete on order_edit_logs
  for each row execute function forbid_order_edit_mutation();
