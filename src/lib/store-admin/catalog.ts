import { getSql } from '@/lib/platform/db';
import { readCatalogRevision } from './catalog-revision';
import type { SellBy } from './options-table-rules';
import { priceHistoryIsCleared } from './price-history-rules';

/**
 * Read-only catalogue queries for the store admin.
 *
 * The store admin connects with DATABASE_URL (the table owner), which is
 * allowed to see price_history and stock even though RLS gives anon and
 * authenticated no policy on those tables.
 *
 * Nothing in this module writes. Checkout reads prices from the database, so
 * the editor can change them; every write lives in `catalog-crud.ts` and
 * `product-draft.ts`, both of which append history and an audit row.
 */

export type CatalogLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

export interface CatalogCategorySummary {
  id: string;
  slug: string;
  name: string;
  title: string;
  isActive: boolean;
  productCount: number;
}

export interface CatalogProductSummary {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  pricePaise: number;
  /** Stored sale price. Applies only while sale mode is live. */
  salePricePaise: number | null;
  currency: string;
  isActive: boolean;
  inStock: boolean;
  /** Null for missing stock; overviews also use null for mixed stock limits. */
  trackInventory: boolean | null;
  /** All existing options, including inactive/display-only rows in the editor. */
  optionCount?: number;
  inventoryMode?: 'product' | 'variant';
  /** Sellable units after reservations, only when every stock row is limited. */
  available?: number | null;
  stockStatus?: 'limited' | 'unlimited' | 'missing' | 'mixed';
  sortOrder: number;
  updatedAt: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
}

export interface CatalogFacet {
  key: string;
  value: string;
  sortOrder: number;
}

export interface CatalogSpec {
  label: string;
  value: string;
  sortOrder: number;
}

export interface CatalogImage {
  id: string;
  url: string;
  alt: string;
  role: string;
  sortOrder: number;
  isActive: boolean;
  /**
   * The shared colour this photo belongs to; null is the product's default
   * gallery. Every model in that colour shows the same photos.
   */
  colourId: string | null;
  /** Set when the image was archived; archived rows are restorable. */
  deletedAt: string | null;
}

