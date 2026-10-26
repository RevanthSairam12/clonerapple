import { getSql } from '@/lib/admin/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';

import {
  getProductFromCatalog,
  resolveCartItems as resolveStaticCartItems,
  type CatalogItem,
} from './catalog';
import {
  priceCartLines,
  type CartPricingInput,
  type CatalogPriceRow,
  type PricedCart,
} from './db-pricing';

/**
 * Database-backed resolution for the payment path.
 *
 * `src/lib/payu/catalog.ts` remains the display catalogue: storefront cards,
 * bags and product pages read static data synchronously in the browser. The
 * payment path must not. Every amount that reaches PayU is resolved here from
 * `products.price_paise`, and an unknown or inactive id is rejected rather than
 * falling back to a code price.
 *
 * When DATABASE_URL is unset (a local build, or a checkout that has no database
 * at all) the static catalogue is used so development still works. That is the
 * only fallback: once a database is configured, a query failure fails closed.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Payment pricing must be resolved on the server only.');
}

function knownBaseIds(cartItems: ReadonlyArray<CartPricingInput>): string[] {
  const ids = new Set<string>();
  for (const item of cartItems) {
    const normalized = normalizeCartLineId(item && item.id);
    if (normalized.baseId) ids.add(normalized.baseId);
  }
  return [...ids];
}

async function loadPricingRows(ids: string[]): Promise<CatalogPriceRow[]> {
  const sql = getSql();
  if (!sql || ids.length === 0) return [];

  const rows = await sql`
    select p.id, p.name, p.subtitle, p.price_paise,
           (
             select pi.url
             from product_images pi
             where pi.product_id = p.id
               and pi.is_active
               and pi.deleted_at is null
             order by
               case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
               pi.sort_order,
               pi.id
             limit 1
           ) as image_url
    from products p
    where p.deleted_at is null
      and p.is_active
      and lower(p.id) = any(${ids}::text[])
    order by p.id
  `;

  return (rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    subtitle: row.subtitle === null || row.subtitle === undefined
      ? null
      : String(row.subtitle),
    price_paise: row.price_paise as number | string,
    image_url: row.image_url === null || row.image_url === undefined
      ? null
      : String(row.image_url),
  }));
}

/**
 * Resolve a cart from the database and return the exact snapshot used for the
 * order and the PayU hash. Throws on any product or price problem.
 */
export async function resolveCartItemsFromDb(
  cartItems: ReadonlyArray<CartPricingInput>,
): Promise<PricedCart> {
  if (!getSql()) {
    console.warn(
      '[payu/db-catalog] DATABASE_URL is not set — payment pricing fell back to the static catalogue.',
    );
    const staticCart = resolveStaticCartItems(
      cartItems as Array<{ id: string; quantity: number }>,
    );
    return {
      ...staticCart,
      totalPaise: Math.round(staticCart.totalAmount * 100),
    };
  }

  const ids = knownBaseIds(cartItems);
  let rows: CatalogPriceRow[];
  try {
    rows = await loadPricingRows(ids);
  } catch {
    // Never fall back to a code price after a database failure: the whole
    // point of this module is that the amount and the catalogue row agree.
    throw new Error('Checkout pricing is temporarily unavailable. Please try again.');
  }

  return priceCartLines(cartItems, rows);
}

/**
 * Resolve the product named by `?productId=` for the checkout page.
 * Returns null for an unknown or inactive row; the page renders its
 * "unavailable" state rather than a stale code price.
 */
export async function getProductFromDatabase(id: string): Promise<CatalogItem | null> {
  const sql = getSql();
  if (!sql) return getProductFromCatalog(id);

  const normalized = normalizeCartLineId(id);
  if (!normalized.baseId) return null;

  try {
    const rows = await sql`
      select p.id, p.name, p.subtitle, p.price_paise,
             (
               select pi.url
               from product_images pi
               where pi.product_id = p.id
                 and pi.is_active
                 and pi.deleted_at is null
               order by
                 case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
                 pi.sort_order,
                 pi.id
               limit 1
             ) as image_url
      from products p
      where p.deleted_at is null
        and p.is_active
        and lower(p.id) = ${normalized.baseId}
      limit 1
    `;

    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;

    const pricePaise = Math.round(Number(row.price_paise));
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 0) return null;

    return {
      id: String(row.id),
      name: `${row.name} - ${row.subtitle || ''}`.trim(),
      price: pricePaise / 100,
      image: row.image_url ? String(row.image_url) : undefined,
    };
  } catch {
    console.warn('[payu/db-catalog] could not resolve a checkout product');
    return null;
  }
}
