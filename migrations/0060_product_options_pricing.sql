-- 0060: One options/price/stock table, unlocked option pricing and colour photos.
-- Additive only. Existing product, variant, price and image rows are untouched.

-- The owner's "Sell by" choice drives the editor and never rewrites existing rows.
alter table products add column if not exists sell_by text not null default 'single'
  check (sell_by in ('single','colour','model','model_colour','other'));

-- An editable SKU pattern, suggested only. Saved SKUs stay immutable.
alter table products add column if not exists sku_pattern text;

-- One option price change records both the regular pair and the sale pair.
alter table price_history add column if not exists old_sale_price_paise integer;
alter table price_history add column if not exists new_sale_price_paise integer;
-- Groups the rows written by a single save so the history UI can show one change.
alter table price_history add column if not exists change_group text;
create index if not exists idx_price_history_variant
  on price_history(product_id, variant_id, changed_at desc);

-- Photos belong to the product and, optionally, to one shared colour.
-- No model owns a photo: every model in that colour shows the same photos.
alter table product_images add column if not exists colour_id text references colours(id);
create index if not exists idx_product_images_colour
  on product_images(product_id, colour_id, sort_order);