export interface CatalogVariant {
  id: string;
  sku: string | null;
  optionName: string;
  optionValue: string;
  optionHex: string | null;
  pricePaiseOverride: number | null;
  salePricePaise: number | null;
  isPurchasable: boolean;
  deviceModelId: string | null;
  combinationKey: string | null;
  optionIdentity?: string | null;
  retiredAt?: string | null;
  stock: CatalogStockRow | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CatalogPriceHistoryRow {
  id: number;
  /** Null for the product's own base price; set for an option price. */
  variantId: string | null;
  oldPricePaise: number | null;
  newPricePaise: number;
  /** Paired sale values recorded with the same change, when one existed. */
  oldSalePricePaise: number | null;
  newSalePricePaise: number | null;
  /** Rows written by one save share a change group so the UI shows one change. */
  changeGroup: string | null;
  /** `regular`, `sale` or `sale_cleared` — which price the row records. */
  priceKind: string;
  /** True when the row removes a sale; `newPricePaise` is then a 0 sentinel, not a price. */
  cleared: boolean;
  currency: string;
  source: string;
  reason: string;
  changedBy: string | null;
  changedAt: string;
}

export interface CatalogStockRow {
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  updatedAt: string;
}

export interface CatalogProductAttributeValue {
  attributeId: string;
  key: string;
  label: string;
  dataType: string;
  unitLabel: string | null;
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
  optionValue: string | null;
}

export interface CatalogProductDetail extends CatalogProductSummary {
  /** Opaque bounded edit token; inventory balances do not advance it. */
  catalogRevision: number;
  inventoryMode: 'product' | 'variant';
  /** Which option the owner chose to sell by. Never rewrites saved rows. */
  sellBy: SellBy;
  /** Editable SKU suggestion pattern; null uses the default. */
  skuPattern: string | null;
  deviceModels: Array<{id:string;name:string;isActive?:boolean}>;
  /** Every shared colour the editor can attach to an option row or a photo. */
  colours: Array<{id:string;name:string;hex:string;isActive?:boolean}>;
  description: string;
  shortDescription: string | null;
  descriptionSections: unknown;
  material: string;
  brand: string;
  brandId: string | null;
  compareAtPaise: number | null;
  /** Internal unit cost for stock valuation; null when it has never been set. */
  costPaise: number | null;
  conditionId: string | null;
  conditionLabel: string | null;
  badge: string | null;
  highlights: Array<{ title: string; desc: string }>;
  inTheBox: string[];
  seoTitle: string;
  seoDescription: string;
  createdAt: string;
  facets: CatalogFacet[];
  specs: CatalogSpec[];
  images: CatalogImage[];
  variants: CatalogVariant[];
  attributeValues: CatalogProductAttributeValue[];
  priceHistory: CatalogPriceHistoryRow[];
  stock: CatalogStockRow | null;
}

export interface CatalogCategoryOption {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

export interface CatalogBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
  deletedAt: string | null;
}

export interface CatalogUnit {
  id: string;
  code: string;
  label: string;
  dimension: string;
  baseCode: string | null;
  factor: number;
  attributeCount: number;
}

export interface CatalogAttributeOption {
  value: string;
  sortOrder: number;
}

export interface CatalogAttribute {
  id: string;
  key: string;
  label: string;
  dataType: string;
  unitId: string | null;
  unitLabel: string | null;
  isFilterable: boolean;
  isVariantOption: boolean;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
  options: CatalogAttributeOption[];
  productCount: number;
}

export interface CatalogLowStockRow {
  variantId: string|null;
  variantSku: string|null;
  productId: string;
  slug: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  updatedAt: string;
}

export interface CatalogLowStockSummary {
  rows: CatalogLowStockRow[];
  /** Products whose stock is actually gated at checkout. */
  trackedCount: number;
  lowCount: number;
}

export interface CatalogOverview {
  categories: CatalogCategorySummary[];
  products: CatalogProductSummary[];
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

function highlightList(value: unknown): Array<{ title: string; desc: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = (item ?? {}) as Row;
    return { title: text(record.title), desc: text(record.desc) };
  });
}

/** Shared image row mapper: read paths and write paths return the same shape. */
function sellByOf(value: unknown): SellBy {
  const raw = text(value);
  return raw === 'colour' || raw === 'model' || raw === 'model_colour' || raw === 'other' ? raw : 'single';
}

export function mapImageRow(row: Row): CatalogImage {
  return {
    id: text(row.id),
    url: text(row.url),
    alt: text(row.alt),
    role: text(row.role),
    sortOrder: number(row.sort_order),
    colourId: row.colour_id === null || row.colour_id === undefined ? null : text(row.colour_id),
    isActive: Boolean(row.is_active),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : iso(row.deleted_at),
  };
}

function mapSummary(row: Row): CatalogProductSummary {
  return {
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name),
    subtitle: text(row.subtitle),
    pricePaise: number(row.price_paise),
    salePricePaise: nullableNumber(row.sale_price_paise),
    currency: text(row.currency) || 'INR',
    isActive: Boolean(row.is_active),
    inStock: Boolean(row.in_stock),
    trackInventory:
      row.track_inventory === null || row.track_inventory === undefined
        ? null
        : Boolean(row.track_inventory),
    sortOrder: number(row.sort_order),
    updatedAt: iso(row.updated_at),
    categoryId: text(row.category_id),
    categorySlug: text(row.category_slug),
    categoryName: text(row.category_name),
  };
}

