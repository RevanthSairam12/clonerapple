import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

import {
  checkPricePair,
  createsCategoryCycle,
  stockAvailable,
  type CategoryInput,
  type ConditionInput,
  type NewProductInput,
  type PricePatch,
  type StockAdjustmentInput,
  type StockSettingsInput,
  type VariantInput,
} from './catalog-crud-rules';
import type { CatalogWrite, CatalogWriteFailure } from './catalog-writes';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The catalogue must be written on the server only.');
}

type Row = Record<string, unknown>;

function fail(
  reason: CatalogWriteFailure,
  error: string,
): { ok: false; reason: CatalogWriteFailure; error: string } {
  return { ok: false, reason, error };
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/* ---------------------------------------------------------------- reads */

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  navLabel: string;
  title: string;
  subhead: string;
  seoTitle: string;
  seoDescription: string;
}

export interface ConditionsLoad {
  ok: true;
  conditions: { id: string; label: string; description: string; sortOrder: number; isActive: boolean }[];
}

export async function listCategoryTree(): Promise<CatalogWrite<CategoryNode[]>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  try {
    const rows = (await sql`
      select c.id, c.slug, c.name, c.parent_id, c.sort_order, c.is_active,
             c.nav_label, c.title, c.subhead, c.seo_title, c.seo_description,
             (select count(*)::int from products p
              where p.category_id = c.id and p.deleted_at is null) as product_count
      from categories c
      where c.deleted_at is null
      order by c.sort_order asc, c.name asc
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        slug: text(row.slug),
        name: text(row.name),
        parentId: nullableText(row.parent_id),
        sortOrder: number(row.sort_order),
        isActive: Boolean(row.is_active),
        productCount: number(row.product_count),
        navLabel: text(row.nav_label),
        title: text(row.title),
        subhead: text(row.subhead),
        seoTitle: text(row.seo_title),
        seoDescription: text(row.seo_description),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read the category tree');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function listConditions(): Promise<CatalogWrite<ConditionsLoad['conditions']>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  try {
    const rows = (await sql`
      select id, label, description, sort_order, is_active
      from conditions
      order by sort_order asc, label asc
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        label: text(row.label),
        description: text(row.description),
        sortOrder: number(row.sort_order),
        isActive: Boolean(row.is_active),
      })),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read conditions');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export interface StockOverviewRow {
  productId: string;
  name: string;
  categoryName: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  stockRowId: string | null;
}

