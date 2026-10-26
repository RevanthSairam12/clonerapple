-- 0021: Manual payment verification.
--
-- A manual payment that carries a reference (UPI, bank transfer, other) is
-- recorded as PENDING and only counts towards the order total once a second
-- staff member (or the owner) verifies it. Cash, card machine and COD entries
-- are settled at the counter and keep review_status = 'NOT_REQUIRED'.

alter table order_payments
  add column if not exists review_status text not null default 'NOT_REQUIRED';

alter table order_payments
  add column if not exists reviewed_by text references store_admins(id) on delete set null;

alter table order_payments
  add column if not exists reviewed_at timestamptz;

alter table order_payments
  add column if not exists rejection_reason text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_payments_review_status_check'
  ) then
    alter table order_payments
      add constraint order_payments_review_status_check
      check (review_status in ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REJECTED'))
      not valid;
  end if;
end
$$;

alter table order_payments validate constraint order_payments_review_status_check;

create index if not exists idx_order_payments_review_queue
  on order_payments(review_status, created_at desc)
  where review_status = 'PENDING';
