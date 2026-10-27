import { getSql } from '@/lib/admin/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { resolveEffectivePrice } from '@/lib/storefront/pricing';
import { readSaleState } from '@/lib/storefront/sale-state';

import {
  getProductFromCatalog,
  resolveCartItems as resolveStaticCartItems,
  type CatalogItem,
} from './catalog';
import { InsufficientStockError } from './stock';
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

interface PricingRead {
  rows: CatalogPriceRow[];
  /** Untracked products the storefront marks unavailable while no sale is live. */
  unavailable: string[];
}

async function loadPricingRows(ids: string[], saleLive: boolean): Promise<PricingRead> {
  const sql = getSql();
  if (!sql || ids.length === 0) return { rows: [], unavailable: [] };

  const rows = await sql`
    select p.id, p.name, p.subtitle, p.price_paise, p.sale_price_paise,
           p.in_stock, s.track_inventory,
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
    left join stock s on s.product_id = p.id and s.variant_id is null
    where p.deleted_at is null
      and p.is_active
      and lower(p.id) = any(${ids}::text[])
    order by p.id
  `;

  const unavailable: string[] = [];
  const priced = (rows as Record<string, unknown>[]).map((row) => {
    const price = resolveEffectivePrice(
      {
        pricePaise: Number(row.price_paise),
        salePricePaise: row.sale_price_paise === null || row.sale_price_paise === undefined
          ? null
          : Number(row.sale_price_paise),
      },
      saleLive,
    );
    const name = String(row.name ?? '');

    // Same rule as the storefront: an untracked product's availability is
    // `products.in_stock`. Normal mode fails closed on it here as well, so a
    // request that bypasses the page cannot buy a product the shop has marked
    // unavailable. Tracked rows defer to the locked claim in `createOrder`,
    // which also lazily frees expired holds.
    const hasStockRow = row.track_inventory !== null && row.track_inventory !== undefined;
    if (!saleLive && !hasStockRow && row.in_stock === false) {
      unavailable.push(name);
    }

    return {
      id: String(row.id),
      name,
      subtitle: row.subtitle === null || row.subtitle === undefined
        ? null
        : String(row.subtitle),
      // The amount PayU will charge: one resolver decides sale vs regular.
      price_paise: price.unitPaise,
      regular_price_paise: price.onSale ? price.regularPaise : null,
      image_url: row.image_url === null || row.image_url === undefined
        ? null
        : String(row.image_url),
    } satisfies CatalogPriceRow;
  });

  return { rows: priced, unavailable };
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
      items: staticCart.items.map((item) => ({
        ...item,
        unitPaise: Math.round(item.unitPrice * 100),
      })),
      totalPaise: Math.round(staticCart.totalAmount * 100),
      priceChanges: [],
    };
  }

  const ids = knownBaseIds(cartItems);
  let read: PricingRead;
  try {
    const sale = await readSaleState();
    read = await loadPricingRows(ids, sale.live);
  } catch {
    // Never fall back to a code price after a database failure: the whole
    // point of this module is that the amount and the catalogue row agree.
    throw new Error('Checkout pricing is temporarily unavailable. Please try again.');
  }

  const cart = priceCartLines(cartItems, read.rows);

  // Normal mode: the shop has marked this untracked product unavailable.
  // Sale mode deliberately does not block on it; the locked claim at Pay still
  // decides whether tracked units exist.
  if (read.unavailable.length > 0) {
    throw new InsufficientStockError(
      `Out of stock: ${read.unavailable[0]}. Remove it from your bag to continue.`,
    );
  }

  return cart;
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
    const sale = await readSaleState();
    const rows = await sql`
      select p.id, p.name, p.subtitle, p.price_paise, p.sale_price_paise,
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

    const price = resolveEffectivePrice(
      {
        pricePaise: Number(row.price_paise),
        salePricePaise: row.sale_price_paise === null || row.sale_price_paise === undefined
          ? null
          : Number(row.sale_price_paise),
      },
      sale.live,
    );
    const pricePaise = price.unitPaise;
    if (!Number.isSafeInteger(pricePaise) || pricePaise < 0) return null;

    return {
      id: String(row.id),
      name: `${row.name} - ${row.subtitle || ''}`.trim(),
      price: pricePaise / 100,
      ...(price.onSale ? { regularPrice: price.regularPaise / 100 } : {}),
      image: row.image_url ? String(row.image_url) : undefined,
    };
  } catch {
    console.warn('[payu/db-catalog] could not resolve a checkout product');
    return null;
  }
}