export async function listStockOverview(): Promise<CatalogWrite<StockOverviewRow[]>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  try {
    const rows = (await sql`
      select p.id, p.name, c.name as category_name,
             s.id as stock_id, s.on_hand, s.reserved, s.low_stock_threshold, s.track_inventory
      from products p
      left join categories c on c.id = p.category_id
      left join stock s on s.product_id = p.id and s.variant_id is null
      where p.deleted_at is null
      order by p.name asc
      limit 500
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => {
        const onHand = number(row.on_hand);
        const reserved = number(row.reserved);
        return {
          productId: text(row.id),
          name: text(row.name),
          categoryName: text(row.category_name),
          onHand,
          reserved,
          available: stockAvailable(onHand, reserved),
          lowStockThreshold: number(row.low_stock_threshold),
          trackInventory: Boolean(row.track_inventory),
          stockRowId: nullableText(row.stock_id),
        };
      }),
    };
  } catch {
    console.warn('[store-admin/catalog] could not read stock');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export interface StockMovementRow {
  id: number;
  delta: number;
  reason: string;
  note: string;
  orderId: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface StockDetail {
  productId: string;
  name: string;
  categoryName: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  movements: StockMovementRow[];
}

export async function getStockDetail(productId: string): Promise<CatalogWrite<StockDetail>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  try {
    const rows = (await sql`
      select p.id, p.name, c.name as category_name,
             s.on_hand, s.reserved, s.low_stock_threshold, s.track_inventory
      from products p
      left join categories c on c.id = p.category_id
      left join stock s on s.product_id = p.id and s.variant_id is null
      where p.id = ${productId} and p.deleted_at is null
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) return fail('not-found', 'Product not found.');

    const movements = (await sql`
      select m.id, m.delta, m.reason, m.note, m.order_id, m.created_at,
             a.email as created_by
      from stock_movements m
      left join store_admins a on a.id = m.created_by
      where m.product_id = ${productId} and m.variant_id is null
      order by m.created_at desc, m.id desc
      limit 100
    `) as Row[];

    const onHand = number(row.on_hand);
    const reserved = number(row.reserved);
    return {
      ok: true,
      data: {
        productId: text(row.id),
        name: text(row.name),
        categoryName: text(row.category_name),
        onHand,
        reserved,
        available: stockAvailable(onHand, reserved),
        lowStockThreshold: number(row.low_stock_threshold),
        trackInventory: Boolean(row.track_inventory),
        movements: movements.map((movement) => ({
          id: number(movement.id),
          delta: number(movement.delta),
          reason: text(movement.reason),
          note: text(movement.note),
          orderId: nullableText(movement.order_id),
          createdAt: movement.created_at instanceof Date
            ? movement.created_at.toISOString()
            : text(movement.created_at),
          createdBy: nullableText(movement.created_by),
        })),
      },
    };
  } catch {
    console.warn('[store-admin/catalog] could not read stock detail');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* ----------------------------------------------------------- categories */

export interface CategorySnapshot {
  created: boolean;
  before: Row | null;
  after: Row;
}

export async function upsertCategory(
  input: CategoryInput,
  staffId: string,
): Promise<CatalogWrite<CategorySnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const treeRows = (await tx`
        select id, parent_id from categories where deleted_at is null
      `) as Row[];
      const parentOf = new Map<string, string | null>(
        treeRows.map((row) => [text(row.id), nullableText(row.parent_id)]),
      );

      const id = input.id ?? input.slug;
      const exists = parentOf.has(id);
      if (input.id && !exists) {
        return fail('not-found', 'Category not found.');
      }
      if (input.parentId) {
        if (!parentOf.has(input.parentId)) {
          return fail('invalid-input', 'That parent category does not exist.');
        }
        if (createsCategoryCycle(parentOf, id, input.parentId)) {
          return fail('invalid-input', 'That would put the category inside itself.');
        }
      }

      const beforeRows = exists
        ? ((await tx`select * from categories where id = ${id} for update`) as Row[])
        : [];
      const before = beforeRows[0] ?? null;

      const rows = before
        ? ((await tx`
            update categories
            set slug = ${input.slug},
                name = ${input.name},
                parent_id = ${input.parentId},
                title = ${input.title},
                subhead = ${input.subhead},
                nav_label = ${input.navLabel},
                seo_title = ${input.seoTitle},
                seo_description = ${input.seoDescription},
                sort_order = ${input.sortOrder},
                is_active = ${input.isActive},
                updated_at = now(),
                updated_by = ${staffId}
            where id = ${id}
            returning *
          `) as Row[])
        : ((await tx`
            insert into categories (
              id, slug, name, parent_id, title, subhead, nav_label,
              seo_title, seo_description, sort_order, is_active, updated_by
            ) values (
              ${id}, ${input.slug}, ${input.name}, ${input.parentId}, ${input.title},
              ${input.subhead}, ${input.navLabel}, ${input.seoTitle},
              ${input.seoDescription}, ${input.sortOrder}, ${input.isActive}, ${staffId}
            )
            returning *
          `) as Row[]);

      return {
        ok: true as const,
        data: { created: !before, before, after: rows[0] ?? {} },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'Another category already uses that slug.');
    }
    console.warn('[store-admin/catalog] could not save a category');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function archiveCategory(
  id: string,
  staffId: string,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from categories where id = ${id} and deleted_at is null for update
      `) as Row[];
      const before = rows[0];
      if (!before) return fail('not-found', 'Category not found.');

      const children = (await tx`
        select 1 from categories where parent_id = ${id} and deleted_at is null limit 1
      `) as Row[];
      if (children[0]) {
        return fail('conflict', 'Move or archive the child categories first.');
      }

      const products = (await tx`
        select 1 from products where category_id = ${id} and deleted_at is null limit 1
      `) as Row[];
      if (products[0]) {
        return fail('conflict', 'Products still use this category. Move them first.');
      }

      const updated = (await tx`
        update categories
        set deleted_at = now(), is_active = false, updated_at = now(), updated_by = ${staffId}
        where id = ${id}
        returning *
      `) as Row[];
      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not archive a category');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* ----------------------------------------------------------- conditions */

export interface ConditionSnapshot {
  created: boolean;
  before: Row | null;
  after: Row;
}

export async function upsertCondition(
  input: ConditionInput,
  staffId: string,
): Promise<CatalogWrite<ConditionSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const id = input.id ?? newId('cond');
      const beforeRows = input.id
        ? ((await tx`select * from conditions where id = ${id} for update`) as Row[])
        : [];
      const before = beforeRows[0] ?? null;
      if (input.id && !before) return fail('not-found', 'Condition not found.');

      const rows = before
        ? ((await tx`
            update conditions
            set label = ${input.label},
                description = ${input.description},
                sort_order = ${input.sortOrder},
                is_active = ${input.isActive},
                updated_at = now()
            where id = ${id}
            returning *
          `) as Row[])
        : ((await tx`
            insert into conditions (id, label, description, sort_order, is_active)
            values (${id}, ${input.label}, ${input.description}, ${input.sortOrder}, ${input.isActive})
            returning *
          `) as Row[]);

      return { ok: true as const, data: { created: !before, before, after: rows[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not save a condition');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function setConditionActive(
  id: string,
  isActive: boolean,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from conditions where id = ${id} for update
      `) as Row[];
      const before = rows[0];
      if (!before) return fail('not-found', 'Condition not found.');
      if (!isActive) {
        const inUse = (await tx`
          select 1 from products
          where condition_id = ${id} and deleted_at is null
          limit 1
        `) as Row[];
        if (inUse[0]) {
          return fail('conflict', 'Products still use this condition. Reassign them first.');
        }
      }
      const updated = (await tx`
        update conditions set is_active = ${isActive}, updated_at = now()
        where id = ${id}
        returning *
      `) as Row[];
      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not change a condition');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* -------------------------------------------------------------- products */

