/**
 * Pure planning rules for the one-way CMS -> catalogue product migration.
 *
 * The legacy editor's older Cases & Protection shape described products inline
 * (name, price, image, badge). Products are now owned by the store admin, so
 * `scripts/migrate-cms-products.mjs` maps those items onto `products` rows by
 * product id or variant SKU. Two rules keep it safe:
 *
 * 1. The database wins. A non-empty database value is never overwritten by a
 *    CMS value; only an empty database field is filled.
 * 2. Never guess. An item with no id or SKU, or with an id/SKU that matches no
 *    product, is reported as unmatched and left alone.
 *
 * No database or React imports, so tests can exercise this directly.
 */

export interface CmsProductItem {
  /** Path inside the stored value, e.g. `products[2]`. */
  path: string;
  id: string;
  sku: string;
  name: string;
  subtitle: string;
  description: string;
  badge: string;
  image: string;
  /** Rupee price from the CMS converted to paise, when one was present. */
  pricePaise: number | null;
  /** The original price text, for the drift report. */
  priceLabel: string;
}

export interface CmsProductRow {
  id: string;
  price_paise: number;
  name: string;
  subtitle: string;
  description: string;
  badge: string | null;
}

export interface CmsVariantRow {
  sku: string | null;
  product_id: string;
}

export interface CmsMigrationPlan {
  fills: {
    subtitle?: string;
    description?: string;
    badge?: string;
  };
  /** Primary image to add when the product has no live image at all. */
  addImage: string | null;
  imageRowId: string | null;
  /** Fields where the database already held a different value. */
  kept: string[];
  /** Non-fatal observations for the report (name/price drift). */
  notes: string[];
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** True only for the legacy collections that could carry inline products. */
export function isCmsProductCollectionKey(key: string): boolean {
  return key.startsWith('cases.');
}

/**
 * Parse a rupee amount from a CMS value. Numbers are rupees; strings may carry
 * a ₹ sign, Indian grouping commas and surrounding whitespace. Returns paise.
 */
export function parseRupeePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  const raw = text(value)
    .replace(/[₹,\s]/g, '')
    .replace(/^rs\.?/i, '');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function asItem(entry: unknown, path: string): CmsProductItem | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const row = entry as Record<string, unknown>;

  // `pricePaise`/`price_paise` are already paise; `price` and `priceDisplay`
  // are the rupee values the old editor showed.
  let pricePaise: number | null = null;
  if (row.pricePaise !== undefined || row.price_paise !== undefined) {
    const paise = Number(row.pricePaise ?? row.price_paise);
    pricePaise = Number.isFinite(paise) && paise >= 0 ? Math.round(paise) : null;
  } else {
    pricePaise = parseRupeePrice(row.price ?? row.priceDisplay);
  }

  const item: CmsProductItem = {
    path,
    id: text(row.id ?? row.productId ?? row.product_id),
    sku: text(row.sku),
    name: text(row.name ?? row.title),
    subtitle: text(row.subtitle),
    description: text(row.description),
    badge: text(row.badge),
    image: text(row.image ?? row.imageSrc),
    pricePaise,
    priceLabel: text(row.priceDisplay ?? row.price),
  };

  // Ignore structural noise, but keep anything that looks like a product.
  if (!item.id && !item.sku && !item.name && !item.image && item.pricePaise === null) {
    return null;
  }
  return item;
}

/**
 * Extract product-shaped items from a legacy `cases.*` value. Only arrays at
 * `products` or `items` are considered; everything else is page furniture and
 * stays in the CMS.
 */
export function parseCmsProductItems(key: string, value: unknown): CmsProductItem[] {
  if (!isCmsProductCollectionKey(key) || !value || typeof value !== 'object') return [];

  const source = value as Record<string, unknown>;
  const lists: Array<[string, unknown]> = [
    ['products', source.products],
    ['items', source.items],
  ];

  const items: CmsProductItem[] = [];
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) continue;
    list.forEach((entry, index) => {
      const item = asItem(entry, `${name}[${index}]`);
      if (item) items.push(item);
    });
  }
  return items;
}

/**
 * Resolve an item to a product by id first, then by variant SKU. Name matching
 * is deliberately not supported: two products may share a name, and guessing
 * would write to the wrong row.
 */
export function resolveCmsItemProduct(
  item: CmsProductItem,
  products: CmsProductRow[],
  variants: CmsVariantRow[],
): string | null {
  if (item.id) {
    const exact = products.find((product) => product.id === item.id);
    if (exact) return exact.id;
    const folded = item.id.toLowerCase();
    const insensitive = products.find((product) => product.id.toLowerCase() === folded);
    if (insensitive) return insensitive.id;
  }

  if (item.sku) {
    const folded = item.sku.toLowerCase();
    const variant = variants.find(
      (row) => row.sku !== null && row.sku.trim().toLowerCase() === folded,
    );
    if (variant) return variant.product_id;
  }

  return null;
}

/** Local absolute or HTTPS image only — never a script/data URL. */
export function isSafeImageUrl(value: string): boolean {
  const url = value.trim();
  if (!url) return false;
  if (url.startsWith('//')) return false;
  if (url.startsWith('/')) return true;
  return url.startsWith('https://');
}

/** Deterministic id so a repeated run cannot create a second primary image. */
export function cmsImageRowId(productId: string): string {
  return `cms_${productId}`;
}

/**
 * Decide what (if anything) to write for one matched item. The database wins:
 * a non-empty product field is kept even when the CMS disagrees, and the
 * disagreement is reported in `kept`/`notes` rather than rewritten.
 */
export function planCmsItemMigration(
  item: CmsProductItem,
  product: CmsProductRow,
  liveImageUrls: string[],
): CmsMigrationPlan {
  const fills: CmsMigrationPlan['fills'] = {};
  const kept: string[] = [];
  const notes: string[] = [];

  if (item.subtitle) {
    if (!product.subtitle) fills.subtitle = item.subtitle;
    else if (product.subtitle !== item.subtitle) kept.push('subtitle');
  }

  if (item.description) {
    if (!product.description) fills.description = item.description;
    else if (product.description !== item.description) kept.push('description');
  }

  if (item.badge) {
    const current = (product.badge ?? '').trim();
    if (!current) fills.badge = item.badge;
    else if (current !== item.badge) kept.push('badge');
  }

  if (item.name && item.name !== product.name) {
    notes.push(`name differs (kept database "${product.name}")`);
  }

  if (item.pricePaise !== null && item.pricePaise !== product.price_paise) {
    kept.push('price');
    notes.push(
      `price differs: CMS ${item.priceLabel || item.pricePaise / 100}, ` +
        `database ${product.price_paise / 100} — database kept`,
    );
  }

  const hasLiveImage = liveImageUrls.some((url) => url.trim() !== '');
  const addImage =
    !hasLiveImage && isSafeImageUrl(item.image) ? item.image.trim() : null;

  if (hasLiveImage && item.image) kept.push('image');

  return {
    fills,
    addImage,
    imageRowId: addImage ? cmsImageRowId(product.id) : null,
    kept,
    notes,
  };
}
