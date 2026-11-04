import { randomUUID } from 'node:crypto';

import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { metadataGate, MetadataError, saveProductMetadataUsing, strictMetadataAudit } from './product-metadata';
import { parseMetadataInput } from '@/lib/catalog/product-metadata-rules';

import {
  validateAttributeValue,
  type AttributeDataType,
  type AttributeInput,
  type BrandInput,
  type ProductImageInput,
  type ProductPatch,
  type UnitInput,
} from './catalog-rules';
import { mapImageRow, type CatalogImage } from './catalog';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The catalogue must be written on the server only.');
}

/**
 * Writing side of the store catalogue.
 *
 * Rules that hold for every function here:
 *
 * 1. Every function runs inside one transaction, so a demoted primary image is
 *    restored if the insert that follows fails.
 * 2. Nothing in this module writes `price_paise`, `compare_at_paise` or
 *    `product_variants.price_paise_override`. Price writes live in
 *    `catalog-crud.ts` (checkout now prices from the database), so a price
 *    change always appends `price_history` in the same transaction. Copy edits
 *    here never touch the price.
 * 3. `price_history` is never touched here: it is append-only and only a price
 *    change should add a row.
 * 4. Audit rows are written by the API route, from the before/after snapshots
 *    returned here. The route audits after the transaction commits, so a
 *    rolled-back change is never logged as successful.
 * 5. Rows are archived, not destroyed. Orders, stock movements and browsing
 *    history keep resolving through the same ids.
 */

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

export type CatalogWriteFailure =
  | 'unavailable'
  | 'invalid-input'
  | 'not-found'
  | 'conflict';

export type CatalogWrite<T> =
  | { ok: true; data: T }
  | { ok: false; reason: CatalogWriteFailure; error: string };

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

