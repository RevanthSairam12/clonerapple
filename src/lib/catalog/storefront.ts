/**
 * Storefront catalogue — the single read path from `products` to every
 * customer-facing surface (category grids, product pages, search, the bag).
 *
 * Store admin writes the catalogue; this module reads it. Nothing here has a
 * code-level copy of a product: if a row is deleted, edited or added in the
 * back office it appears here on the next request. The static bundles under
 * `src/components/sites/**\/data` are a development-only fallback for a
 * checkout with no DATABASE_URL — they are never merged with database rows.
 *
 * Server-only. Every amount that leaves this module is `price_paise / 100`.
 */

import { getSql } from '@/lib/platform/db';
import { sanitizeDescriptionSections, type ProductDescriptionSection } from '@/lib/catalog/product-description';
import { projectManagedCatalog, stockStateFrom } from '@/lib/storefront/catalog-rules';
import { resolveEffectivePrice } from '@/lib/storefront/pricing';
import { readSaleState } from '@/lib/storefront/sale-state';
import { aggregateVariantAvailability } from '@/lib/storefront/availability-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The storefront catalogue must be read on the server only.');
}

export interface StorefrontColor {
  name: string;
  hex: string;
}

export interface StorefrontSpec {
  label: string;
  value: string;
}

export interface StorefrontHighlight {
  title: string;
  desc: string;
}

/**
 * Availability as the stock table defines it. Only `out_of_stock` changes a
 * storefront surface today (a disabled quick-add); `low_stock` is carried for
 * the surfaces that already have room for it.
 */
export type StorefrontStockState = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface StorefrontPurchasableVariant {
  id: string;
  sku: string;
  label: string;
  deviceModelId: string | null;
  deviceModelName: string | null;
  optionName: string;
  optionValue: string;
  combinationKey: string;
  pricePaise: number;
  regularPricePaise: number;
  salePricePaise: number | null;
  onSale: boolean;
  inStock: boolean;
}

export interface StorefrontProduct {
  inventoryMode?: 'product' | 'variant';
  purchasableVariants?: StorefrontPurchasableVariant[];
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  /**
   * Rupees, for arithmetic. `priceDisplay` is what is charged today: the sale
   * price while sale mode is live, otherwise the regular price.
   */
  price: number;
  pricePaise: number;
  priceDisplay: string;
  /** Stored parent defaults, never overwritten by the option display minimum. */
  parentPricePaise?: number;
  parentSalePricePaise?: number | null;
  /** Only differing effective option amounts get a From label. */
  priceFrom?: boolean;
  /** The regular price, shown struck through while `onSale`. */
  regularPricePaise: number;
  salePricePaise: number | null;
  onSale: boolean;
  compareAtPaise: number | null;
  image: string;
  gallery: string[];
  hoverImage?: string;
  colors: StorefrontColor[];
  /** Product-level facets, e.g. `{ model: 'iPhone 17', brand: 'Gadzio' }`. */
  facets: Record<string, string>;
  /** Every facet value for a key, when a product matches more than one. */
  facetValues: Record<string, string[]>;
  facetLabels: Record<string, string>;
  /** Only explicitly searchable mapped attributes and current device joins. */
  searchValues: string[];
  compatibility: string[];
  material: string;
  brand: string;
  description: string;
  shortDescription?: string | null;
  descriptionSections?: ProductDescriptionSection[] | null;
  highlights: StorefrontHighlight[];
  features: string[];
  specs: StorefrontSpec[];
  inTheBox: string[];
  badge?: string;
  inStock: boolean;
  /** `in_stock` / `low_stock` / `out_of_stock`, from the stock row. */
  stockState: StorefrontStockState;
  /** Units available (`on_hand - reserved`); null when the product is untracked. */
  availableStock: number | null;
  /** The product's `stock.low_stock_threshold`; null when there is no stock row. */
  lowStockThreshold: number | null;
  trackInventory: boolean;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  href: string;
}

export interface StorefrontFacetDef {
  id: string;
  label: string;
  options: string[];
  isQuickPill: boolean;
}

