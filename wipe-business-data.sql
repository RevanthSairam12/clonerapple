-- ============================================================================
-- Gadzio — wipe business data, keep schema, config, staff logins and Storage
--
-- Scope: the 23 store-admin screens you listed.
-- Kept:  store_admins, store_admin_sessions, admin_users, admin_sessions,
--        store_admin_audit, store_media, media, content_blocks, site_settings,
--        store_settings, seo_pages, store_pages, categories, payment_methods,
--        cancellation_reasons, return_reasons, refund_reasons, bill_request_reasons,
--        order_number_counters, receipt_counters, invoice_number_counters,
--        expense_categories, schema_migrations.
--
-- Storage is not touched. The `media` bucket keeps its 8 objects.
-- `store_media` keeps its rows.
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Single transaction: any error rolls everything back.
--
-- The 61 table names appear ONCE, below. Every later step reads from that temp
-- table, so the guard, the truncate and the summary cannot drift apart.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- STEP 0 — build the list, then prove the blast radius is exactly that list.
-- ---------------------------------------------------------------------------
create temporary table _wipe_targets (t text primary key) on commit drop;
insert into _wipe_targets (t) values
  -- Sales: Orders
  ('orders'),('order_items'),('order_addresses'),('order_deliveries'),
  ('order_delivery_events'),('order_status_history'),('order_edit_logs'),('order_notes'),
  -- Sales: Requests
  ('order_requests'),('bill_requests'),
  -- Sales: Point of sale
  ('pos_shifts'),
  -- Sales: Returns & refunds
  ('return_requests'),('return_items'),('refund_requests'),('refund_request_events'),
  ('refunds'),('refund_obligations'),
  -- Sales: Payments
  ('order_payments'),('payment_events'),
  -- Catalog: Products
  ('products'),('product_variants'),('product_variant_colours'),('product_images'),
  ('product_specs'),('product_facets'),('product_attribute_values'),
  ('product_attribute_history'),('product_content_revisions'),('product_device_models'),
  ('product_reviews'),('price_history'),
  -- Catalog: Catalogue data
  ('attributes'),('attribute_options'),('brands'),('conditions'),('units'),
  ('device_brands'),('product_types'),('product_type_attributes'),('facet_defs'),
  -- Catalog: Device models
  ('device_models'),
  -- Catalog: Colours
  ('colours'),
  -- Catalog: Collections
  ('product_collections'),
  -- Catalog: Stock / Low stock
  ('stock'),('stock_movements'),('stock_reservations'),
  -- Catalog: Coupons
  ('coupons'),('coupon_targets'),('coupon_redemptions'),
  -- Catalog: Import & export
  ('catalog_imports'),('catalog_import_errors'),
  -- Customers
  ('users'),('customer_addresses'),('customer_notes'),('customer_browsing_history'),
  ('newsletter_subscribers'),
  -- Customers: User accounts
  ('user_sessions'),('user_login_events'),
  -- Customer artefacts
  ('waiting_list_entries'),
  -- Insights: Reports
  ('notification_outbox'),
  -- Insights: Expenses
  ('expenses');

do $$
declare
  missing   text;
  n_targets int;
begin
  -- Every named table must exist. A typo here would otherwise silently
  -- shrink the wipe.
  select string_agg(t, ', ') into missing
  from _wipe_targets
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'Aborted: these tables do not exist: %. Nothing was changed.', missing;
  end if;

  select count(*) into n_targets from _wipe_targets;
  if n_targets <> 61 then
    raise exception 'Aborted: expected 61 tables, the list holds %. Nothing was changed.', n_targets;
  end if;

  -- Everything that references a target must itself be a target. TRUNCATE
  -- follows every foreign key into a table being emptied, whatever its
  -- ON DELETE action, so a child outside the list is a row loss we did not
  -- ask for.
  --
  -- Only the DIRECT children are checked, and only within public. That is
  -- enough: if every direct child of a target is itself a target, then by
  -- induction every table the cascade can reach is a target.
  select string_agg(distinct ch.relname, ', ') into missing
  from pg_constraint c
  join pg_class ch      on ch.oid = c.conrelid
  join pg_namespace cn  on cn.oid = ch.relnamespace and cn.nspname = 'public'
  join pg_class p       on p.oid = c.confrelid
  join pg_namespace pn  on pn.oid = p.relnamespace and pn.nspname = 'public'
  where c.contype = 'f'
    and p.relname in (select t from _wipe_targets)
    and ch.relname not in (select t from _wipe_targets);

  if missing is not null then
    raise exception 'Aborted: these tables reference a wiped table but are not in the list: %. Nothing was changed.', missing;
  end if;

  raise notice 'Preflight passed: % tables, no out-of-scope dependants.', n_targets;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — stand down the five ledger guards.