export interface CreatedProduct {
  id: string;
  slug: string;
  name: string;
  pricePaise: number;
  trackInventory: boolean;
  initialOnHand: number;
}

/**
 * Create a product with its opening price and stock row in one transaction.
 *
 * Price writes were gated on checkout reading the database (AGENTS.md); PayU
 * now prices the cart from `products` server-side, so a new product can carry a
 * price and `price_history` records the opening row.
 */
export async function createProduct(
  input: NewProductInput,
  staffId: string,
): Promise<CatalogWrite<CreatedProduct>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const categoryRows = (await tx`
        select 1 from categories where id = ${input.categoryId} and deleted_at is null
      `) as Row[];
      if (!categoryRows[0]) return fail('invalid-input', 'That category does not exist.');

      if (input.brandId) {
        const brandRows = (await tx`
          select name from brands where id = ${input.brandId} and deleted_at is null
        `) as Row[];
        if (!brandRows[0]) return fail('invalid-input', 'That brand does not exist.');
      }
      if (input.conditionId) {
        const conditionRows = (await tx`
          select 1 from conditions where id = ${input.conditionId} and is_active
        `) as Row[];
        if (!conditionRows[0]) return fail('invalid-input', 'That condition does not exist.');
      }

      const inStock = input.trackInventory ? input.initialOnHand > 0 : true;

      const rows = (await tx`
        insert into products (
          id, category_id, slug, name, subtitle, price_paise, compare_at_paise,
          currency, material, brand, brand_id, condition_id, description, badge,
          seo_title, seo_description, in_stock, is_active, updated_by
        ) values (
          ${input.id}, ${input.categoryId}, ${input.slug}, ${input.name},
          ${input.subtitle}, ${input.pricePaise}, ${input.compareAtPaise}, 'INR',
          ${input.material}, ${input.brand}, ${input.brandId}, ${input.conditionId},
          ${input.description}, ${input.badge || null}, ${input.seoTitle},
          ${input.seoDescription}, ${inStock}, ${input.isActive}, ${staffId}
        )
        returning id, slug, name, price_paise
      `) as Row[];
      const product = rows[0];
      if (!product) return fail('unavailable', 'The product was not saved.');

      await tx`
        insert into price_history (
          product_id, variant_id, old_price_paise, new_price_paise, currency, reason,
          source, changed_by
        ) values (
          ${input.id}, null, null, ${input.pricePaise}, 'INR', 'product_created',
          'store_admin', ${staffId}
        )
      `;

      await tx`
        insert into stock (
          id, product_id, variant_id, on_hand, reserved, low_stock_threshold,
          track_inventory, updated_by
        ) values (
          ${newId('stk')}, ${input.id}, null, ${input.initialOnHand}, 0, 0,
          ${input.trackInventory}, ${staffId}
        )
      `;

      if (input.initialOnHand > 0) {
        await tx`
          insert into stock_movements (product_id, variant_id, delta, reason, note, created_by)
          values (${input.id}, null, ${input.initialOnHand}, 'receipt', 'Opening stock', ${staffId})
        `;
      }

      return {
        ok: true as const,
        data: {
          id: text(product.id),
          slug: text(product.slug),
          name: text(product.name),
          pricePaise: number(product.price_paise),
          trackInventory: input.trackInventory,
          initialOnHand: input.initialOnHand,
        },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'A product with that id or slug already exists.');
    }
    console.warn('[store-admin/catalog] could not create a product');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export interface PriceSnapshot {
  before: { pricePaise: number; compareAtPaise: number | null };
  after: { pricePaise: number; compareAtPaise: number | null };
  changed: boolean;
}