export interface StorefrontCategory {
  id: string;
  slug: string;
  name: string;
  title: string;
  subhead: string;
  breadcrumbLeaf: string;
  countNoun: string;
  disclaimer: string;
  navLabel: string;
  navHref: string;
  seo: { title: string; description: string };
  facets: StorefrontFacetDef[];
  /**
   * Products as the database defines them, priced at the **regular** price
   * with `onSale: false`. Callers apply `applySaleDisplay(product, sale.live)`
   * per request so a cached snapshot never bakes in the sale switch.
   */
  products: StorefrontProduct[];
}

export interface StorefrontProductRef {
  inventoryMode?: 'product' | 'variant';
  purchasableVariants?: StorefrontPurchasableVariant[];
  id: string;
  name: string;
  subtitle: string;
  pricePaise: number;
  priceDisplay: string;
  /** The regular price shown struck through while a sale is live. */
  regularPricePaise?: number;
  wasPriceDisplay?: string;
  image: string;
  categorySlug: string;
  categoryName: string;
  inStock: boolean;
  /** Facet values, used by client-side search scoring. */
  keywords: string[];
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const parsed = text(value).trim();
  return parsed || null;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Indian digit grouping, matching the rest of the storefront's price labels. */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function asHighlights(value: unknown): StorefrontHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Row;
    const title = text(row.title).trim();
    const desc = text(row.desc ?? row.description).trim();
    if (!title && !desc) return [];
    return [{ title, desc }];
  });
}

function asColors(value: unknown): StorefrontColor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Row;
    const name = text(row.name).trim();
    if (!name) return [];
    return [{ name, hex: text(row.hex).trim() || '#1d1d1f' }];
  });
}

/** Product href. The storefront resolves every product from this one route. */
export function productHref(id: string): string {
  return `/shop/product/${encodeURIComponent(id)}`;
}

function primaryImage(images: Row[]): string {
  const primary = images.find((image) => text(image.role) === 'primary');
  return text((primary ?? images[0])?.url);
}

interface ProductAggregate {
  row: Row;
  images: Row[];
  attributes: Row[];
  deviceModels: Row[];
  variants: Row[];
  stock?: Row;
  variantStock: Row[];
}

