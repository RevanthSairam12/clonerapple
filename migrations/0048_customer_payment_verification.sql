-- Explicit attribution for owner-initiated gateway checks.
-- Existing timeline rows, append-only trigger and RLS remain unchanged.
alter table payment_events drop constraint if exists payment_events_source_check;
alter table payment_events add constraint payment_events_source_check
  check (source in ('redirect', 'webhook', 'reconcile', 'admin', 'customer'));
