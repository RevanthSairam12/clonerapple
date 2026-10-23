alter table order_status_history
  add column if not exists note text;

create table if not exists order_requests (
  id          text primary key,
  order_id    text not null references orders(id) on delete cascade,
  user_id     text not null references users(id) on delete cascade,
  type        text not null,
  reason      text not null default '',
  status      text not null default 'OPEN',
  admin_note  text,
  resolved_by text references store_admins(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint order_requests_type_check check (type in ('cancel', 'return', 'help')),
  constraint order_requests_status_check check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  constraint order_requests_reason_length_check check (char_length(reason) <= 500)
);

create index if not exists idx_order_requests_status_created
  on order_requests(status, created_at desc);

create index if not exists idx_order_requests_order
  on order_requests(order_id, created_at desc);

create unique index if not exists idx_order_requests_one_open_type
  on order_requests(order_id, type)
  where status in ('OPEN', 'IN_PROGRESS');

alter table order_requests enable row level security;
