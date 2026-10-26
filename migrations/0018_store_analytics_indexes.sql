-- 0018: Read indexes for the Store Desk overview dashboards.
--
-- The dashboards group paid orders by day/month, split them by channel and
-- payment method, and roll order items up by product and category. The
-- existing indexes cover txnid and status+created_at; these add the windows
-- the analytics layer actually reads.
--
-- Additive and idempotent. No table, column, row, policy or trigger changes,
-- so there is nothing to enable RLS on here. The runner treats this file as
-- one implicit transaction.

-- Paid-order windows (revenue, order counts, transactions by status).
create index if not exists idx_orders_analytics_created
  on orders (created_at desc);

create index if not exists idx_orders_analytics_paid_at
  on orders (paid_at)
  where paid_at is not null;

create index if not exists idx_orders_analytics_status_created
  on orders (status, created_at desc);

-- Customer aggregation: a buyer's history is read newest first.
create index if not exists idx_orders_analytics_customer
  on orders (customer_email, created_at desc);

create index if not exists idx_orders_analytics_user_created
  on orders (user_id, created_at desc)
  where user_id is not null;

-- Product and category roll-ups.
create index if not exists idx_order_items_analytics_product
  on order_items (product_id);

-- New-customer and session windows on the users tab.
create index if not exists idx_users_analytics_created
  on users (created_at desc);

create index if not exists idx_user_sessions_analytics_created
  on user_sessions (created_at desc);

-- POS and manual payments are reported by their paid timestamp.
create index if not exists idx_order_payments_analytics_paid
  on order_payments (paid_at)
  where status = 'PAID';