/** HTTP status for an API route's failure branch. */
export function catalogFailureStatus(reason: CatalogWriteFailure): number {
  switch (reason) {
    case 'invalid-input':
      return 400;
    case 'not-found':
      return 404;
    case 'conflict':
      return 409;
    default:
      return 503;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/* ------------------------------------------------------------- products */

export interface ProductSnapshot {
  before: Row;
  after: Row;
}

/** Update the editable copy of a product. Price is not among the columns. */
export async function updateProduct(
  id: string,
  patch: ProductPatch,
  staffId: string,
): Promise<CatalogWrite<ProductSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      await metadataGate(tx);
      const beforeRows = (await tx`
        select name, subtitle, description, badge, material, brand, brand_id,
               condition_id, category_id, seo_title, seo_description, is_active,
               in_stock, sort_order, cost_paise
        from products
        where id = ${id} and deleted_at is null
        for update
      `) as Row[];
      const before = beforeRows[0];
      if (!before) return fail('not-found', 'Product not found.');

      if (patch.condition_id) {
        const conditionRows = (await tx`
          select 1 from conditions
          where id = ${patch.condition_id} and is_active
        `) as Row[];
        if (!conditionRows[0]) {
          return fail('invalid-input', 'That condition does not exist.');
        }
      }

      if (patch.category_id !== undefined) {
        const categoryRows = (await tx`
          select 1 from categories
          where id = ${patch.category_id} and deleted_at is null
        `) as Row[];
        if (!categoryRows[0]) {
          return fail('invalid-input', 'That category does not exist.');
        }
      }

      // `brand` is the display label and `brand_id` is the join key; keep them
      // in step so the storefront never shows one brand while filtering on
      // another.
      const changes: Row = { ...patch };
      if (patch.brand_id !== undefined) {
        if (patch.brand_id === null) {
          changes.brand = '';
        } else {
          const brandRows = (await tx`
            select name from brands
            where id = ${patch.brand_id} and deleted_at is null
          `) as Row[];
          if (!brandRows[0]) {
            return fail('invalid-input', 'That brand does not exist.');
          }
          changes.brand = text(brandRows[0].name);
        }
      }

      const columns = Object.keys(changes);
      await tx`
        update products
        set ${tx(changes, ...columns)},
            updated_at = now(),
            updated_by = ${staffId}
        where id = ${id}
      `;

      await saveProductMetadataUsing(tx,id,{},staffId,{enforcePublication:patch.is_active===true || patch.category_id!==undefined});
      await strictMetadataAudit(tx,{actorId:staffId,action:'catalog.product.update',entity:'product',entityId:id,after:{fields:Object.keys(patch)}});
      const afterRows = (await tx`
        select name, subtitle, description, badge, material, brand, brand_id,
               condition_id, category_id, seo_title, seo_description, is_active,
               in_stock, sort_order, cost_paise
        from products
        where id = ${id}
      `) as Row[];

      return { ok: true as const, data: { before, after: afterRows[0] ?? {} } };
    });
  } catch (error) {
    if(error instanceof MetadataError) return fail('invalid-input',error.message);
    console.warn('[store-admin/catalog] could not update a product');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* --------------------------------------------------------------- images */

/**
 * Demote the live image holding `role`, so the partial unique indexes
 * (`idx_product_images_one_primary` / `..._one_hover`) cannot reject the
 * write. The demoted image becomes a gallery image and is kept.
 */
async function demoteRoleHolder(
  tx: Tx,
  productId: string,
  role: string,
  exceptId: string | null,
): Promise<void> {
  if (role !== 'primary' && role !== 'hover') return;
  await tx`
    update product_images
    set role = 'gallery'
    where product_id = ${productId}
      and role = ${role}
      and is_active
      and deleted_at is null
      and id <> ${exceptId ?? ''}
  `;
}

export interface ProductImageChange {
  productId: string;
  image: CatalogImage;
}

export async function addProductImage(
  productId: string,
  image: ProductImageInput,
): Promise<CatalogWrite<CatalogImage>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const productRows = (await tx`
        select 1 from products where id = ${productId} and deleted_at is null
        for update
      `) as Row[];
      if (!productRows[0]) return fail('not-found', 'Product not found.');

      await demoteRoleHolder(tx, productId, image.role, null);

      const id = `img_${randomUUID()}`;
      const rows = (await tx`
        insert into product_images (id, product_id, url, alt, role, sort_order)
        values (${id}, ${productId}, ${image.url}, ${image.alt}, ${image.role},
                ${image.sort_order})
        returning *
      `) as Row[];

      return { ok: true as const, data: mapImageRow(rows[0]) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'Another image took that slot. Reload and try again.');
    }
    console.warn('[store-admin/catalog] could not add a product image');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function updateProductImage(
  productId: string,
  imageId: string,
  image: ProductImageInput,
): Promise<CatalogWrite<ProductImageChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      // Match aggregate product writers: lock the parent before image rows.
      const productRows = (await tx`
        select 1 from products where id = ${productId} and deleted_at is null
        for update
      `) as Row[];
      if (!productRows[0]) return fail('not-found', 'Product not found.');

      const beforeRows = (await tx`
        select * from product_images
        where id = ${imageId} and product_id = ${productId} and deleted_at is null
        for update
      `) as Row[];
      if (!beforeRows[0]) return fail('not-found', 'Image not found.');

      await demoteRoleHolder(tx, productId, image.role, imageId);

      const rows = (await tx`
        update product_images
        set url = ${image.url},
            alt = ${image.alt},
            role = ${image.role},
            sort_order = ${image.sort_order}
        where id = ${imageId}
        returning *
      `) as Row[];

      return {
        ok: true as const,
        data: { productId, image: mapImageRow(rows[0]) },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'Another image took that slot. Reload and try again.');
    }
    console.warn('[store-admin/catalog] could not update a product image');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/** Archive an image. Soft delete keeps the row available for restore. */
