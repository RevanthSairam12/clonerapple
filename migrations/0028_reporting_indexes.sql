-- 0028: Read indexes for the Reports section.
--
-- 0018 covered the overview dashboards. The reports read three shapes it did
-- not: refunds by date (transaction statement and net revenue), recorded
-- payments by creation date (the statement orders every payment and refund on
-- one timeline), and returns by order item (item-wise return rate).
--
-- Additive and idempotent. No table, column, row, policy or trigger changes, so
-- there is nothing to enable RLS on here. The runner treats this file as one
-- implicit transaction.

create index if not exists idx_refunds_report_created
  on refunds (created_at desc);

create index if not exists idx_order_payments_report_created
  on order_payments (created_at desc);

create index if not exists idx_return_items_report_order_item
  on return_items (order_item_id);

create index if not exists idx_orders_report_status_channel
  on orders (status, channel, created_at desc);
