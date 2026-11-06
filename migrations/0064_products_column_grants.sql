-- SECURITY (M-2): the public SELECT policy on `products` is row-level only, so
-- the publishable key could read every display column and also `cost_paise`
-- (the shop's purchase cost), `updated_by`, `compatibility_reviewed_at`,
-- `catalog_revision` and `sku_pattern`.
--
-- Replace the table-wide grant with a column grant for the storefront fields.
-- The app never reads `products` through PostgREST (content_blocks and
-- site_settings are the only public reads), so nothing in the storefront
-- depends on the withheld columns. Idempotent: revoking first makes a re-run
-- converge on exactly this list.

do $$
begin
  if to_regclass('public.products') is not null then
    execute 'revoke select on public.products from anon, authenticated';
    execute 'grant select (
      id, category_id, slug, name, subtitle, price_paise, compare_at_paise,
      currency, material, brand, description, badge, highlights, in_the_box,
      seo_title, seo_description, in_stock, is_active, sort_order, created_at,
      updated_at, deleted_at, brand_id, condition_id, sale_price_paise,
      product_type_id, inventory_mode, short_description, description_sections,
      sell_by
    ) on public.products to anon, authenticated';
  end if;
end $$;