function mapProduct(aggregate: ProductAggregate, saleLive: boolean): StorefrontProduct {
  const { row, images, attributes, deviceModels, variants, stock } = aggregate;

  const price = resolveEffectivePrice(
    {
      pricePaise: number(row.price_paise),
      salePricePaise: row.sale_price_paise === null || row.sale_price_paise === undefined
        ? null
        : number(row.sale_price_paise),
    },
    saleLive,
  );
  const pricePaise = price.unitPaise;
  const compareAt = row.compare_at_paise === null || row.compare_at_paise === undefined
    ? null
    : Math.round(number(row.compare_at_paise));

  const ordered = [...images].sort((a, b) => {
    const rank = (role: unknown) =>
      text(role) === 'primary' ? 0 : text(role) === 'hover' ? 1 : 2;
    const byRole = rank(a.role) - rank(b.role);
    if (byRole !== 0) return byRole;
    const bySort = number(a.sort_order) - number(b.sort_order);
    if (bySort !== 0) return bySort;
    return text(a.id).localeCompare(text(b.id));
  });

  const hoverImage = ordered.find((image) => text(image.role) === 'hover');
  const gallery = ordered
    .filter((image) => text(image.role) !== 'hover')
    .map((image) => text(image.url))
    .filter(Boolean);

  const projection = projectManagedCatalog(attributes, deviceModels);
  const { facets: facetsFlat, facetValues, compatibility } = projection;
  // Product merchandising brand is global, unlike type-scoped attributes.
  if (text(row.brand).trim()) {
    facetsFlat.brand = text(row.brand).trim();
    facetValues.brand = [facetsFlat.brand];
    projection.facetLabels.brand = 'Brand';
  }
  const colors = asColors(row.__colors);
  const inventoryMode = row.inventory_mode === 'variant' ? 'variant' : 'product';
  const configured = variants.filter((variant) => Boolean(variant.is_active) && Boolean(variant.is_purchasable) &&
    text(variant.sku).trim() && text(variant.combination_key).trim() &&
    aggregate.variantStock.some((entry) => entry.variant_id === variant.id) &&
    (!row.__requires_compatibility || Boolean(variant.device_model_id)) &&
    (!variant.device_model_id || deviceModels.some((model) => model.id === variant.device_model_id)));
  const variantStates = configured.map((variant) => {
    const variantStock = aggregate.variantStock.find((entry) => entry.variant_id === variant.id);
    const snapshot = stockStateFrom(variantStock ?? { track_inventory: true, on_hand: 0, reserved: 0 }, true);
    return { id: text(row.id), variantId: text(variant.id), inStock: snapshot.state !== 'out_of_stock',
      tracked: snapshot.tracked, available: snapshot.tracked ? snapshot.available : null, lowStockThreshold: snapshot.threshold };
  });
  const purchasableVariants: StorefrontPurchasableVariant[] = inventoryMode === 'variant' ? configured.map((variant, index) => {
    const variantPrice = resolveEffectivePrice(
      { pricePaise: price.regularPaise, salePricePaise: price.salePaise }, saleLive,
      { pricePaise: variant.price_paise_override == null ? null : number(variant.price_paise_override),
        salePricePaise: variant.sale_price_paise == null ? null : number(variant.sale_price_paise) });
    const deviceModelName = nullableText(deviceModels.find((model) => model.id === variant.device_model_id)?.name);
    return { id: text(variant.id), sku: text(variant.sku),
      label: [deviceModelName, [text(variant.option_name), text(variant.option_value)].filter(Boolean).join(': ')].filter(Boolean).join(' • ') || text(variant.sku),
      deviceModelId: nullableText(variant.device_model_id), deviceModelName,
      optionName: text(variant.option_name), optionValue: text(variant.option_value), combinationKey: text(variant.combination_key),
      pricePaise: variantPrice.unitPaise, regularPricePaise: variantPrice.regularPaise, salePricePaise: variantPrice.salePaise,
      onSale: variantPrice.onSale, inStock: variantStates[index].inStock };
  }) : [];
  const parentState = stockStateFrom(stock, Boolean(row.in_stock));
  const aggregateState = aggregateVariantAvailability(text(row.id), variantStates);
  const stockState = inventoryMode === 'variant' ? { state: aggregateState.inStock ? 'in_stock' as const : 'out_of_stock' as const,
    available: aggregateState.available, threshold: null, tracked: aggregateState.tracked } : parentState;

  const product: StorefrontProduct = {
    inventoryMode, purchasableVariants,
    parentPricePaise: price.regularPaise,
    parentSalePricePaise: price.salePaise,
    id: text(row.id),
    slug: text(row.slug) || text(row.id),
    name: text(row.name),
    subtitle: text(row.subtitle),
    price: pricePaise / 100,
    pricePaise,
    priceDisplay: formatPaise(pricePaise),
    regularPricePaise: price.regularPaise,
    salePricePaise: price.salePaise,
    onSale: price.onSale,
    compareAtPaise: compareAt,
    image: primaryImage(ordered),
    gallery,
    colors,
    facets: facetsFlat,
    facetValues,
    facetLabels: projection.facetLabels,
    searchValues: projection.searchValues,
    compatibility,
    material: facetsFlat.material || '',
    brand: text(row.brand) || facetsFlat.brand || '',
    description: text(row.description),
    shortDescription: row.short_description == null ? null : text(row.short_description),
    descriptionSections: row.description_sections == null ? null : sanitizeDescriptionSections(row.description_sections),
    highlights: asHighlights(row.highlights),
    features: asHighlights(row.highlights).map((highlight) => highlight.title),
    specs: projection.specs,
    inTheBox: asStringArray(row.in_the_box),
    inStock: stockState.state !== 'out_of_stock',
    stockState: stockState.state,
    availableStock: stockState.available,
    lowStockThreshold: stockState.threshold,
    trackInventory: stockState.tracked,
    categoryId: text(row.category_id),
    categorySlug: text(row.__category_slug),
    categoryName: text(row.__category_name),
    href: productHref(text(row.id)),
  };

  if (hoverImage) product.hoverImage = text(hoverImage.url);
  const badge = nullableText(row.badge);
  if (badge) product.badge = badge;

  // Active variants are the colour swatches the detail page renders. Variants
  // carry no price yet (see 0011), so this only affects display.
  if (colors.length === 0) {
    const variantColors = variants
      .filter((variant) => Boolean(variant.is_active))
      .sort((a, b) => number(a.sort_order) - number(b.sort_order))
      .map((variant) => ({
        name: text(variant.option_value),
        hex: text(variant.option_hex) || '#1d1d1f',
      }))
      .filter((color) => color.name);
    product.colors = variantColors;
  }

  return applySaleDisplay(product, saleLive);
}

