import { getSql } from '@/lib/admin/db';

/**
 * Read-only catalogue queries for the store admin.
 *
 * The store admin connects with DATABASE_URL (the table owner), which is
 * allowed to see price_history and stock even though RLS gives anon and
 * authenticated no policy on those tables.
 *
 * Nothing in this module writes. Price editing is deliberately absent: the
 * checkout path still reads prices from the code catalogue, so enabling a
 * write path here would create a price the storefront does not charge.
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
  currency: string;
  isActive: boolean;
  inStock: boolean;
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
}

export interface CatalogVariant {
  id: string;
  optionName: string;
  optionValue: string;
  optionHex: string | null;
  pricePaiseOverride: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CatalogPriceHistoryRow {
  id: number;
  oldPricePaise: number | null;
  newPricePaise: number;
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

export interface CatalogProductDetail extends CatalogProductSummary {
  description: string;
  material: string;
  brand: string;
  brandId: string | null;
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
  priceHistory: CatalogPriceHistoryRow[];
  stock: CatalogStockRow | null;
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

function mapSummary(row: Row): CatalogProductSummary {
  return {
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name),
    subtitle: text(row.subtitle),
    pricePaise: number(row.price_paise),
    currency: text(row.currency) || 'INR',
    isActive: Boolean(row.is_active),
    inStock: Boolean(row.in_stock),
    updatedAt: iso(row.updated_at),
    categoryId: text(row.category_id),
    categorySlug: text(row.category_slug),
    categoryName: text(row.category_name),
  };
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
        select p.id, p.slug, p.name, p.subtitle, p.price_paise, p.currency,
               p.is_active, p.in_stock, p.updated_at,
               c.id as category_id, c.slug as category_slug, c.name as category_name
        from products p
        join categories c on c.id = p.category_id
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

    const products = (productRows as Row[]).map(mapSummary);
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
      select p.id, p.slug, p.name, p.subtitle, p.price_paise, p.currency,
             p.material, p.brand, p.brand_id, p.description, p.badge,
             p.highlights, p.in_the_box, p.seo_title, p.seo_description,
             p.in_stock, p.is_active, p.created_at, p.updated_at,
             c.id as category_id, c.slug as category_slug, c.name as category_name
      from products p
      join categories c on c.id = p.category_id
      where p.id = ${id} and p.deleted_at is null
      limit 1
    `;

    const productRow = (productRows as Row[])[0];
    if (!productRow) return { ok: false, reason: 'not-found' };

    const [facetRows, specRows, imageRows, variantRows, historyRows, stockRows] =
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
          select id, url, alt, role, sort_order, is_active
          from product_images
          where product_id = ${id}
          order by
            case role when 'primary' then 0 when 'hover' then 1 else 2 end,
            sort_order, id
        `,
        sql`
          select id, option_name, option_value, option_hex,
                 price_paise_override, is_active, sort_order
          from product_variants
          where product_id = ${id}
          order by sort_order, option_value
        `,
        sql`
          select id, old_price_paise, new_price_paise, currency, source,
                 reason, changed_by, changed_at
          from price_history
          where product_id = ${id}
          order by changed_at desc, id desc
          limit 25
        `,
        sql`
          select on_hand, reserved, low_stock_threshold, track_inventory,
                 updated_at
          from stock
          where product_id = ${id} and variant_id is null
          limit 1
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
    const images: CatalogImage[] = (imageRows as Row[]).map((row) => ({
      id: text(row.id),
      url: text(row.url),
      alt: text(row.alt),
      role: text(row.role),
      sortOrder: number(row.sort_order),
      isActive: Boolean(row.is_active),
    }));
    const variants: CatalogVariant[] = (variantRows as Row[]).map((row) => ({
      id: text(row.id),
      optionName: text(row.option_name),
      optionValue: text(row.option_value),
      optionHex: row.option_hex === null || row.option_hex === undefined
        ? null
        : text(row.option_hex),
      pricePaiseOverride: nullableNumber(row.price_paise_override),
      isActive: Boolean(row.is_active),
      sortOrder: number(row.sort_order),
    }));
    const priceHistory: CatalogPriceHistoryRow[] = (historyRows as Row[]).map(
      (row) => ({
        id: number(row.id),
        oldPricePaise: nullableNumber(row.old_price_paise),
        newPricePaise: number(row.new_price_paise),
        currency: text(row.currency) || 'INR',
        source: text(row.source),
        reason: text(row.reason),
        changedBy: row.changed_by === null || row.changed_by === undefined
          ? null
          : text(row.changed_by),
        changedAt: iso(row.changed_at),
      }),
    );

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
        description: text(productRow.description),
        material: text(productRow.material),
        brand: text(productRow.brand),
        brandId:
          productRow.brand_id === null || productRow.brand_id === undefined
            ? null
            : text(productRow.brand_id),
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
        priceHistory,
        stock,
      },
    };
  } catch {
    console.warn('[store-admin/catalog] could not read a product');
    return { ok: false, reason: 'unavailable' };
  }
}
