-- SECURITY (H-1): `order_sale_state` was created without `security_invoker`, so
-- the view ran with its owner's rights and bypassed the RLS enabled on
-- `orders` in 0013. Anything holding the publishable key could read every
-- order through PostgREST. The view is only read by server-side code on the
-- DATABASE_URL connection (src/lib/account/orders.ts, src/lib/order-status.ts,
-- src/lib/store-admin/*), which connects as the table owner and is unaffected.
--
-- Run the view as the caller and remove the public grant. Idempotent: both
-- statements are no-ops when re-applied, and the block skips a database where
-- the view was never created.

do $$
begin
  if to_regclass('public.order_sale_state') is not null then
    execute 'alter view public.order_sale_state set (security_invoker = true)';
    execute 'revoke all on public.order_sale_state from anon, authenticated';
  end if;
end $$;
