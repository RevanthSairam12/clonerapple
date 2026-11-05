import { getSql } from '@/lib/platform/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { resolveEffectivePrice } from '@/lib/storefront/pricing';
import { readSaleState, readSaleStateUsing } from '@/lib/storefront/sale-state';
import type postgres from 'postgres';

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

async function loadPricingRows(
  ids: string[],
  saleLive: boolean,
  sql: postgres.Sql | postgres.TransactionSql | null = getSql(),
): Promise<PricingRead> {
  if (!sql || ids.length === 0) return { rows: [], unavailable: [] };

  // 0059/0060 may not be applied yet: read the shared colour link only when the
  // tables exist, so checkout keeps working on an older database.
  const [capabilities] = await sql<Array<{ colours: boolean }>>`
    select (to_regclass('colours') is not null
      and to_regclass('product_variant_colours') is not null) as colours
  `;
  const sharedColours = capabilities?.colours === true;

  // The photo this line sells: the chosen colour's own photo first, then the
  // product's unlinked (default) photos, then anything else. Hover photos are
  // never sold with a line.
  const imageColumn = sharedColours
    ? sql`(
        select pi.url || chr(31) || coalesce(pi.alt, '')
        from product_images pi
        where pi.product_id = p.id
          and pi.is_active
          and pi.deleted_at is null
        order by
          case
            when (to_jsonb(pi)->>'colour_id') = vc.colour_id then 0
            when (to_jsonb(pi)->>'colour_id') is null then 1
            else 2
          end,
          case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
          pi.sort_order,
          pi.id
        limit 1
      ) as image`
    : sql`(
        select pi.url || chr(31) || coalesce(pi.alt, '')
        from product_images pi
        where pi.product_id = p.id
          and pi.is_active
          and pi.deleted_at is null
        order by
          case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
          pi.sort_order,
          pi.id
        limit 1
      ) as image`;
  const snapshotColumns = sharedColours
    ? sql`v.device_model_id as variant_device_model_id, dm.name as variant_device_model_name,
           vc.colour_id as variant_colour_id, col.name as variant_colour_name,
           col.hex as variant_colour_hex,`
    : sql`v.device_model_id as variant_device_model_id, dm.name as variant_device_model_name,
           null::text as variant_colour_id, null::text as variant_colour_name,
           null::text as variant_colour_hex,`;
  const colourJoins = sharedColours
    ? sql`left join product_variant_colours vc on vc.variant_id = v.id
          left join colours col on col.id = vc.colour_id`
    : sql``;

  const rows = await sql`
    select p.id, p.name, p.subtitle, p.inventory_mode,
           p.price_paise, p.sale_price_paise,
           v.price_paise_override as option_price_paise,
           v.sale_price_paise as option_sale_price_paise,
           v.id as variant_id,v.sku as variant_sku,
           concat_ws(' / ',dm.name,v.option_value) as variant_label,
           ${snapshotColumns}
           p.category_id, p.brand_id,
           p.in_stock, s.track_inventory,
           ${imageColumn}
    from products p
    join categories c on c.id = p.category_id and c.is_active and c.deleted_at is null
    left join product_variants v on v.product_id=p.id and p.inventory_mode='variant'
      and v.is_active and v.is_purchasable and v.retired_at is null
      and nullif(trim(v.sku), '') is not null and nullif(trim(v.combination_key), '') is not null
    left join device_models dm on dm.id=v.device_model_id
    left join device_brands db on db.id=dm.brand_id
    left join product_types pt on pt.id=p.product_type_id
    left join stock s on s.product_id=p.id and s.variant_id is not distinct from v.id
    ${colourJoins}
    where p.deleted_at is null
      and (p.inventory_mode='product' or (v.id is not null and s.id is not null
        and (not coalesce(pt.requires_compatibility,false) or v.device_model_id is not null)
        and (v.device_model_id is null or (dm.id is not null and db.id is not null and exists(
          select 1 from product_device_models pdm where pdm.product_id=p.id and pdm.device_model_id=v.device_model_id and pdm.archived_at is null)))))
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
      row.variant_id ? {
        pricePaise: row.option_price_paise == null ? null : Number(row.option_price_paise),
        salePricePaise: row.option_sale_price_paise == null ? null : Number(row.option_sale_price_paise),
      } : null,
    );
    const name = String(row.name ?? '');

    // Same rule as the storefront: an untracked product's availability is
    // `products.in_stock`. Normal mode fails closed on it here as well, so a
    // request that bypasses the page cannot buy a product the shop has marked
    // unavailable. Tracked rows defer to the locked claim in `createOrder`,
    // which also lazily frees expired holds.
    if (!saleLive && row.inventory_mode !== 'variant' && row.track_inventory !== true && row.in_stock === false) {
      unavailable.push(name);
    }

    const [imageUrl, imageAlt] = row.image === null || row.image === undefined
      ? ['', '']
      : String(row.image).split(String.fromCharCode(31));
    const optionalText = (value: unknown) =>
      value === null || value === undefined || String(value).trim() === '' ? null : String(value);

    return {
      id: String(row.id),
      inventory_mode: String(row.inventory_mode || 'product'),
      variant_id: row.variant_id ? String(row.variant_id) : null,
      variant_sku: row.variant_sku ? String(row.variant_sku) : null,
      variant_label: row.variant_label ? String(row.variant_label) : null,
      name,
      subtitle: row.subtitle === null || row.subtitle === undefined
        ? null
        : String(row.subtitle),
      // The amount PayU will charge: one resolver decides sale vs regular.
      price_paise: price.unitPaise,
      regular_price_paise: price.onSale ? price.regularPaise : null,
      image_url: imageUrl || null,
      image_alt: imageAlt || `${name}${row.variant_label ? ` — ${String(row.variant_label)}` : ''}`,
      variant_device_model_id: optionalText(row.variant_device_model_id),
      variant_device_model_name: optionalText(row.variant_device_model_name),
      variant_colour_id: optionalText(row.variant_colour_id),
      variant_colour_name: optionalText(row.variant_colour_name),
      variant_colour_hex: optionalText(row.variant_colour_hex),
      category_id: row.category_id === null || row.category_id === undefined
        ? null
        : String(row.category_id),
      brand_id: row.brand_id === null || row.brand_id === undefined
        ? null
        : String(row.brand_id),
      on_sale: price.onSale,
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

/** Resolve payment prices on the order's connection, after its stock locks. */
export async function resolveCartItemsFromDbUsing(
  sql: postgres.Sql | postgres.TransactionSql,
  cartItems: ReadonlyArray<CartPricingInput>,
): Promise<PricedCart> {
  const sale = await readSaleStateUsing(sql, { authoritative: true });
  const read = await loadPricingRows(knownBaseIds(cartItems), sale.live, sql);
  const cart = priceCartLines(cartItems, read.rows);
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
      join categories c on c.id = p.category_id and c.is_active and c.deleted_at is null
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
