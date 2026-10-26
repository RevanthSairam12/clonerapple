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

import { getSql } from '@/lib/admin/db';
import { stockStateFrom } from '@/lib/storefront/catalog-rules';
import { resolveEffectivePrice } from '@/lib/storefront/pricing';
import { readSaleState } from '@/lib/storefront/sale-state';

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

export interface StorefrontProduct {
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
  compatibility: string[];
  material: string;
  brand: string;
  description: string;
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
  products: StorefrontProduct[];
}

export interface StorefrontProductRef {
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
  facets: Row[];
  specs: Row[];
  variants: Row[];
  stock?: Row;
}

function mapProduct(aggregate: ProductAggregate, saleLive: boolean): StorefrontProduct {
  const { row, images, facets, specs, variants, stock } = aggregate;

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

  const facetValues: Record<string, string[]> = {};
  const facetsFlat: Record<string, string> = {};
  for (const facet of facets) {
    const key = text(facet.facet_key).trim();
    const value = text(facet.facet_value).trim();
    if (!key || !value) continue;
    (facetValues[key] ??= []).push(value);
    // The first value is the display value; the grid filter checks the full
    // list under `facetValues`, so a multi-value facet still matches.
    facetsFlat[key] ??= value;
  }

  const colors = asColors(row.__colors);
  const compatibility = facetValues.model ?? [];
  const stockState = stockStateFrom(stock, Boolean(row.in_stock));

  const product: StorefrontProduct = {
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
    compatibility,
    material: text(row.material) || facetsFlat.material || '',
    brand: text(row.brand) || facetsFlat.brand || '',
    description: text(row.description),
    highlights: asHighlights(row.highlights),
    features: asHighlights(row.highlights).map((highlight) => highlight.title),
    specs: specs
      .slice()
      .sort((a, b) => number(a.sort_order) - number(b.sort_order))
      .map((spec) => ({ label: text(spec.label), value: text(spec.value) }))
      .filter((spec) => spec.label),
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

  return product;
}

/* ------------------------------------------------------------------ query */

interface CatalogLoad {
  categories: Row[];
  products: Row[];
  images: Row[];
  facets: Row[];
  specs: Row[];
  variants: Row[];
  stock: Row[];
}

async function loadCatalog(): Promise<CatalogLoad | null> {
  const sql = getSql();
  if (!sql) return null;

  const [categories, products, images, facets, specs, variants, stock] = await Promise.all([
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
             p.badge, p.highlights, p.in_the_box, p.seo_title, p.seo_description,
             p.in_stock, p.is_active, p.sort_order,
             c.slug as __category_slug, c.name as __category_name
      from products p
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
      select product_id, facet_key, facet_value, sort_order
      from product_facets
      order by sort_order asc
    `,
    sql`
      select product_id, label, value, sort_order
      from product_specs
      order by sort_order asc
    `,
    sql`
      select id, product_id, option_value, option_hex, is_active, sort_order
      from product_variants
      order by sort_order asc
    `,
    // Product-level stock only. Variant stock exists but carries no storefront
    // meaning yet (variants have no price and no per-colour availability UI).
    sql`
      select product_id, on_hand, reserved, low_stock_threshold, track_inventory
      from stock
      where variant_id is null
    `,
  ]);

  return {
    categories: categories as Row[],
    products: products as Row[],
    images: images as Row[],
    facets: facets as Row[],
    specs: specs as Row[],
    variants: variants as Row[],
    stock: stock as Row[],
  };
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
  const facets = groupByProduct(load.facets);
  const specs = groupByProduct(load.specs);
  const variants = groupByProduct(load.variants);
  const stock = groupByProduct(load.stock);

  const byProductId = new Map<string, StorefrontProduct>();
  for (const row of load.products) {
    const id = text(row.id);
    byProductId.set(id, mapProduct({
      row,
      images: images.get(id) ?? [],
      facets: facets.get(id) ?? [],
      specs: specs.get(id) ?? [],
      variants: variants.get(id) ?? [],
      stock: stock.get(id)?.[0],
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
  // The sale switch is tiny and read on every cache fill, so prices are never
  // more than the 30s catalogue cache behind a toggle. `readSaleState` never
  // throws: an unreadable switch means regular prices and normal mode.
  const sale = await readSaleState();
  const { categories, byProductId } = mapAll(load, sale.live);
  return { categories, products: [...byProductId.values()] };
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
  for (const product of products) {
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
    label: FACET_LABELS[key] ?? key.replace(/(^|_)(\w)/g, (_, __, c) => ` ${c.toUpperCase()}`).trim(),
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
      name: product.name,
      subtitle: product.subtitle,
      pricePaise: product.pricePaise,
      priceDisplay: product.priceDisplay,
      image: product.image,
      categorySlug: product.categorySlug,
      categoryName: categoryNames.get(product.categoryId) ?? product.categoryName,
      inStock: product.inStock,
      keywords: [
        product.name,
        product.subtitle,
        product.material,
        product.brand,
        product.categoryName,
        ...product.compatibility,
        ...Object.values(product.facets),
        ...product.specs.map((spec) => `${spec.label} ${spec.value}`),
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