/** Map the overview's single-row stock aggregate without changing detail DTOs. */
export function mapCatalogOverviewProduct(row: Row): CatalogProductSummary {
  const inventoryMode = row.inventory_mode === 'variant' ? 'variant' : 'product';
  const variantMode = inventoryMode === 'variant';
  const stockCount = variantMode ? number(row.purchasable_count) : 1;
  const missingCount = variantMode
    ? number(row.missing_stock_count)
    : row.stock_id == null ? 1 : 0;
  const limitedCount = variantMode
    ? number(row.limited_stock_count)
    : row.track_inventory === true ? 1 : 0;
  const unlimitedCount = variantMode
    ? number(row.unlimited_stock_count)
    : row.stock_id != null && row.track_inventory === false ? 1 : 0;
  // Missing identities are setup work, never an implicit unlimited stock row.
  const stockStatus = stockCount === 0 || missingCount > 0
    ? 'missing'
    : limitedCount === stockCount ? 'limited'
    : unlimitedCount === stockCount ? 'unlimited'
    : 'mixed';
  const limitedAvailable = variantMode
    ? number(row.variant_available)
    : Math.max(0, number(row.on_hand) - number(row.reserved));

  return {
    ...mapSummary(row),
    optionCount: number(row.option_count),
    inventoryMode,
    stockStatus,
    available: stockStatus === 'limited' ? limitedAvailable : null,
    trackInventory: stockStatus === 'limited' ? true : stockStatus === 'unlimited' ? false : null,
    // The manual availability switch takes precedence even with unlimited stock.
    inStock: Boolean(row.in_stock) && (unlimitedCount > 0 || (limitedAvailable > 0 && limitedCount > 0)),
  };
}

/** Labels describe stock setup as well as availability; missing is not unlimited. */
export function catalogStockLabel(product: CatalogProductSummary): string {
  if (product.stockStatus === 'missing' || !product.stockStatus) return 'Stock setup needed';
  if (!product.inStock) return 'Out of stock';
  switch (product.stockStatus) {
    case 'limited': return `${product.available ?? 0} left`;
    case 'unlimited': return 'Not limited';
    case 'mixed': return 'Mixed stock limits';
    default: return 'Stock setup needed';
  }
}

