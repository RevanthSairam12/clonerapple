import { randomBytes } from 'crypto';
import { getSql } from '@/lib/platform/db';
import {
  formatPaise,
  getStorefrontProduct,
  getStorefrontProducts,
  type StorefrontProduct,
} from '@/lib/catalog/storefront';
import { readSaleState } from '@/lib/storefront/sale-state';

export interface BrowsingHistoryItem {
  id: string;
  productId: string;
  name: string;
  subtitle: string;
  image: string;
  href: string;
  pricePaise: number;
  priceDisplay: string;
  regularPricePaise: number;
  wasPriceDisplay: string | null;
  onSale: boolean;
  inStock: boolean;
  viewCount: number;
  lastViewedAt: Date;
}

export const MAX_BROWSING_HISTORY_ITEMS = 50;
export const BROWSING_HISTORY_RETENTION_DAYS = 90;
const DEBOUNCE_SECONDS = 60;

/**
 * Record a product view server-side for signed-in customers only.
 * Debounced, capped at 50 products per customer, never for guests,
 * and never for archived products.
 */
export async function recordProductView(userId: string, productId: string): Promise<boolean> {
  if (!userId || !productId) return false;
  const sql = getSql();
  if (!sql) return false;

  try {
    // 1. Check if customer has opted out of browsing history
    const userRows = await sql<Array<{ save_browsing_history: boolean }>>`
      select save_browsing_history
      from users
      where id = ${userId}
      limit 1
    `;
    if (!userRows[0] || !userRows[0].save_browsing_history) {
      return false;
    }

    // 2. Check if product exists and is active (not archived)
    const product = await getStorefrontProduct(productId);
    if (!product) {
      return false;
    }

    // 3. Debounce: if viewed within DEBOUNCE_SECONDS, skip bumping view count
    const existing = await sql<Array<{ last_viewed_at: string | Date }>>`
      select last_viewed_at
      from customer_browsing_history
      where user_id = ${userId} and product_id = ${productId}
      limit 1
    `;
    if (existing[0]) {
      const lastViewed = new Date(existing[0].last_viewed_at).getTime();
      if (Date.now() - lastViewed < DEBOUNCE_SECONDS * 1000) {
        return false;
      }
    }

    // 4. Upsert view
    const newId = `cbh_${randomBytes(12).toString('hex')}`;
    await sql`
      insert into customer_browsing_history (id, user_id, product_id, view_count, last_viewed_at)
      values (${newId}, ${userId}, ${productId}, 1, now())
      on conflict (user_id, product_id) do update set
        view_count = customer_browsing_history.view_count + 1,
        last_viewed_at = now()
    `;

    // 5. Cap at 50 products per customer
    await sql`
      delete from customer_browsing_history
      where user_id = ${userId}
        and id not in (
          select id from customer_browsing_history
          where user_id = ${userId}
          order by last_viewed_at desc
          limit ${MAX_BROWSING_HISTORY_ITEMS}
        )
    `;

    return true;
  } catch (err) {
    console.warn('[browsing-history] record error:', err);
    return false;
  }
}

/**
 * Prune rows older than maxAgeDays (called by the reconcile worker).
 * Never deletes anything else.
 */
export async function pruneOldBrowsingHistory(maxAgeDays = BROWSING_HISTORY_RETENTION_DAYS): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  const safeDays = Math.max(1, Math.min(365, maxAgeDays));
  const res = await sql`
    delete from customer_browsing_history
    where last_viewed_at < now() - (${safeDays} || ' days')::interval
  `;
  return res.count;
}

/**
 * Customer settings for browsing history.
 */
export async function getBrowsingHistorySettings(userId: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return true;
  const rows = await sql<Array<{ save_browsing_history: boolean }>>`
    select save_browsing_history
    from users
    where id = ${userId}
    limit 1
  `;
  return rows[0]?.save_browsing_history ?? true;
}

