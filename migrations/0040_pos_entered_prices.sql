-- 0040: Keep the catalogue price next to the price entered at the till.
--
-- A POS sale now charges the price a store admin or owner typed for each
-- line. `order_items.unit_price_paise` already stores what was charged;
-- `reference_price_paise` records the regular catalogue price at that moment
-- for comparison only. The storefront, the sale resolver and online checkout
-- never read this column.
--
-- Additive only: existing rows keep a null reference price, so a historic line
-- is not backfilled with today's catalogue price. `order_items` already has
-- RLS enabled in migration 0014; this file does not change it.

alter table order_items
  add column if not exists reference_price_paise bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'order_items'::regclass
      and conname = 'order_items_reference_price_check'
  ) then
    alter table order_items add constraint order_items_reference_price_check
      check (reference_price_paise is null or reference_price_paise >= 0) not valid;
  end if;
end
$$;

alter table order_items validate constraint order_items_reference_price_check;
