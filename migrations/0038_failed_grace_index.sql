-- 0038: Index the failure-grace queue.
--
-- A failed or cancelled order keeps its claimed units for the configured grace
-- window. The reconciler now claims those rows too, so it needs an index that
-- matches the due query instead of scanning every historical failure.
-- Additive only; no row is read or rewritten here.

create index if not exists idx_orders_grace_due
  on orders(reservation_expires_at)
  where status in ('FAILED', 'CANCELLED')
    and reservation_state = 'ACTIVE';
