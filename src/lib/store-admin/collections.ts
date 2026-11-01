import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { formatPaise } from '@/lib/catalog/storefront';

import type { CatalogWrite } from './catalog-writes';
import { MAX_COLLECTION_PRODUCTS } from './collection-rules';

type Tx = postgres.TransactionSql;

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Product collections are written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fail(
  reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict',
  error: string,
): { ok: false; reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict'; error: string } {
  return { ok: false, reason, error };
}

export interface StoreCollectionProduct {
  productId: string;
  name: string;
  categoryName: string;
  priceDisplay: string;
  position: number;
}

export interface StoreCollection {
  key: string;
  products: StoreCollectionProduct[];
}

export interface CollectionProductOption {
  id: string;
  name: string;
  categoryName: string;
  priceDisplay: string;
  inCollection: string[];
}

/**
 * Every live collection with its ordered, active products. A collection with
 * only archived membership is not listed; the storefront will fall back to
 * the page's own list for that key.
 */
export async function listStoreCollections(): Promise<CatalogWrite<StoreCollection[]>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    const rows = (await sql`
      select pc.collection_key, pc.product_id, pc.position,
             p.name, p.price_paise, c.name as category_name
      from product_collections pc
      join products p on p.id = pc.product_id
      left join categories c on c.id = p.category_id
      where pc.is_active
        and p.deleted_at is null
        and p.is_active
      order by pc.collection_key asc, pc.position asc, pc.product_id asc
      limit 2000
    `) as Row[];

    const byKey = new Map<string, StoreCollection>();
    for (const row of rows) {
      const key = text(row.collection_key);
      const bucket = byKey.get(key) ?? { key, products: [] };
      bucket.products.push({
        productId: text(row.product_id),
        name: text(row.name),
        categoryName: text(row.category_name),
        priceDisplay: formatPaise(number(row.price_paise)),
        position: number(row.position),
      });
      byKey.set(key, bucket);
    }

    return { ok: true, data: [...byKey.values()] };
  } catch {
    console.warn('[store-admin/collections] could not read collections');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/**
 * Active products available to add, with the keys they already belong to.
 * This is the picker's data; it never includes archived or inactive products.
 */
export async function listCollectionProductOptions(): Promise<
  CatalogWrite<CollectionProductOption[]>
> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    const [products, memberships] = await Promise.all([
      sql`
        select p.id, p.name, p.price_paise, c.name as category_name
        from products p
        left join categories c on c.id = p.category_id
        where p.deleted_at is null and p.is_active
        order by c.name asc, p.name asc
        limit 500
      `,
      sql`
        select collection_key, product_id
        from product_collections
        where is_active
        limit 5000
      `,
    ]);

    const keysByProduct = new Map<string, string[]>();
    for (const row of memberships as Row[]) {
      const productId = text(row.product_id);
      const list = keysByProduct.get(productId) ?? [];
      list.push(text(row.collection_key));
      keysByProduct.set(productId, list);
    }

    return {
      ok: true,
      data: (products as Row[]).map((row) => ({
        id: text(row.id),
        name: text(row.name),
        categoryName: text(row.category_name),
        priceDisplay: formatPaise(number(row.price_paise)),
        inCollection: keysByProduct.get(text(row.id)) ?? [],
      })),
    };
  } catch {
    console.warn('[store-admin/collections] could not read product options');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export interface CollectionSnapshot {
  before: StoreCollectionProduct[];
  after: StoreCollectionProduct[];
}

async function readCollection(
  tx: Tx,
  key: string,
): Promise<StoreCollectionProduct[]> {
  const rows = (await tx`
    select pc.product_id, pc.position, p.name, p.price_paise, c.name as category_name
    from product_collections pc
    join products p on p.id = pc.product_id
    left join categories c on c.id = p.category_id
    where pc.collection_key = ${key} and pc.is_active
    order by pc.position asc, pc.product_id asc
  `) as Row[];
  return rows.map((row) => ({
    productId: text(row.product_id),
    name: text(row.name),
    categoryName: text(row.category_name),
    priceDisplay: formatPaise(number(row.price_paise)),
    position: number(row.position),
  }));
}

/** Add one active product to a collection (reactivating an archived row). */
export async function addCollectionProduct(
  collectionKey: string,
  productId: string,
): Promise<CatalogWrite<CollectionSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const before = await readCollection(tx, collectionKey);

      const exists = (await tx`
        select 1 from product_collections
        where collection_key = ${collectionKey} and product_id = ${productId}
        limit 1
      `) as Row[];
      if (exists.length === 0 && before.length >= MAX_COLLECTION_PRODUCTS) {
        return fail(
          'conflict',
          `A collection holds at most ${MAX_COLLECTION_PRODUCTS} products.`,
        );
      }

      const inserted = (await tx`
        insert into product_collections (collection_key, product_id, position, is_active)
        select ${collectionKey}, p.id,
               coalesce(
                 (select max(position) + 1 from product_collections
                  where collection_key = ${collectionKey} and is_active),
                 0
               ),
               true
        from products p
        where p.id = ${productId} and p.deleted_at is null and p.is_active
        on conflict (collection_key, product_id) do update
        set is_active = true, updated_at = now()
        returning product_id
      `) as Row[];

      if (inserted.length === 0) {
        return fail('not-found', 'That product is not available.');
      }

      const after = await readCollection(tx, collectionKey);
      return { ok: true, data: { before, after } };
    });
  } catch {
    console.warn('[store-admin/collections] could not add a product');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/** Remove one product by archiving its membership row. */
export async function removeCollectionProduct(
  collectionKey: string,
  productId: string,
): Promise<CatalogWrite<CollectionSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const before = await readCollection(tx, collectionKey);
      const updated = (await tx`
        update product_collections
        set is_active = false, updated_at = now()
        where collection_key = ${collectionKey}
          and product_id = ${productId}
          and is_active
        returning product_id
      `) as Row[];

      if (updated.length === 0) {
        return fail('not-found', 'That product is not in this collection.');
      }

      const after = await readCollection(tx, collectionKey);
      return { ok: true, data: { before, after } };
    });
  } catch {
    console.warn('[store-admin/collections] could not remove a product');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/**
 * Replace the ordered membership of a collection. Products omitted from the
 * list are archived; the supplied ids must all be live products.
 */
export async function reorderCollection(
  collectionKey: string,
  productIds: string[],
): Promise<CatalogWrite<CollectionSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const before = await readCollection(tx, collectionKey);

      if (productIds.length > 0) {
        const live = (await tx`
          select id from products
          where id in ${tx(productIds)} and deleted_at is null and is_active
        `) as Row[];
        const liveIds = new Set(live.map((row) => text(row.id)));
        const missing = productIds.filter((id) => !liveIds.has(id));
        if (missing.length > 0) {
          return fail('not-found', `Product ${missing[0]} is not available.`);
        }

        await tx`
          update product_collections
          set is_active = false, updated_at = now()
          where collection_key = ${collectionKey}
            and is_active
            and product_id not in ${tx(productIds)}
        `;
      } else {
        await tx`
          update product_collections
          set is_active = false, updated_at = now()
          where collection_key = ${collectionKey} and is_active
        `;
      }

      for (const [position, productId] of productIds.entries()) {
        await tx`
          insert into product_collections (collection_key, product_id, position, is_active)
          values (${collectionKey}, ${productId}, ${position}, true)
          on conflict (collection_key, product_id) do update
          set position = excluded.position, is_active = true, updated_at = now()
        `;
      }

      const after = await readCollection(tx, collectionKey);
      return { ok: true, data: { before, after } };
    });
  } catch {
    console.warn('[store-admin/collections] could not reorder a collection');
    return fail('unavailable', 'The catalogue is not available.');
  }
}
