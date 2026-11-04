/** Shared exact-key inventory projection for report screens and stock CSVs.
 * Retained parent balances are visible, but never treated as sellable variants.
 */
export const INVENTORY_REPORT_CTE = `inventory as (
  select p.id as product_id, p.slug, p.name, p.category_id, p.brand_id,
    k.variant_id, v.sku as variant_sku,
    concat_ws(' / ', dm.name, nullif(v.option_value, '')) as variant_label,
    case when k.variant_id is not null then 'variant'
      when p.inventory_mode = 'variant' then 'retained_legacy' else 'product' end as inventory_bucket,
    s.id as stock_id, s.on_hand, s.reserved, s.low_stock_threshold,
    coalesce(s.track_inventory, false) as track_inventory, s.updated_at,
    p.cost_paise, coalesce(v.price_paise_override, p.price_paise) as price_paise
  from products p
  cross join lateral (
    select null::text as variant_id
    where p.inventory_mode = 'product' or exists (
      select 1 from stock legacy where legacy.product_id = p.id and legacy.variant_id is null
    )
    union all
    select pv.id from product_variants pv
    where p.inventory_mode = 'variant' and pv.product_id = p.id
      and pv.is_purchasable and pv.is_active
  ) k
  left join product_variants v on v.id = k.variant_id and v.product_id = p.id
  left join device_models dm on dm.id = v.device_model_id
  left join stock s on s.product_id = p.id and s.variant_id is not distinct from k.variant_id
  where p.deleted_at is null
)`;

export function inventoryReportLabel(row: Record<string, unknown>): string {
  const name = String(row.name ?? '(unnamed product)');
  if (row.inventory_bucket === 'retained_legacy') return `${name} — retained legacy balance (not sellable)`;
  return row.variant_id ? `${name} — ${String(row.variant_label || row.variant_sku || row.variant_id)}` : name;
}