/** Change a product price and append to the immutable price history. */
export async function updateProductPricing(
  id: string,
  patch: PricePatch,
  reason: string,
  staffId: string,
): Promise<CatalogWrite<PriceSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select price_paise, compare_at_paise from products
        where id = ${id} and deleted_at is null
        for update
      `) as Row[];
      const row = rows[0];
      if (!row) return fail('not-found', 'Product not found.');

      const beforePrice = number(row.price_paise);
      const beforeCompare = row.compare_at_paise === null ? null : number(row.compare_at_paise);
      const nextPrice = patch.pricePaise ?? beforePrice;
      const nextCompare =
        patch.compareAtPaise !== undefined ? patch.compareAtPaise : beforeCompare;

      const pairError = checkPricePair(nextPrice, nextCompare);
      if (pairError) return fail('invalid-input', pairError);

      const changed = nextPrice !== beforePrice || nextCompare !== beforeCompare;
      if (changed) {
        await tx`
          update products
          set price_paise = ${nextPrice},
              compare_at_paise = ${nextCompare},
              updated_at = now(),
              updated_by = ${staffId}
          where id = ${id}
        `;
      }

      if (nextPrice !== beforePrice) {
        await tx`
          insert into price_history (
            product_id, variant_id, old_price_paise, new_price_paise, currency, reason,
            source, changed_by
          ) values (
            ${id}, null, ${beforePrice}, ${nextPrice}, 'INR', ${reason},
            'store_admin', ${staffId}
          )
        `;
      }

      return {
        ok: true as const,
        data: {
          before: { pricePaise: beforePrice, compareAtPaise: beforeCompare },
          after: { pricePaise: nextPrice, compareAtPaise: nextCompare },
          changed,
        },
      };
    });
  } catch {
    console.warn('[store-admin/catalog] could not change a price');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* -------------------------------------------------------------- variants */

export interface VariantSnapshot {
  created: boolean;
  before: Row | null;
  after: Row;
}

export async function upsertVariant(
  productId: string,
  input: VariantInput,
  staffId: string,
): Promise<CatalogWrite<VariantSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const productRows = (await tx`
        select price_paise from products where id = ${productId} and deleted_at is null
      `) as Row[];
      const product = productRows[0];
      if (!product) return fail('not-found', 'Product not found.');

      const id = input.id ?? newId('var');
      const beforeRows = input.id
        ? ((await tx`
            select * from product_variants where id = ${id} and product_id = ${productId}
            for update
          `) as Row[])
        : [];
      const before = beforeRows[0] ?? null;
      if (input.id && !before) return fail('not-found', 'Variant not found.');

      const rows = before
        ? ((await tx`
            update product_variants
            set sku = ${input.sku},
                option_name = ${input.optionName},
                option_value = ${input.optionValue},
                option_hex = ${input.optionHex},
                price_paise_override = ${input.priceOverridePaise},
                is_active = ${input.isActive},
                sort_order = ${input.sortOrder}
            where id = ${id}
            returning *
          `) as Row[])
        : ((await tx`
            insert into product_variants (
              id, product_id, sku, option_name, option_value, option_hex,
              price_paise_override, is_active, sort_order
            ) values (
              ${id}, ${productId}, ${input.sku}, ${input.optionName}, ${input.optionValue},
              ${input.optionHex}, ${input.priceOverridePaise}, ${input.isActive},
              ${input.sortOrder}
            )
            returning *
          `) as Row[]);

      const basePrice = number(product.price_paise);
      const oldOverride = before?.price_paise_override == null
        ? basePrice
        : number(before.price_paise_override);
      const newOverride = input.priceOverridePaise ?? basePrice;
      if (!before || oldOverride !== newOverride) {
        await tx`
          insert into price_history (
            product_id, variant_id, old_price_paise, new_price_paise, currency, reason,
            source, changed_by
          ) values (
            ${productId}, ${id}, ${before ? oldOverride : null}, ${newOverride}, 'INR',
            'variant_price', 'store_admin', ${staffId}
          )
        `;
      }

      return { ok: true as const, data: { created: !before, before, after: rows[0] ?? {} } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'That SKU or option value is already used on this product.');
    }
    console.warn('[store-admin/catalog] could not save a variant');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function archiveVariant(
  productId: string,
  variantId: string,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');
  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from product_variants
        where id = ${variantId} and product_id = ${productId}
        for update
      `) as Row[];
      const before = rows[0];
      if (!before) return fail('not-found', 'Variant not found.');
      const updated = (await tx`
        update product_variants set is_active = false
        where id = ${variantId}
        returning *
      `) as Row[];
      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not archive a variant');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* ----------------------------------------------------------------- stock */