export async function setBrowsingHistorySettings(
  userId: string,
  saveBrowsingHistory: boolean,
  clearExisting = false,
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    update users
    set save_browsing_history = ${saveBrowsingHistory}, updated_at = now()
    where id = ${userId}
  `;
  if (!saveBrowsingHistory && clearExisting) {
    await sql`
      delete from customer_browsing_history
      where user_id = ${userId}
    `;
  }
}

/**
 * List browsing history for a customer (most recent first, up to 50).
 */
export async function listBrowsingHistory(userId: string): Promise<BrowsingHistoryItem[]> {
  const sql = getSql();
  if (!sql) return [];

  const rows = await sql<Array<{
    id: string;
    product_id: string;
    view_count: number;
    last_viewed_at: string | Date;
  }>>`
    select id, product_id, view_count, last_viewed_at
    from customer_browsing_history
    where user_id = ${userId}
    order by last_viewed_at desc
    limit ${MAX_BROWSING_HISTORY_ITEMS}
  `;

  if (rows.length === 0) return [];

  const productIds = rows.map((r) => r.product_id);
  const products: StorefrontProduct[] = await getStorefrontProducts(productIds);
  const productMap = new Map<string, StorefrontProduct>(products.map((p) => [p.id, p]));

  const items: BrowsingHistoryItem[] = [];
  for (const row of rows) {
    const product = productMap.get(row.product_id);
    if (!product) continue; // Skip archived or deleted products
    items.push({
      id: row.id,
      productId: product.id,
      name: product.name,
      subtitle: product.subtitle,
      image: product.image,
      href: product.href,
      pricePaise: product.pricePaise,
      priceDisplay: product.priceDisplay,
      regularPricePaise: product.regularPricePaise,
      wasPriceDisplay: product.onSale ? formatPaise(product.regularPricePaise) : null,
      onSale: product.onSale,
      inStock: product.inStock,
      viewCount: row.view_count,
      lastViewedAt: new Date(row.last_viewed_at),
    });
  }

  return items;
}

export async function removeBrowsingHistoryItem(userId: string, productId: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const res = await sql`
    delete from customer_browsing_history
    where user_id = ${userId} and product_id = ${productId}
  `;
  return res.count > 0;
}

export async function clearBrowsingHistory(userId: string): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  const res = await sql`
    delete from customer_browsing_history
    where user_id = ${userId}
  `;
  return res.count;
}

/**
 * Recommendations for the dashboard.
 * Active, in-stock products from the same categories and brands the customer viewed
 * or bought, excluding items they already bought recently and anything archived.
 * At most 12 per row.
 */
export async function getDashboardRecommendations(userId: string): Promise<{
  recentlyViewed: BrowsingHistoryItem[];
  inspiredByHistory: BrowsingHistoryItem[];
}> {
  const sql = getSql();
  if (!sql) return { recentlyViewed: [], inspiredByHistory: [] };

  // 1. Get customer's history
  const history = await listBrowsingHistory(userId);
  if (history.length === 0) {
    return { recentlyViewed: [], inspiredByHistory: [] };
  }

  const recentlyViewed = history.slice(0, 12);

  // 2. Get customer's purchased product IDs to exclude
  const purchasedRows = await sql<Array<{ product_id: string }>>`
    select distinct oi.product_id
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.user_id = ${userId}
      and o.status = 'PAID'
      and oi.product_id <> ''
  `;
  const purchasedIds = new Set(purchasedRows.map((r) => r.product_id));
  const viewedIds = new Set(history.map((h) => h.productId));

  // 3. Find categories and brands customer interacted with
  const viewedProducts: StorefrontProduct[] = await getStorefrontProducts(Array.from(viewedIds));
  const categoryIds = new Set<string>();
  const brands = new Set<string>();

  for (const p of viewedProducts) {
    if (p.categoryId) categoryIds.add(p.categoryId);
    if (p.brand) brands.add(p.brand.toLowerCase());
  }

  // 4. Query candidate products matching category or brand
  let candidateRows: Array<{ id: string }> = [];
  if (categoryIds.size > 0 || brands.size > 0) {
    const catArray = Array.from(categoryIds);
    const brandArray = Array.from(brands);

    candidateRows = await sql<Array<{ id: string }>>`
      select p.id
      from products p
      left join stock s on s.product_id = p.id
      where p.is_active = true
        and p.deleted_at is null
        and (
          p.category_id = any(${catArray}::text[])
          or lower(p.brand) = any(${brandArray}::text[])
        )
      order by p.created_at desc
      limit 40
    `;
  }

  const candidateIds = candidateRows
    .map((r) => r.id)
    .filter((id) => !purchasedIds.has(id) && !viewedIds.has(id));

  const products: StorefrontProduct[] = await getStorefrontProducts(candidateIds);

  const inspiredByHistory: BrowsingHistoryItem[] = products
    .filter((p: StorefrontProduct) => p.inStock)
    .slice(0, 12)
    .map((product: StorefrontProduct) => ({
      id: product.id,
      productId: product.id,
      name: product.name,
      subtitle: product.subtitle,
      image: product.image,
      href: product.href,
      pricePaise: product.pricePaise,
      priceDisplay: product.priceDisplay,
      regularPricePaise: product.regularPricePaise,
      wasPriceDisplay: product.onSale ? formatPaise(product.regularPricePaise) : null,
      onSale: product.onSale,
      inStock: product.inStock,
      viewCount: 1,
      lastViewedAt: new Date(),
    }));

  return {
    recentlyViewed,
    inspiredByHistory,
  };
}
