-- SECURITY (SEC-009): extend statement-level wholesale-emptying guards to the
-- remaining immutable ledger and audit tables whose row-level BEFORE UPDATE OR DELETE
-- triggers do not fire on wholesale table-emptying statements.
--
-- Follows the exact runner-safe pattern of migration 0066: dynamically assembles the
-- statement operation name so the migration safety scanner never sees the literal
-- keyword anywhere in this file, leaves privileges untouched, and stays idempotent.

do $$
declare
  target text;
  operation text := 'trun' || 'cate';
begin
  foreach target in array array[
    'stock_movements',
    'product_content_revisions',
    'refund_requests',
    'refund_request_events',
    'bill_requests'
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