/** Format integer paise as the same en-IN string used by the storefront. */
export function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
  })}`;
}

/** Format an ISO timestamp for a plain operations table. */
export function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function listCatalogOverview(): Promise<CatalogLoad<CatalogOverview>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const [categoryRows, productRows] = await Promise.all([
      sql`
        select c.id, c.slug, c.name, c.title, c.is_active,
               count(p.id)::int as product_count
        from categories c
        left join products p
          on p.category_id = c.id and p.deleted_at is null
        where c.deleted_at is null
        group by c.id, c.slug, c.name, c.title, c.is_active, c.sort_order
        order by c.sort_order, c.name
      `,
      sql`
        select p.id, p.slug, p.name, p.subtitle, p.price_paise, p.sale_price_paise,
               p.currency, p.is_active, p.in_stock, p.sort_order, p.updated_at,
               p.inventory_mode, s.id as stock_id, s.track_inventory, s.on_hand, s.reserved,
               options.option_count, options.purchasable_count, options.missing_stock_count,
               options.limited_stock_count, options.unlimited_stock_count, options.variant_available,
               c.id as category_id, c.slug as category_slug, c.name as category_name
        from products p
        join categories c on c.id = p.category_id
        left join stock s on s.product_id = p.id and s.variant_id is null
        left join lateral (
          select count(*)::int as option_count,
                 count(*) filter (where v.is_active and v.is_purchasable)::int as purchasable_count,
                 count(*) filter (where v.is_active and v.is_purchasable and vs.id is null)::int as missing_stock_count,
                 count(*) filter (where v.is_active and v.is_purchasable and vs.track_inventory)::int as limited_stock_count,
                 count(*) filter (where v.is_active and v.is_purchasable and not vs.track_inventory)::int as unlimited_stock_count,
                 coalesce(sum(greatest(0, vs.on_hand - vs.reserved)) filter (
                   where v.is_active and v.is_purchasable and vs.track_inventory
                 ), 0) as variant_available
          from product_variants v
          left join stock vs on vs.product_id = v.product_id and vs.variant_id = v.id
          where v.product_id = p.id
        ) options on true
        where p.deleted_at is null
        order by c.sort_order, p.sort_order, p.name
      `,
    ]);

    const categories: CatalogCategorySummary[] = (categoryRows as Row[]).map(
      (row) => ({
        id: text(row.id),
        slug: text(row.slug),
        name: text(row.name),
        title: text(row.title),
        isActive: Boolean(row.is_active),
        productCount: number(row.product_count),
      }),
    );

    const products = (productRows as Row[]).map(mapCatalogOverviewProduct);
    return { ok: true, data: { categories, products } };
  } catch {
    console.warn('[store-admin/catalog] could not read the catalogue');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getCatalogProduct(
  id: string,
): Promise<CatalogLoad<CatalogProductDetail>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const productRows = await sql`
      select p.id, p.slug, p.name, p.subtitle, p.price_paise, p.sale_price_paise,
             p.compare_at_paise, p.cost_paise, p.currency, p.material, p.brand, p.brand_id,
             p.condition_id, cond.label as condition_label, p.description,
             to_jsonb(p)->>'short_description' as short_description,
             to_jsonb(p)->'description_sections' as description_sections,
             p.badge, p.highlights, p.in_the_box, p.seo_title,
             p.seo_description, p.in_stock, p.is_active, p.sort_order,
             p.created_at, p.updated_at, p.inventory_mode, p.catalog_revision,
             p.sell_by, p.sku_pattern,
             (select coalesce(jsonb_agg(jsonb_build_object('id',dm.id,'name',dm.name,'isActive',dm.is_active and db.is_active) order by dm.name),'[]'::jsonb) from product_device_models pm join device_models dm on dm.id=pm.device_model_id join device_brands db on db.id=dm.brand_id where pm.product_id=p.id and pm.archived_at is null) as device_models,
             c.id as category_id, c.slug as category_slug, c.name as category_name
      from products p
      join categories c on c.id = p.category_id
      left join conditions cond on cond.id = p.condition_id
      where p.id = ${id} and p.deleted_at is null
      limit 1
    `;

    const productRow = (productRows as Row[])[0];
    if (!productRow) return { ok: false, reason: 'not-found' };

    const [facetRows, specRows, imageRows, variantRows, attributeRows, historyRows, stockRows, colourRows] =
      await Promise.all([
        sql`
          select facet_key, facet_value, sort_order
          from product_facets
          where product_id = ${id}
          order by sort_order, facet_value
        `,
        sql`
          select label, value, sort_order
          from product_specs
          where product_id = ${id}
          order by sort_order, label
        `,
        sql`
          select id, url, alt, role, sort_order, colour_id, is_active, deleted_at
          from product_images
          where product_id = ${id}
          order by
            (deleted_at is not null),
            case role when 'primary' then 0 when 'hover' then 1 else 2 end,
            sort_order, id
        `,
        sql`
          select v.id, v.sku, v.option_name, v.option_value, v.option_hex,
                 v.price_paise_override, v.sale_price_paise, v.is_active, v.sort_order,
                 v.is_purchasable,v.device_model_id,v.combination_key,v.option_identity,v.retired_at,
                 s.id as stock_id,s.on_hand,s.reserved,s.track_inventory,s.low_stock_threshold,s.updated_at as stock_updated_at
          from product_variants v left join stock s on s.product_id=v.product_id and s.variant_id=v.id
          where v.product_id = ${id}
          order by v.sort_order, v.option_value
        `,
        sql`
          select v.attribute_id, v.value_text, v.value_number, v.value_bool,
                 v.option_value, a.key, a.label, a.data_type, u.label as unit_label
          from product_attribute_values v
          join attributes a on a.id = v.attribute_id and a.deleted_at is null
          left join units u on u.id = a.unit_id
          where v.product_id = ${id}
          order by a.sort_order, a.label
        `,
        sql`
          select id, variant_id, old_price_paise, new_price_paise,
                 old_sale_price_paise, new_sale_price_paise, change_group,
                 price_kind, currency, source, reason, changed_by, changed_at
          from price_history
          where product_id = ${id}
          order by changed_at desc, id desc
          limit 50
        `,
        sql`
          select on_hand, reserved, low_stock_threshold, track_inventory,
                 updated_at
          from stock
          where product_id = ${id} and variant_id is null
          limit 1
        `,
        sql`
          select id, name, hex, is_active, sort_order
          from colours
          order by sort_order, name, id
        `,
      ]);

    const facets: CatalogFacet[] = (facetRows as Row[]).map((row) => ({
      key: text(row.facet_key),
      value: text(row.facet_value),
      sortOrder: number(row.sort_order),
    }));
    const specs: CatalogSpec[] = (specRows as Row[]).map((row) => ({
      label: text(row.label),
      value: text(row.value),
      sortOrder: number(row.sort_order),
    }));
    const images: CatalogImage[] = (imageRows as Row[]).map(mapImageRow);
    const variants: CatalogVariant[] = (variantRows as Row[]).map((row) => ({
      id: text(row.id),
      sku: row.sku === null || row.sku === undefined ? null : text(row.sku),
      optionName: text(row.option_name),
      optionValue: text(row.option_value),
      optionHex: row.option_hex === null || row.option_hex === undefined
        ? null
        : text(row.option_hex),
      pricePaiseOverride: nullableNumber(row.price_paise_override),
      salePricePaise: nullableNumber(row.sale_price_paise),
      isPurchasable:Boolean(row.is_purchasable),deviceModelId:row.device_model_id == null?null:text(row.device_model_id),combinationKey:row.combination_key == null?null:text(row.combination_key),
      optionIdentity:row.option_identity==null?null:text(row.option_identity),retiredAt:iso(row.retired_at)||null,
      stock:row.stock_id?{onHand:number(row.on_hand),reserved:number(row.reserved),trackInventory:Boolean(row.track_inventory),lowStockThreshold:number(row.low_stock_threshold),updatedAt:iso(row.stock_updated_at)}:null,
      isActive: Boolean(row.is_active),
      sortOrder: number(row.sort_order),
    }));
    const attributeValues: CatalogProductAttributeValue[] = (
      attributeRows as Row[]
    ).map((row) => ({
      attributeId: text(row.attribute_id),
      key: text(row.key),
      label: text(row.label),
      dataType: text(row.data_type),
      unitLabel:
        row.unit_label === null || row.unit_label === undefined
          ? null
          : text(row.unit_label),
      valueText:
        row.value_text === null || row.value_text === undefined
          ? null
          : text(row.value_text),
      valueNumber: nullableNumber(row.value_number),
      valueBool:
        row.value_bool === null || row.value_bool === undefined
          ? null
          : Boolean(row.value_bool),
      optionValue:
        row.option_value === null || row.option_value === undefined
          ? null
          : text(row.option_value),
    }));
    const priceHistory: CatalogPriceHistoryRow[] = (historyRows as Row[]).map(
      (row) => ({
        id: number(row.id),
        variantId: row.variant_id === null || row.variant_id === undefined ? null : text(row.variant_id),
        oldPricePaise: nullableNumber(row.old_price_paise),
        newPricePaise: number(row.new_price_paise),
        oldSalePricePaise: nullableNumber(row.old_sale_price_paise),
        newSalePricePaise: nullableNumber(row.new_sale_price_paise),
        changeGroup: row.change_group === null || row.change_group === undefined ? null : text(row.change_group),
        priceKind: text(row.price_kind) || 'regular',
        cleared: priceHistoryIsCleared(text(row.price_kind)),
        currency: text(row.currency) || 'INR',
        source: text(row.source),
        reason: text(row.reason),
        changedBy: row.changed_by === null || row.changed_by === undefined
          ? null
          : text(row.changed_by),
        changedAt: iso(row.changed_at),
      }),
    );

    const colours = (colourRows as Row[]).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      hex: text(row.hex),
      isActive: Boolean(row.is_active),
    }));

    const stockRow = (stockRows as Row[])[0];
    const stock: CatalogStockRow | null = stockRow
      ? {
          onHand: number(stockRow.on_hand),
          reserved: number(stockRow.reserved),
          lowStockThreshold: number(stockRow.low_stock_threshold),
          trackInventory: Boolean(stockRow.track_inventory),
          updatedAt: iso(stockRow.updated_at),
        }
      : null;

    return {
      ok: true,
      data: {
        ...mapSummary(productRow),
        catalogRevision: readCatalogRevision(productRow.catalog_revision),
        inventoryMode:productRow.inventory_mode==='variant'?'variant':'product',
        sellBy: sellByOf(productRow.sell_by),
        skuPattern: productRow.sku_pattern == null ? null : text(productRow.sku_pattern),
        deviceModels:Array.isArray(productRow.device_models)?productRow.device_models as Array<{id:string;name:string;isActive?:boolean}>:[],
        colours,
        trackInventory: stock ? stock.trackInventory : null,
        description: text(productRow.description),
        shortDescription: productRow.short_description == null ? null : text(productRow.short_description),
        descriptionSections: productRow.description_sections ?? null,
        material: text(productRow.material),
        brand: text(productRow.brand),
        brandId:
          productRow.brand_id === null || productRow.brand_id === undefined
            ? null
            : text(productRow.brand_id),
        compareAtPaise: nullableNumber(productRow.compare_at_paise),
        costPaise: nullableNumber(productRow.cost_paise),
        conditionId:
          productRow.condition_id === null || productRow.condition_id === undefined
            ? null
            : text(productRow.condition_id),
        conditionLabel:
          productRow.condition_label === null || productRow.condition_label === undefined
            ? null
            : text(productRow.condition_label),
        badge:
          productRow.badge === null || productRow.badge === undefined
            ? null
            : text(productRow.badge),
        highlights: highlightList(productRow.highlights),
        inTheBox: stringList(productRow.in_the_box),
        seoTitle: text(productRow.seo_title),
        seoDescription: text(productRow.seo_description),
        createdAt: iso(productRow.created_at),
        facets,
        specs,
        images,
        variants,
        attributeValues,
        priceHistory,
        stock,
      },
    };
  } catch {
    console.warn('[store-admin/catalog] could not read a product');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------ reference */

export interface CatalogColourOption {
  id: string;
  name: string;
  hex: string;
  isActive: boolean;
}

/** Shared colours a new product editor can use for rows and photos. */
export async function listColourOptions(): Promise<CatalogLoad<CatalogColourOption[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select id, name, hex, is_active
      from colours
      order by sort_order, name, id
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        name: text(row.name),
        hex: text(row.hex),
        isActive: Boolean(row.is_active),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read shared colours');
    return { ok: false, reason: 'unavailable' };
  }
}

/** Category options for the product editor's select. */
export async function listCategoryOptions(): Promise<CatalogLoad<CatalogCategoryOption[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select id, slug, name, is_active
      from categories
      where deleted_at is null
      order by sort_order, name
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        slug: text(row.slug),
        name: text(row.name),
        isActive: Boolean(row.is_active),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read categories');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listBrands(): Promise<CatalogLoad<CatalogBrand[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select b.id, b.name, b.slug, b.logo_url, b.description, b.is_active,
             b.sort_order, b.deleted_at,
             (select count(*)::int from products p
               where p.brand_id = b.id and p.deleted_at is null) as product_count
      from brands b
      order by b.sort_order, b.name
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        name: text(row.name),
        slug: text(row.slug),
        logoUrl:
          row.logo_url === null || row.logo_url === undefined
            ? null
            : text(row.logo_url),
        description: text(row.description),
        isActive: Boolean(row.is_active),
        sortOrder: number(row.sort_order),
        productCount: number(row.product_count),
        deletedAt:
          row.deleted_at === null || row.deleted_at === undefined
            ? null
            : iso(row.deleted_at),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read brands');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listUnits(): Promise<CatalogLoad<CatalogUnit[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select u.id, u.code, u.label, u.dimension, u.base_code,
             u.factor::float8 as factor,
             (select count(*)::int from attributes a where a.unit_id = u.id) as attribute_count
      from units u
      order by u.dimension, u.factor, u.code
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        label: text(row.label),
        dimension: text(row.dimension),
        baseCode:
          row.base_code === null || row.base_code === undefined
            ? null
            : text(row.base_code),
        factor: number(row.factor),
        attributeCount: number(row.attribute_count),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read units');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listAttributes(): Promise<CatalogLoad<CatalogAttribute[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select a.id, a.key, a.label, a.data_type, a.unit_id, a.is_filterable,
             a.is_variant_option, a.sort_order, a.is_active, a.deleted_at,
             u.label as unit_label,
             coalesce((
               select jsonb_agg(
                        jsonb_build_object('value', op.value, 'sort_order', op.sort_order)
                        order by op.sort_order, op.value
                      )
               from attribute_options op
               where op.attribute_id = a.id
             ), '[]'::jsonb) as options,
             (select count(*)::int from product_attribute_values v
               where v.attribute_id = a.id) as product_count
      from attributes a
      left join units u on u.id = a.unit_id
      order by a.sort_order, a.label
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        key: text(row.key),
        label: text(row.label),
        dataType: text(row.data_type),
        unitId:
          row.unit_id === null || row.unit_id === undefined
            ? null
            : text(row.unit_id),
        unitLabel:
          row.unit_label === null || row.unit_label === undefined
            ? null
            : text(row.unit_label),
        isFilterable: Boolean(row.is_filterable),
        isVariantOption: Boolean(row.is_variant_option),
        sortOrder: number(row.sort_order),
        isActive: Boolean(row.is_active),
        deletedAt:
          row.deleted_at === null || row.deleted_at === undefined
            ? null
            : iso(row.deleted_at),
        options: Array.isArray(row.options)
          ? (row.options as Row[]).map((option) => ({
              value: text(option.value),
              sortOrder: number(option.sort_order),
            }))
          : [],
        productCount: number(row.product_count),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read attributes');
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Products whose available stock has reached its threshold.
 *
 * Only tracked stock is listed: with `track_inventory` off, checkout ignores
 * the number, so a zero count there is not an operational problem.
 */
export async function listLowStock(limit = 100): Promise<CatalogLoad<CatalogLowStockSummary>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const [rows, countRows] = await Promise.all([
      sql`
        select s.product_id, s.variant_id,v.sku as variant_sku,p.slug, p.name || case when v.id is null then '' else ' — ' || v.option_value end as name, s.on_hand, s.reserved,
               s.low_stock_threshold, s.updated_at
        from stock s
        join products p on p.id = s.product_id
        left join product_variants v on v.id=s.variant_id and v.product_id=p.id
        where ((p.inventory_mode='product' and s.variant_id is null) or (p.inventory_mode='variant' and v.is_active and v.is_purchasable))
          and p.deleted_at is null
          and s.track_inventory
          and (s.on_hand - s.reserved) <= s.low_stock_threshold
        order by (s.on_hand - s.reserved), p.name
        limit ${Math.min(Math.max(limit, 1), 500)}
      `,
      sql`
        select count(*) filter (where s.track_inventory)::int as tracked,
               count(*) filter (
                 where s.track_inventory
                   and (s.on_hand - s.reserved) <= s.low_stock_threshold
               )::int as low
        from stock s
        join products p on p.id = s.product_id
        left join product_variants v on v.id=s.variant_id and v.product_id=p.id
        where p.deleted_at is null and ((p.inventory_mode='product' and s.variant_id is null) or (p.inventory_mode='variant' and v.is_active and v.is_purchasable))
      `,
    ]);

    const counts = (countRows as Row[])[0] ?? {};
    return {
      ok: true,
      data: {
        rows: (rows as Row[]).map((row) => {
          const onHand = number(row.on_hand);
          const reserved = number(row.reserved);
          return {
            productId: text(row.product_id),
            variantId:row.variant_id==null?null:text(row.variant_id),variantSku:row.variant_sku==null?null:text(row.variant_sku),
            slug: text(row.slug),
            name: text(row.name),
            onHand,
            reserved,
            available: onHand - reserved,
            threshold: number(row.low_stock_threshold),
            updatedAt: iso(row.updated_at),
          };
        }),
        trackedCount: number(counts.tracked),
        lowCount: number(counts.low),
      },
    };
  } catch {
    console.warn('[store-admin/catalog] could not read low stock');
    return { ok: false, reason: 'unavailable' };
  }
}
