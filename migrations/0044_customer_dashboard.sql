-- 0044: Customer dashboard features — browsing history, notifications link, and account preferences.
--
-- RLS is enabled on new tables with NO public policies (DATABASE_URL server access only).
--
-- 1. Browsing history: capped at 50 products per customer, pruned after 90 days.
create table if not exists customer_browsing_history (
  id              text primary key,
  user_id         text not null references users(id) on delete cascade,
  product_id      text not null,
  view_count      integer not null default 1 check (view_count > 0),
  last_viewed_at  timestamptz not null default now(),
  constraint uq_customer_browsing_history unique (user_id, product_id)
);

create index if not exists idx_customer_browsing_history_user
  on customer_browsing_history(user_id, last_viewed_at desc);

alter table customer_browsing_history enable row level security;

-- 2. Customer preferences and password/export timestamps on users
alter table users
  add column if not exists save_browsing_history boolean not null default true,
  add column if not exists password_changed_at timestamptz,
  add column if not exists last_data_export_at timestamptz;

-- 3. Customer destination columns on notification_outbox
alter table notification_outbox
  add column if not exists customer_user_id text references users(id) on delete set null,
  add column if not exists read_at timestamptz;

create index if not exists idx_notification_outbox_customer
  on notification_outbox(customer_user_id, created_at desc)
  where customer_user_id is not null;