export interface StockSnapshot {
  before: { onHand: number; reserved: number; trackInventory: boolean };
  after: { onHand: number; reserved: number; trackInventory: boolean };
  inStock: boolean;
}

export async function adjustStock(input: {
  productId: string;
  adjustment: StockAdjustmentInput;
  staffId: string;
}): Promise<CatalogWrite<StockSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const productRows = (await tx`
        select id from products where id = ${input.productId} and deleted_at is null
      `) as Row[];
      if (!productRows[0]) return fail('not-found', 'Product not found.');

      const rows = (await tx`
        select id, on_hand, reserved, track_inventory
        from stock
        where product_id = ${input.productId} and variant_id is null
        for update
      `) as Row[];
      const stock = rows[0];
      if (!stock) {
        return fail('invalid-input', 'Save the stock settings for this product first.');
      }
      if (!Boolean(stock.track_inventory)) {
        return fail('invalid-input', 'Turn on stock tracking before adjusting counts.');
      }

      const before = {
        onHand: number(stock.on_hand),
        reserved: number(stock.reserved),
        trackInventory: true,
      };
      const nextOnHand = before.onHand + input.adjustment.delta;
      if (nextOnHand < 0) {
        return fail('conflict', 'That change would take stock below zero.');
      }
      if (nextOnHand < before.reserved) {
        return fail('conflict', 'That change would leave fewer units than are already reserved.');
      }

      await tx`
        update stock
        set on_hand = ${nextOnHand}, updated_at = now(), updated_by = ${input.staffId}
        where id = ${text(stock.id)}
      `;
      await tx`
        insert into stock_movements (product_id, variant_id, delta, reason, note, created_by)
        values (
          ${input.productId}, null, ${input.adjustment.delta}, ${input.adjustment.reason},
          ${input.adjustment.note}, ${input.staffId}
        )
      `;

      const inStock = nextOnHand - before.reserved > 0;
      await tx`
        update products set in_stock = ${inStock}, updated_at = now(), updated_by = ${input.staffId}
        where id = ${input.productId}
      `;

      return {
        ok: true as const,
        data: {
          before,
          after: { onHand: nextOnHand, reserved: before.reserved, trackInventory: true },
          inStock,
        },
      };
    });
  } catch {
    console.warn('[store-admin/catalog] could not adjust stock');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function updateStockSettings(input: {
  productId: string;
  settings: StockSettingsInput;
  staffId: string;
}): Promise<CatalogWrite<StockSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const productRows = (await tx`
        select id from products where id = ${input.productId} and deleted_at is null
      `) as Row[];
      if (!productRows[0]) return fail('not-found', 'Product not found.');

      const rows = (await tx`
        select id, on_hand, reserved, track_inventory
        from stock
        where product_id = ${input.productId} and variant_id is null
        for update
      `) as Row[];
      const stock = rows[0];
      const before = {
        onHand: number(stock?.on_hand),
        reserved: number(stock?.reserved),
        trackInventory: Boolean(stock?.track_inventory),
      };

      const stockId = text(stock?.id) || newId('stk');
      if (stock) {
        await tx`
          update stock
          set track_inventory = ${input.settings.trackInventory},
              low_stock_threshold = ${input.settings.lowStockThreshold},
              updated_at = now(),
              updated_by = ${input.staffId}
          where id = ${stockId}
        `;
      } else {
        await tx`
          insert into stock (
            id, product_id, variant_id, on_hand, reserved, low_stock_threshold,
            track_inventory, updated_by
          ) values (
            ${stockId}, ${input.productId}, null, 0, 0, ${input.settings.lowStockThreshold},
            ${input.settings.trackInventory}, ${input.staffId}
          )
        `;
      }

      const inStock = input.settings.trackInventory
        ? before.onHand - before.reserved > 0
        : true;
      await tx`
        update products set in_stock = ${inStock}, updated_at = now(), updated_by = ${input.staffId}
        where id = ${input.productId}
      `;

      return {
        ok: true as const,
        data: {
          before,
          after: {
            onHand: before.onHand,
            reserved: before.reserved,
            trackInventory: input.settings.trackInventory,
          },
          inStock,
        },
      };
    });
  } catch {
    console.warn('[store-admin/catalog] could not save stock settings');
    return fail('unavailable', 'The catalogue is not available.');
  }
}