-- 0066 installed statement-level BEFORE TRUNCATE triggers that raise on any
-- bulk empty of these tables. They are recreated byte-identically in STEP 3.
-- store_admin_audit's guard is left alone: that table is not being wiped.
-- ---------------------------------------------------------------------------
drop trigger if exists price_history_statement_guard        on public.price_history;
drop trigger if exists order_status_history_statement_guard on public.order_status_history;
drop trigger if exists order_edit_logs_statement_guard      on public.order_edit_logs;
drop trigger if exists payment_events_statement_guard       on public.payment_events;
drop trigger if exists refunds_statement_guard              on public.refunds;

-- ---------------------------------------------------------------------------
-- STEP 2 — the wipe. Table list comes from _wipe_targets.
-- No CASCADE keyword: STEP 0 proved the list is closed, so a dependency we
-- missed fails loudly instead of expanding the wipe silently.
-- RESTART IDENTITY resets surrogate ids of the emptied tables only.
-- The order / receipt / invoice counters are NOT reset; numbering continues.
-- ---------------------------------------------------------------------------
do $$
declare
  list text;
begin
  select string_agg('public.' || quote_ident(t), ', ' order by t) into list from _wipe_targets;
  execute 'truncate table ' || list || ' restart identity';
end $$;

-- ---------------------------------------------------------------------------
-- STEP 3 — restore the five guards exactly as migration 0066 defines them.
-- ---------------------------------------------------------------------------
create or replace trigger price_history_statement_guard
  before truncate on public.price_history for each statement
  execute function public.price_history_statement_guard();
create or replace trigger order_status_history_statement_guard
  before truncate on public.order_status_history for each statement
  execute function public.order_status_history_statement_guard();
create or replace trigger order_edit_logs_statement_guard
  before truncate on public.order_edit_logs for each statement
  execute function public.order_edit_logs_statement_guard();
create or replace trigger payment_events_statement_guard
  before truncate on public.payment_events for each statement
  execute function public.payment_events_statement_guard();
create or replace trigger refunds_statement_guard
  before truncate on public.refunds for each statement
  execute function public.refunds_statement_guard();

-- ---------------------------------------------------------------------------
-- STEP 4 — reset the two one-row settings screens to their defaults.
-- UPDATE/DELETE, not truncate: sale_settings must keep its row or checkout
-- throws "sale settings are temporarily unavailable".
-- ---------------------------------------------------------------------------
update public.sale_settings
   set enabled    = false,
       starts_at  = null,
       ends_at    = null,
       updated_at = now(),
       updated_by = null
 where id = 'default';

-- customer_settings falls back to compiled defaults when the rows are absent.
delete from public.customer_settings;

-- ---------------------------------------------------------------------------
-- STEP 5 — report what is now empty, and confirm the kept tables survived.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n bigint;
  total bigint := 0;
begin
  for t in select t from _wipe_targets order by t loop
    execute format('select count(*) from public.%I', t) into n;
    total := total + n;
  end loop;
  if total <> 0 then
    raise exception 'Post-wipe check failed: % rows remain in the wipe set.', total;
  end if;
  raise notice 'Wiped clean: % tables, 0 rows remaining.', (select count(*) from _wipe_targets);
  raise notice 'Kept: store_admins=%, store_media=%, store_admin_audit=%, categories=%, content_blocks=%',
    (select count(*) from public.store_admins),
    (select count(*) from public.store_media),
    (select count(*) from public.store_admin_audit),
    (select count(*) from public.categories),
    (select count(*) from public.content_blocks);
end $$;

commit;