export async function archiveProductImage(
  productId: string,
  imageId: string,
): Promise<CatalogWrite<ProductImageChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      // Match aggregate product writers: lock the parent before image rows.
      const productRows = (await tx`
        select 1 from products where id = ${productId} and deleted_at is null
        for update
      `) as Row[];
      if (!productRows[0]) return fail('not-found', 'Product not found.');

      const beforeRows = (await tx`
        select * from product_images
        where id = ${imageId} and product_id = ${productId} and deleted_at is null
        for update
      `) as Row[];
      if (!beforeRows[0]) return fail('not-found', 'Image not found.');

      const rows = (await tx`
        update product_images
        set is_active = false, deleted_at = now()
        where id = ${imageId}
        returning *
      `) as Row[];

      return {
        ok: true as const,
        data: { productId, image: mapImageRow(rows[0]) },
      };
    });
  } catch {
    console.warn('[store-admin/catalog] could not archive a product image');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function restoreProductImage(
  productId: string,
  imageId: string,
): Promise<CatalogWrite<ProductImageChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      // Match aggregate product writers: lock the parent before image rows.
      const productRows = (await tx`
        select 1 from products where id = ${productId} and deleted_at is null
        for update
      `) as Row[];
      if (!productRows[0]) return fail('not-found', 'Product not found.');

      const beforeRows = (await tx`
        select * from product_images
        where id = ${imageId} and product_id = ${productId}
        for update
      `) as Row[];
      const before = beforeRows[0];
      if (!before) return fail('not-found', 'Image not found.');
      if (before.deleted_at === null) {
        return fail('conflict', 'That image is not archived.');
      }

      await demoteRoleHolder(tx, productId, text(before.role), imageId);

      const rows = (await tx`
        update product_images
        set is_active = true, deleted_at = null
        where id = ${imageId}
        returning *
      `) as Row[];

      return {
        ok: true as const,
        data: { productId, image: mapImageRow(rows[0]) },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'Another image holds that slot. Change it first.');
    }
    console.warn('[store-admin/catalog] could not restore a product image');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* --------------------------------------------------------------- brands */

export interface BrandChange {
  created: boolean;
  before: Row | null;
  after: Row;
}

