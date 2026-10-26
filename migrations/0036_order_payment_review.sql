-- 0036: Orders whose captured payment needs a human.
--
-- A verified payment can arrive after an unpaid order was cancelled or failed
-- and its stock was released. When the released units can be taken back, the
-- order continues normally. When they are gone, the payment is still recorded
-- as captured, but the order is flagged here so the owner can decide how to
-- restock or refund. No refund is issued automatically.
--
-- Additive only: every existing order starts with "no review needed". The
-- `orders` table already has row level security enabled (0013); this file adds
-- no table and no policy.

alter table orders
  add column if not exists payment_review_required boolean not null default false;

alter table orders
  add column if not exists payment_review_reason text not null default '';

alter table orders
  add column if not exists payment_reviewed_at timestamptz;

alter table orders
  add column if not exists payment_reviewed_by text references store_admins(id) on delete set null;

create index if not exists idx_orders_payment_review
  on orders(created_at desc)
  where payment_review_required;