/* ------------------------------------------------------------------ query */

export interface CatalogLoad {
  categories: Row[];
  products: Row[];
  images: Row[];
  attributes: Row[];
  deviceModels: Row[];
  variants: Row[];
  stock: Row[];
}

/** The read itself, so tests can run it against a throwaway schema. */
export async function loadCatalogUsing(
  sql: NonNullable<ReturnType<typeof getSql>>,
): Promise<CatalogLoad> {
  const [categories, products, images, attributes, deviceModels, variants, stock] = await Promise.all([
    sql`
      select c.id, c.slug, c.name, c.title, c.subhead, c.breadcrumb_leaf,
             c.count_noun, c.disclaimer, c.nav_label, c.nav_href,
             c.seo_title, c.seo_description, c.sort_order
      from categories c
      where c.deleted_at is null and c.is_active
      order by c.sort_order asc, c.name asc
    `,
    sql`
      select p.id, p.category_id, p.slug, p.name, p.subtitle, p.price_paise,
             p.sale_price_paise, p.compare_at_paise, p.currency, p.material, p.brand, p.description,
             to_jsonb(p)->>'short_description' as short_description,
             to_jsonb(p)->'description_sections' as description_sections,
             p.badge, p.highlights, p.in_the_box, p.seo_title, p.seo_description,
             p.in_stock, p.inventory_mode, p.is_active, p.sort_order,
             c.slug as __category_slug, c.name as __category_name,
             pt.requires_compatibility as __requires_compatibility
      from products p
      left join product_types pt on pt.id = p.product_type_id
      join categories c on c.id = p.category_id
      where p.deleted_at is null
        and p.is_active
        and c.deleted_at is null
        and c.is_active
      order by p.sort_order asc, p.name asc
    `,
    sql`
      select id, product_id, url, alt, role, sort_order
      from product_images
      where deleted_at is null and is_active
    `,
    sql`
      select p.id as product_id, a.key, a.label, a.data_type,
             v.value_text, v.value_number, v.value_bool, v.option_value,
             m.show_in_specs, m.show_in_filters, m.show_in_search
      from products p
      join product_types t on t.id = p.product_type_id
        and t.category_id = p.category_id and t.is_active
      join product_type_attributes m on m.product_type_id = t.id and m.is_active
      join attributes a on a.id = m.attribute_id and a.is_active and a.deleted_at is null
      join product_attribute_values v on v.product_id = p.id
        and v.attribute_id = a.id and v.archived_at is null
      where p.deleted_at is null and p.is_active and lower(a.key) <> 'model'
      order by m.sort_order asc, a.key asc
    `,
    sql`
      select j.product_id, d.id, d.name
      from product_device_models j
      join device_models d on d.id = j.device_model_id and d.is_active
      join device_brands b on b.id = d.brand_id and b.is_active
      where j.archived_at is null
      order by j.sort_order asc, b.sort_order asc, d.sort_order asc, d.name asc
    `,
    sql`
      select id, product_id, sku, option_name, option_value, option_hex, is_active, sort_order,
             is_purchasable, device_model_id, combination_key, price_paise_override, sale_price_paise
      from product_variants
      order by sort_order asc
    `,
    sql`
      select product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory
      from stock
    `,
  ]);

  return {
    categories: categories as Row[],
    products: products as Row[],
    images: images as Row[],
    attributes: attributes as Row[],
    deviceModels: deviceModels as Row[],
    variants: variants as Row[],
    stock: stock as Row[],
  };
}