export async function upsertBrand(
  brand: BrandInput,
  staffId: string,
): Promise<CatalogWrite<BrandChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const beforeRows = (await tx`
        select * from brands where id = ${brand.id} for update
      `) as Row[];
      const before = beforeRows[0] ?? null;

      const slugClash = (await tx`
        select id from brands where slug = ${brand.slug} and id <> ${brand.id} limit 1
      `) as Row[];
      if (slugClash[0]) {
        return fail('conflict', 'Another brand already uses that slug.');
      }

      // Saving an archived id revives it: the operator typed the id on
      // purpose, and the audit row records the flip of `is_active`.
      const rows = before
        ? ((await tx`
            update brands
            set name = ${brand.name},
                slug = ${brand.slug},
                logo_url = ${brand.logo_url},
                description = ${brand.description},
                is_active = ${brand.is_active},
                sort_order = ${brand.sort_order},
                deleted_at = null,
                updated_at = now(),
                updated_by = ${staffId}
            where id = ${brand.id}
            returning *
          `) as Row[])
        : ((await tx`
            insert into brands (id, name, slug, logo_url, description,
                                is_active, sort_order, updated_by)
            values (${brand.id}, ${brand.name}, ${brand.slug}, ${brand.logo_url},
                    ${brand.description}, ${brand.is_active}, ${brand.sort_order},
                    ${staffId})
            returning *
          `) as Row[]);

      return {
        ok: true as const,
        data: { created: !before, before, after: rows[0] },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'A brand with that id or slug already exists.');
    }
    console.warn('[store-admin/catalog] could not save a brand');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function archiveBrand(
  brandId: string,
  staffId: string,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const beforeRows = (await tx`
        select * from brands where id = ${brandId} and deleted_at is null
        for update
      `) as Row[];
      const before = beforeRows[0];
      if (!before) return fail('not-found', 'Brand not found.');

      const productRows = (await tx`
        select count(*)::int as total from products
        where brand_id = ${brandId} and deleted_at is null
      `) as Row[];
      const total = number(productRows[0]?.total);
      if (total > 0) {
        return fail(
          'conflict',
          total === 1
            ? 'One product still uses this brand.'
            : `${total} products still use this brand.`,
        );
      }

      const rows = (await tx`
        update brands
        set is_active = false, deleted_at = now(), updated_at = now(),
            updated_by = ${staffId}
        where id = ${brandId}
        returning *
      `) as Row[];

      return { ok: true as const, data: { before, after: rows[0] } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not archive a brand');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* ---------------------------------------------------------------- units */

export interface UnitChange {
  created: boolean;
  before: Row | null;
  after: Row;
}

export async function upsertUnit(unit: UnitInput): Promise<CatalogWrite<UnitChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      const beforeRows = (await tx`
        select * from units where id = ${unit.id} for update
      `) as Row[];
      const before = beforeRows[0] ?? null;

      if (unit.base_code) {
        if (unit.base_code === unit.code) {
          return fail('invalid-input', 'A unit cannot be its own base unit.');
        }
        const baseRows = (await tx`
          select dimension from units where code = ${unit.base_code} limit 1
        `) as Row[];
        const base = baseRows[0];
        if (!base) {
          return fail('invalid-input', 'That base unit does not exist yet.');
        }
        if (text(base.dimension) !== unit.dimension) {
          return fail('invalid-input', 'The base unit measures a different dimension.');
        }
      }

      const rows = before
        ? ((await tx`
            update units
            set code = ${unit.code},
                label = ${unit.label},
                dimension = ${unit.dimension},
                base_code = ${unit.base_code},
                factor = ${unit.factor}
            where id = ${unit.id}
            returning *
          `) as Row[])
        : ((await tx`
            insert into units (id, code, label, dimension, base_code, factor)
            values (${unit.id}, ${unit.code}, ${unit.label}, ${unit.dimension},
                    ${unit.base_code}, ${unit.factor})
            returning *
          `) as Row[]);

      return {
        ok: true as const,
        data: { created: !before, before, after: rows[0] },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'A unit with that code already exists.');
    }
    console.warn('[store-admin/catalog] could not save a unit');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* ----------------------------------------------------------- attributes */

export interface AttributeChange {
  created: boolean;
  before: Row | null;
  after: Row;
}

export async function upsertAttribute(
  attribute: AttributeInput,
  _staffId: string,
): Promise<CatalogWrite<AttributeChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      await metadataGate(tx);
      const beforeRows = (await tx`
        select * from attributes where id = ${attribute.id} for update
      `) as Row[];
      const before = beforeRows[0] ?? null;

      if (attribute.unit_id) {
        const unitRows = (await tx`
          select 1 from units where id = ${attribute.unit_id}
        `) as Row[];
        if (!unitRows[0]) return fail('invalid-input', 'That unit does not exist.');
      }

      // A mapped definition's identity/type must remain stable, including when
      // it has no saved values yet. Configure a new definition instead.
      if (before && (text(before.key) !== attribute.key || text(before.data_type) !== attribute.data_type)) {
        const mappings = await tx`select 1 from product_type_attributes where attribute_id=${attribute.id} limit 1`;
        if (mappings.length) return fail('conflict', 'This attribute belongs to a product type. Create a new definition rather than changing its key or data type.');
      }
      // Changing the type would leave existing values in the wrong column.
      if (before && text(before.data_type) !== attribute.data_type) {
        const valueRows = (await tx`
          select count(*)::int as total from product_attribute_values
          where attribute_id = ${attribute.id}
        `) as Row[];
        if (number(valueRows[0]?.total) > 0) {
          return fail(
            'conflict',
            'Products already have values for this attribute, so its type cannot change.',
          );
        }
      }

      // attributes has no updated_by column; edited reference data is tracked
      // by the audit row the route writes, not by the table.
      void _staffId;

      const rows = before
        ? ((await tx`
            update attributes
            set key = ${attribute.key},
                label = ${attribute.label},
                data_type = ${attribute.data_type},
                unit_id = ${attribute.unit_id},
                is_filterable = ${attribute.is_filterable},
                is_variant_option = ${attribute.is_variant_option},
                sort_order = ${attribute.sort_order},
                is_active = true,
                deleted_at = null
            where id = ${attribute.id}
            returning *
          `) as Row[])
        : ((await tx`
            insert into attributes (id, key, label, data_type, unit_id,
                                    is_filterable, is_variant_option, sort_order)
            values (${attribute.id}, ${attribute.key}, ${attribute.label},
                    ${attribute.data_type}, ${attribute.unit_id},
                    ${attribute.is_filterable}, ${attribute.is_variant_option},
                    ${attribute.sort_order})
            returning *
          `) as Row[]);

      return {
        ok: true as const,
        data: { created: !before, before, after: rows[0] },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'An attribute with that id or key already exists.');
    }
    console.warn('[store-admin/catalog] could not save an attribute');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function archiveAttribute(
  attributeId: string,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      await metadataGate(tx);
      const beforeRows = (await tx`
        select * from attributes where id = ${attributeId} and deleted_at is null
        for update
      `) as Row[];
      const before = beforeRows[0];
      if (!before) return fail('not-found', 'Attribute not found.');
      const mappings = await tx`select 1 from product_type_attributes where attribute_id=${attributeId} and is_active limit 1`;
      if (mappings.length) return fail('conflict', 'Remove this attribute from active product-type mappings before archiving it.');

      const valueRows = (await tx`
        select count(*)::int as total from product_attribute_values
        where attribute_id = ${attributeId}
      `) as Row[];
      const total = number(valueRows[0]?.total);
      if (total > 0) {
        return fail(
          'conflict',
          `${total} retained product values use this attribute. Clearing archives them; it does not delete their definition.`,
        );
      }

      const rows = (await tx`
        update attributes
        set is_active = false, deleted_at = now()
        where id = ${attributeId}
        returning *
      `) as Row[];

      return { ok: true as const, data: { before, after: rows[0] } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not archive an attribute');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export interface AttributeOptionChange {
  attributeId: string;
  value: string;
}

export async function addAttributeOption(
  attributeId: string,
  value: string,
  sortOrder: number,
): Promise<CatalogWrite<AttributeOptionChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      await metadataGate(tx);
      const attributeRows = (await tx`
        select data_type from attributes
        where id = ${attributeId} and deleted_at is null
        for update
      `) as Row[];
      const attribute = attributeRows[0];
      if (!attribute) return fail('not-found', 'Attribute not found.');
      if (text(attribute.data_type) !== 'enum') {
        return fail('invalid-input', 'Only a list attribute can have options.');
      }

      const existing = (await tx`
        select 1 from attribute_options
        where attribute_id = ${attributeId} and value = ${value}
      `) as Row[];
      if (existing[0]) return fail('conflict', 'That option already exists.');

      await tx`
        insert into attribute_options (attribute_id, value, sort_order)
        values (${attributeId}, ${value}, ${sortOrder})
      `;
      return { ok: true as const, data: { attributeId, value } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'That option already exists.');
    }
    console.warn('[store-admin/catalog] could not add an attribute option');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export async function removeAttributeOption(
  attributeId: string,
  value: string,
): Promise<CatalogWrite<AttributeOptionChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    return await sql.begin(async (tx) => {
      await metadataGate(tx);
      const valueRows = (await tx`
        select count(*)::int as total from product_attribute_values
        where attribute_id = ${attributeId} and option_value = ${value}
      `) as Row[];
      const total = number(valueRows[0]?.total);
      if (total > 0) {
        return fail(
          'conflict',
          total === 1
            ? 'One product still uses this option.'
            : `${total} products still use this option.`,
        );
      }

      const rows = (await tx`
        delete from attribute_options
        where attribute_id = ${attributeId} and value = ${value}
        returning value
      `) as Row[];
      if (!rows[0]) return fail('not-found', 'Option not found.');

      return { ok: true as const, data: { attributeId, value } };
    });
  } catch {
    console.warn('[store-admin/catalog] could not remove an attribute option');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/* --------------------------------------------------- product attributes */

export interface AttributeValueChange {
  productId: string;
  attributeId: string;
  before: Row | null;
  after: Row | null;
}

export async function setProductAttributeValue(
  productId: string, attributeId: string, value: unknown, staffId: string, request?: Request,
): Promise<CatalogWrite<AttributeValueChange>> {
  const sql=getSql(); if(!sql) return fail('unavailable','The catalogue is not available.');
  try {
    const input=parseMetadataInput({attributeValues:{[attributeId]:value}});
    return await sql.begin(async tx=>{
      await metadataGate(tx);
      const [before]=await tx`select * from product_attribute_values where product_id=${productId} and attribute_id=${attributeId}`;
      await saveProductMetadataUsing(tx,productId,input,staffId,{request});
      const [after]=await tx`select * from product_attribute_values where product_id=${productId} and attribute_id=${attributeId}`;
      return {ok:true as const,data:{productId,attributeId,before:before??null,after:after??null}};
    });
  } catch(error){
    if(error instanceof MetadataError) return fail('invalid-input',error.message);
    return fail('unavailable','The catalogue is not available.');
  }
}

/** Clear is reversible archival, never deletion. */
export async function clearProductAttributeValue(
  productId: string, attributeId: string, staffId: string, request?: Request,
): Promise<CatalogWrite<AttributeValueChange>> {
  return setProductAttributeValue(productId,attributeId,null,staffId,request);
}
