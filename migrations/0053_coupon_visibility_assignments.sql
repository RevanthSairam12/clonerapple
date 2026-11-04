-- Coupon discovery is independent of redemption restrictions.
-- Existing and new coupons are hidden until staff explicitly publish or assign.
-- Reapplying preserves deliberate visibility/assignment changes. Coupon RLS is
-- already enabled by 0041; no policies or eligibility fields change here.
alter table coupons
  add column if not exists show_to_all_users boolean not null default false,
  add column if not exists assigned_to_emails text[] not null default '{}',
  add column if not exists assigned_customer_groups text[] not null default '{}';