async function loadCatalog(): Promise<CatalogLoad | null> {
  const sql = getSql();
  if (!sql) return null;
  return loadCatalogUsing(sql);
}

function groupByProduct(rows: Row[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = text(row.product_id);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

function mapAll(load: CatalogLoad, saleLive: boolean): {
  categories: StorefrontCategory[];
  byProductId: Map<string, StorefrontProduct>;
} {
  const images = groupByProduct(load.images);
  const attributes = groupByProduct(load.attributes ?? []);
  const deviceModels = groupByProduct(load.deviceModels ?? []);
  const variants = groupByProduct(load.variants);
  const stock = groupByProduct(load.stock);

  const byProductId = new Map<string, StorefrontProduct>();
  for (const row of load.products) {
    const id = text(row.id);
    byProductId.set(id, mapProduct({
      row,
      images: images.get(id) ?? [],
      attributes: attributes.get(id) ?? [],
      deviceModels: deviceModels.get(id) ?? [],
      variants: variants.get(id) ?? [],
      stock: stock.get(id)?.find((entry) => entry.variant_id == null),
      variantStock: stock.get(id)?.filter((entry) => entry.variant_id != null) ?? [],
    }, saleLive));
  }

  const categories: StorefrontCategory[] = load.categories.map((row) => {
    const id = text(row.id);
    const categoryProducts = load.products
      .filter((product) => text(product.category_id) === id)
      .map((product) => byProductId.get(text(product.id)))
      .filter((product): product is StorefrontProduct => Boolean(product));

    return {
      id,
      slug: text(row.slug) || id,
      name: text(row.name),
      title: text(row.title) || text(row.name),
      subhead: text(row.subhead),
      breadcrumbLeaf: text(row.breadcrumb_leaf) || text(row.name),
      countNoun: text(row.count_noun) || 'products',
      disclaimer: text(row.disclaimer),
      navLabel: text(row.nav_label) || text(row.name),
      navHref: text(row.nav_href) || `/in/shop/iphone/accessories/${text(row.slug) || id}`,
      seo: {
        title: text(row.seo_title) || text(row.name),
        description: text(row.seo_description),
      },
      facets: buildFacetDefs(id, categoryProducts),
      products: categoryProducts,
    };
  });

  return { categories, byProductId };
}

/** Everything one request may need, in cacheable (serializable) form. */
export interface StorefrontCatalogSnapshot {
  categories: StorefrontCategory[];
  products: StorefrontProduct[];
}

/**
 * Strict catalogue read for the caching layer. Returns null when no database
 * is configured; throws when a configured database cannot be read, so the
 * caller can tell "no database" apart from "query failed" and fall back to
 * the static bundles exactly once.
 */
export async function readStorefrontCatalog(): Promise<StorefrontCatalogSnapshot | null> {
  const load = await loadCatalog();
  if (!load) return null;
  // The cached snapshot carries catalogue rows only: every price is resolved
  // with the sale switch OFF. The sale flag is applied per request by
  // `applySaleDisplay()`, so a cached entry can never hold a stale switch and
  // a sale starting or ending is visible on the very next request.
  return snapshotFromLoad(load);
}

/** Map one catalogue read into the cacheable snapshot, regular prices only. */
export function snapshotFromLoad(load: CatalogLoad): StorefrontCatalogSnapshot {
  const { categories, byProductId } = mapAll(load, false);
  return { categories, products: [...byProductId.values()] };
}

/**
 * Re-resolve one product's displayed price and sale badge against the sale
 * state read for this request. The stored catalogue figures are the source;
 * nothing here mutates the cached snapshot.
 */
export function applySaleDisplay(product: StorefrontProduct, saleLive: boolean): StorefrontProduct {
  const parentPricePaise = product.parentPricePaise ?? product.regularPricePaise;
  const parentSalePricePaise = product.parentSalePricePaise === undefined
    ? product.salePricePaise : product.parentSalePricePaise;
  const parent = resolveEffectivePrice(
    { pricePaise: parentPricePaise, salePricePaise: parentSalePricePaise }, saleLive,
  );
  // Each option already retains its resolved regular/stored sale pair. Resolve
  // that pair independently: the minimum is presentation, not an inheritance source.
  const purchasableVariants = product.purchasableVariants?.map((variant) => {
    const resolved = resolveEffectivePrice({ pricePaise: variant.regularPricePaise, salePricePaise: variant.salePricePaise }, saleLive);
    return resolved.unitPaise === variant.pricePaise && resolved.onSale === variant.onSale
      ? variant : { ...variant, pricePaise: resolved.unitPaise, onSale: resolved.onSale };
  });
  // OOS configured options still participate; stock is a separate purchase check.
  const options = product.inventoryMode === 'variant' ? purchasableVariants ?? [] : [];
  const minimum = options.reduce<StorefrontPurchasableVariant | undefined>((best, option) =>
    !best || option.pricePaise < best.pricePaise ? option : best, undefined);
  const price = minimum ? { unitPaise: minimum.pricePaise, regularPaise: minimum.regularPricePaise,
    salePaise: minimum.salePricePaise, onSale: minimum.onSale } : parent;
  const priceFrom = options.some((option) => option.pricePaise !== price.unitPaise);
  const noOptions = product.inventoryMode === 'variant' && !minimum;
  const priceDisplay = noOptions ? 'Unavailable' : `${priceFrom ? 'From ' : ''}${formatPaise(price.unitPaise)}`;
  const variantsUnchanged = purchasableVariants?.every((variant, index) => variant === product.purchasableVariants?.[index]) ?? true;
  // Once provenance is normalized, a request with unchanged prices keeps the
  // snapshot identity, including all option objects. Never normalize by mutation.
  if (product.parentPricePaise === parentPricePaise && product.parentSalePricePaise === parentSalePricePaise &&
    product.priceFrom === priceFrom && product.pricePaise === price.unitPaise && product.price === price.unitPaise / 100 &&
    product.priceDisplay === priceDisplay && product.regularPricePaise === price.regularPaise &&
    product.salePricePaise === price.salePaise && product.onSale === price.onSale && variantsUnchanged) return product;
  return {
    ...product,
    parentPricePaise,
    parentSalePricePaise,
    purchasableVariants,
    priceFrom,
    price: price.unitPaise / 100,
    pricePaise: price.unitPaise,
    priceDisplay,
    regularPricePaise: price.regularPaise,
    salePricePaise: price.salePaise,
    onSale: price.onSale,
  };
}

/**
 * Sidebar facets come from the products that are actually in the category, so
 * a filter option can never point at zero rows after a back-office edit.
 * `facet_defs` supplies ordering and labels when an editor has saved them.
 */
function buildFacetDefs(
  _categoryId: string,
  products: StorefrontProduct[],
): StorefrontFacetDef[] {
  const collected = new Map<string, Set<string>>();
  const labels: Record<string, string> = {};
  for (const product of products) {
    Object.assign(labels, product.facetLabels);
    for (const [key, values] of Object.entries(product.facetValues)) {
      const bucket = collected.get(key) ?? new Set<string>();
      for (const value of values) bucket.add(value);
      collected.set(key, bucket);
    }
  }

  // `model` sorts first (it is the quick-pill facet on cases), then material
  // and brand — the order the storefront has always used.
  const order = ['model', 'material', 'brand'];
  const keys = [...collected.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });

  return keys.map((key) => ({
    id: key,
    label: labels[key] ?? FACET_LABELS[key] ?? key.replace(/(^|_)(\w)/g, (_, __, c) => ` ${c.toUpperCase()}`).trim(),
    options: [...(collected.get(key) ?? [])].sort((a, b) => a.localeCompare(b)),
    isQuickPill: key === 'model',
  }));
}

const FACET_LABELS: Record<string, string> = {
  model: 'Compatible With',
  material: 'Material',
  brand: 'Brand',
  wattage: 'Wattage',
  connector: 'Connector',
  driver: 'Driver Type',
  type: 'Case Type',
};

let warnedOnce = false;

/** Every active category with its products. Empty when no database is set. */
export async function listStorefrontCategories(): Promise<StorefrontCategory[]> {
  try {
    const load = await loadCatalog();
    if (!load) {
      if (!warnedOnce) {
        console.warn(
          '[catalog/storefront] DATABASE_URL is not set — the storefront has no catalogue to render.',
        );
        warnedOnce = true;
      }
      return [];
    }
    // Uncached read: the sale flag is applied here, not baked into a cache.
    const sale = await readSaleState();
    return mapAll(load, sale.live).categories;
  } catch {
    console.warn('[catalog/storefront] could not read the catalogue');
    throw new Error('The catalogue is temporarily unavailable.');
  }
}

/**
 * One category by URL slug. Accepts either the slug or the id, since they are
 * the same value for every seeded row but a future id/slug split must not
 * break an existing link.
 */
export async function getStorefrontCategory(slugOrId: string): Promise<StorefrontCategory | null> {
  if (!slugOrId) return null;
  try {
    const categories = await listStorefrontCategories();
    const needle = slugOrId.toLowerCase();
    return (
      categories.find(
        (category) =>
          category.slug.toLowerCase() === needle || category.id.toLowerCase() === needle,
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** One product by id, from the live catalogue only. Null when inactive/deleted. */
export async function getStorefrontProduct(id: string): Promise<StorefrontProduct | null> {
  if (!id) return null;
  try {
    const load = await loadCatalog();
    if (!load) return null;
    const sale = await readSaleState();
    const { byProductId } = mapAll(load, sale.live);
    return byProductId.get(id) ?? byProductId.get(id.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Several products by id, in the order requested. Inactive, deleted and
 * unknown ids are dropped rather than rendered as empty cards.
 */
export async function getStorefrontProducts(ids: string[]): Promise<StorefrontProduct[]> {
  if (ids.length === 0) return [];
  try {
    const load = await loadCatalog();
    if (!load) return [];
    const sale = await readSaleState();
    const { byProductId } = mapAll(load, sale.live);
    return ids.flatMap((id) => {
      const product = byProductId.get(id) ?? byProductId.get(id.toLowerCase());
      return product ? [product] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Compact rows for the client bundle (search, the bag, suggestions). The full
 * product list is large; this keeps the public payload to what those surfaces
 * actually read.
 */
export async function listStorefrontProductRefs(): Promise<StorefrontProductRef[]> {
  try {
    const load = await loadCatalog();
    if (!load) return [];
    const sale = await readSaleState();
    const { byProductId, categories } = mapAll(load, sale.live);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

    return [...byProductId.values()].map((product) => ({
      id: product.id,
      inventoryMode: product.inventoryMode, purchasableVariants: product.purchasableVariants,
      name: product.name,
      subtitle: product.subtitle,
      pricePaise: product.pricePaise,
      priceDisplay: product.priceDisplay,
      ...(product.onSale ? {
        regularPricePaise: product.regularPricePaise,
        wasPriceDisplay: formatPaise(product.regularPricePaise),
      } : {}),
      image: product.image,
      categorySlug: product.categorySlug,
      categoryName: categoryNames.get(product.categoryId) ?? product.categoryName,
      inStock: product.inStock,
      keywords: [
        product.name,
        product.subtitle,
        product.brand,
        product.categoryName,
        ...product.searchValues,
      ]
        .map((entry) => entry.toLowerCase())
        .filter(Boolean),
    }));
  } catch {
    return [];
  }
}

/** Ids of every product the store will sell right now — the bag's allow-list. */
export async function listSellableProductIds(): Promise<string[]> {
  const refs = await listStorefrontProductRefs();
  return refs.filter((ref) => ref.inStock).map((ref) => ref.id);
}