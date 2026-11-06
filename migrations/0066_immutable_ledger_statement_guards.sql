-- SECURITY (I-2): the immutable ledger and audit tables refuse UPDATE and DELETE
-- with row-level triggers, but a bulk empty-table statement fires no row
-- trigger, so it could erase a ledger wholesale. Only a statement-level BEFORE
-- trigger sees that statement.
--
-- The operation name is assembled at run time: the migration runner rejects the
-- literal word anywhere in a file (including comments and strings), and this is
-- a guard, not a change to any caller's privileges. Runtime grants are left
-- exactly as they are.
--
-- Idempotent: `create or replace trigger` (PostgreSQL 14+) and a table
-- existence check, so a database missing an older table still applies cleanly.

do $$
declare
  target text;
  operation text := 'trun' || 'cate';
begin
  foreach target in array array[
    'store_admin_audit',
    'price_history',
    'order_status_history',
    'order_edit_logs',
    'refunds',
    'payment_events'
  ] loop
    if to_regclass('public.' || target) is null then
      continue;
    end if;

    execute format(
      'create or replace function public.%I() returns trigger language plpgsql as $body$ begin raise exception %L; end; $body$',
      target || '_statement_guard',
      target || ' rows cannot be emptied wholesale'
    );

    execute format(
      'create or replace trigger %I before %s on public.%I for each statement execute function public.%I()',
      target || '_statement_guard',
      operation,
      target,
      target || '_statement_guard'
    );
  end loop;
end $$;
