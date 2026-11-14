import { randomBytes } from 'node:crypto';

import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';

import {
  EXPORT_COLUMNS,
  metadataCsvCells,
  parseCsv,
  toCsv,
  validateImportRows,
  type ImportContext,
  type ImportError,
  type ImportRow,
  type CsvInventoryVariant,
} from './catalog-csv';
import { adjustVariantInventoryUsing } from './variant-inventory';
import { inventoryKey, type InventoryChange } from './variant-inventory-rules';
import { INVENTORY_REPORT_CTE, inventoryReportLabel } from './inventory-report';
import type { CatalogWrite } from './catalog-writes';
import { MetadataError, type AttributePrimitive } from '@/lib/catalog/product-metadata-rules';
import { metadataGate, saveProductMetadataUsing, strictMetadataAudit } from './product-metadata';
import { ProductContentError, writeProductContentUsing } from './product-content';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Catalogue transfer runs on the server only.');
}

type Row = Record<string, unknown>;
type Tx = postgres.TransactionSql;

const CHUNK = 400;

class MetadataImportError extends MetadataError {
  readonly cause?: unknown;

  constructor(readonly importError: ImportError, options?: { cause?: unknown }) {
    super(importError.message);
    this.name = 'MetadataImportError';
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

class DryRunValidated extends Error {}

interface PgErrorMeta {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

function postgresErrorMeta(error: unknown): PgErrorMeta | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  if (typeof record.code !== 'string' || !record.code) return null;
  return {
    code: record.code,
    constraint: typeof record.constraint_name === 'string' ? record.constraint_name : undefined,
    table: typeof record.table_name === 'string' ? record.table_name : undefined,
    column: typeof record.column_name === 'string' ? record.column_name : undefined,
    detail: typeof record.detail === 'string' ? record.detail : undefined,
  };
}

function isInfraMetadataError(error: MetadataError): boolean {
  const lower = error.message.toLowerCase();
  return lower.includes('audit could not be saved') || lower.includes('unavailable');
}

function metadataErrorColumn(message: string): string {
  const lower = message.toLowerCase();
  if (lower.startsWith('before publishing')) return 'metadata';
  if (lower.includes('product type') || lower.includes('active type')) return 'product_type_id';
  if (lower.includes('device model') || lower.includes('compatibility')) return 'device_model_ids';
  if (lower.includes('attribute')) return 'attribute_values';
  return 'metadata';
}

function contentErrorColumn(row: ImportRow): string {
  return row.shortDescription === undefined && row.descriptionSections !== undefined
    ? 'description_sections'
    : 'short_description';
}

async function applyProductContent(tx: Tx, row: ImportRow, staffId: string): Promise<void> {
  try {
    await writeProductContentUsing(
      tx,
      row.productId,
      { shortDescription: row.shortDescription, descriptionSections: row.descriptionSections },
      staffId,
      { source: 'csv_import' },
    );
  } catch (error) {
    if (error instanceof ProductContentError && error.status < 500) {
      throw new MetadataImportError({
        rowNumber: row.rowNumber,
        column: contentErrorColumn(row),
        message: error.message,
      });
    }
    throw error;
  }
}

function inventoryAdjustmentToImportError(
  error: unknown,
  change: InventoryChange,
  rowNumber: number,
): ImportError | null {
  if (error instanceof MetadataError) {
    if (isInfraMetadataError(error)) return null;
    const column =
      change.variantId !== null
        ? 'inventory_variants'
        : error.message.toLowerCase().includes('confirm')
          ? 'confirm_tracking'
          : 'stock';
    return { rowNumber, column, message: error.message };
  }
  if (error instanceof Error && !postgresErrorMeta(error)) {
    const msg = error.message;
    if (
      msg.includes('reserved units') ||
      msg.includes('inventory limit') ||
      msg.includes('must be true or false') ||
      msg.includes('200 characters or fewer')
    ) {
      return {
        rowNumber,
        column: change.variantId !== null ? 'inventory_variants' : 'stock',
        message: msg,
      };
    }
  }
  return null;
}

function rowNumberFromPgDetail(
  rows: ImportRow[],
  detail: string | undefined,
  field: 'slug' | 'productId',
  fallbackRowNumber?: number,
): number {
  if (detail) {
    const matched = rows.find((row) => detail.includes(`(${row[field]})`));
    if (matched) return matched.rowNumber;
  }
  return fallbackRowNumber ?? rows[0]?.rowNumber ?? 1;
}

function postgresColumnHint(pg: PgErrorMeta): string {
  const hint = `${pg.constraint ?? ''} ${pg.column ?? ''}`.toLowerCase();
  if (hint.includes('product_type')) return 'product_type_id';
  if (hint.includes('category')) return 'category';
  if (hint.includes('brand')) return 'brand';
  if (hint.includes('condition')) return 'condition';
  if (hint.includes('sale_price')) return 'sale_price';
  if (hint.includes('compare_at')) return 'compare_at_price';
  if (hint.includes('price')) return 'price';
  if (hint.includes('slug')) return 'slug';
  if (hint.includes('on_hand') || hint.includes('reserved') || hint.includes('stock')) return 'stock';
  return pg.column ?? 'import';
}

function postgresErrorToImportError(
  error: unknown,
  rows: ImportRow[],
  fallbackRowNumber?: number,
): ImportError | null {
  const pg = postgresErrorMeta(error);
  if (!pg) return null;

  if (pg.code === '23505') {
    if (pg.constraint === 'products_slug_key') {
      return {
        rowNumber: rowNumberFromPgDetail(rows, pg.detail, 'slug', fallbackRowNumber),
        column: 'slug',
        message: 'Another product already uses this slug. If swapping slugs across rows, import in two steps.',
      };
    }
    if (pg.constraint === 'products_pkey') {
      return {
        rowNumber: rowNumberFromPgDetail(rows, pg.detail, 'productId', fallbackRowNumber),
        column: 'product_id',
        message: 'A product with this id already exists.',
      };
    }
    return {
      rowNumber: fallbackRowNumber ?? rows[0]?.rowNumber ?? 1,
      column: postgresColumnHint(pg),
      message: 'Duplicate record violates a unique catalogue constraint.',
    };
  }

  if (pg.code === '23503') {
    return {
      rowNumber: fallbackRowNumber ?? rows[0]?.rowNumber ?? 1,
      column: postgresColumnHint(pg),
      message: 'Referenced catalogue record no longer exists; refresh and try again.',
    };
  }

  if (pg.code === '23514') {
    return {
      rowNumber: fallbackRowNumber ?? rows[0]?.rowNumber ?? 1,
      column: postgresColumnHint(pg),
      message: 'Value violates a catalogue constraint. Check the values in this row and try again.',
    };
  }

  if (pg.code === '22P02' || pg.code === '22001' || pg.code === '22003' || pg.code === '23502') {
    return {
      rowNumber: fallbackRowNumber ?? rows[0]?.rowNumber ?? 1,
      column: postgresColumnHint(pg),
      message: 'One of the row values is invalid, missing, or exceeds field limits.',
    };
  }

  return null;
}

function toImportError(error: unknown, rows: ImportRow[]): ImportError | null {
  if (error instanceof MetadataImportError) return error.importError;
  if (error instanceof ProductContentError && error.status < 500) {
    return {
      rowNumber: rows[0]?.rowNumber ?? 1,
      column: rows[0] ? contentErrorColumn(rows[0]) : 'short_description',
      message: error.message,
    };
  }
  if (error instanceof MetadataError && !isInfraMetadataError(error)) {
    return {
      rowNumber: rows[0]?.rowNumber ?? 1,
      column: metadataErrorColumn(error.message),
      message: error.message,
    };
  }
  return postgresErrorToImportError(error, rows);
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return raw
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-db-url]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 240);
}

function rollbackLogContext(
  error: unknown,
  meta: {
    importId: string;
    dryRun: boolean;
    total: number;
    creates: number;
    updates: number;
    mapped: ImportError | null;
  },
) {
  const cause = error instanceof Error && 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
  const pg = postgresErrorMeta(error) ?? postgresErrorMeta(cause);
  return {
    importId: meta.importId,
    mode: meta.dryRun ? 'dry_run' : 'commit',
    total: meta.total,
    creates: meta.creates,
    updates: meta.updates,
    outcome: meta.mapped ? 'rejected' : 'unavailable',
    ...(meta.mapped ? { rowNumber: meta.mapped.rowNumber, column: meta.mapped.column } : {}),
    ...(pg
      ? {
          pgCode: pg.code,
          ...(pg.constraint ? { constraint: pg.constraint } : {}),
          ...(pg.table ? { table: pg.table } : {}),
          ...(pg.column ? { pgColumn: pg.column } : {}),
        }
      : {}),
    errorName: error instanceof Error ? error.name : typeof error,
    reason: sanitizeErrorMessage(error),
  };
}

async function applyMetadata(tx: Tx, row: ImportRow, staffId: string, before?: Row): Promise<void> {
  try {
    if (row.shortDescription !== undefined || row.descriptionSections !== undefined) {
      await metadataGate(tx);
      await applyProductContent(tx, row, staffId);
    }
    // Even legacy CSVs without metadata columns must pass the publication gate.
    await saveProductMetadataUsing(tx, row.productId, row.metadata, staffId, { enforcePublication: true });
    const isActive = row.isActive ?? Boolean(before?.is_active);
    if (!before || before.category_id !== row.categoryId || Boolean(before.is_active) !== isActive) {
      await strictMetadataAudit(tx, {
        actorId: staffId,
        action: before ? 'catalog.product.classification' : 'catalog.product.create',
        entity: 'product',
        entityId: row.productId,
        ...(before ? { before: { categoryId: before.category_id, isActive: before.is_active } } : {}),
        after: { categoryId: row.categoryId, isActive, source: 'csv_import' },
      });
    }
  } catch (error) {
    if (error instanceof MetadataImportError) throw error;
    if (error instanceof MetadataError && !isInfraMetadataError(error)) {
      throw new MetadataImportError({
        rowNumber: row.rowNumber,
        column: metadataErrorColumn(error.message),
        message: error.message,
      });
    }
    const pgError = postgresErrorToImportError(error, [row], row.rowNumber);
    if (pgError) throw new MetadataImportError(pgError, { cause: error });
    throw error;
  }
}

function fail(
  reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict',
  error: string,
): { ok: false; reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict'; error: string } {
  return { ok: false, reason, error };
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(paise: unknown): string {
  if (paise === null || paise === undefined) return '';
  return (number(paise) / 100).toFixed(2);
}

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/* ----------------------------------------------------------------- export */

export interface ExportOptions {
  categoryId: string | null;
  status: 'all' | 'active' | 'inactive';
  search: string;
}

export interface ExportResult {
  csv: string;
  rows: number;
}

/** The current filtered catalogue, in the same columns the importer accepts. */
export async function exportCatalogue(
  options: ExportOptions,
): Promise<CatalogWrite<ExportResult>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  const clauses = ['p.deleted_at is null'];
  const params: unknown[] = [];
  if (options.categoryId) {
    params.push(options.categoryId);
    clauses.push(`p.category_id = $${params.length}`);
  }
  if (options.status === 'active') clauses.push('p.is_active');
  if (options.status === 'inactive') clauses.push('not p.is_active');
  const search = options.search.trim().slice(0, 100);
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(p.name ilike $${params.length} or p.slug ilike $${params.length})`);
  }

  try {
    const rows = (await sql.unsafe(
      `select p.id, p.name, p.slug, p.brand, c.name as category_name,
              cond.label as condition_label, p.description, p.price_paise,
              p.compare_at_paise, p.sale_price_paise, s.on_hand, s.low_stock_threshold, s.track_inventory,
              coalesce((
                select string_agg(i.url, '|' order by (i.role = 'primary') desc, i.sort_order, i.id)
                from product_images i
                where i.product_id = p.id and i.is_active and i.deleted_at is null
              ), '') as image_urls,
              p.is_active, p.seo_title, p.seo_description, p.created_at, p.updated_at,
              to_jsonb(p)->>'short_description' as short_description,
              to_jsonb(p)->'description_sections' as description_sections,
              p.product_type_id,
              coalesce((select jsonb_agg(jsonb_build_object(
                'id', v.id, 'sku', v.sku, 'deviceModelId', v.device_model_id,
                'combinationKey', v.combination_key, 'optionName', v.option_name,
                'optionValue', v.option_value, 'isPurchasable', v.is_purchasable,
                'isActive', v.is_active, 'pricePaise', v.price_paise_override,
                'salePricePaise', v.sale_price_paise,
                'stock', case when vs.id is null then null else jsonb_build_object(
                  'onHand', vs.on_hand, 'trackInventory', vs.track_inventory,
                  'lowStockThreshold', vs.low_stock_threshold) end
              ) order by v.id) from product_variants v
              left join stock vs on vs.product_id=v.product_id and vs.variant_id=v.id
              where v.product_id=p.id and v.is_purchasable), '[]'::jsonb) as inventory_variants,
              coalesce((
                select jsonb_agg(d.device_model_id order by d.sort_order, d.device_model_id)
                from product_device_models d
                where d.product_id = p.id and d.archived_at is null
              ), '[]'::jsonb) as device_model_ids,
              coalesce((
                select jsonb_object_agg(v.attribute_id, coalesce(
                  to_jsonb(v.value_bool), to_jsonb(v.value_number),
                  to_jsonb(v.option_value), to_jsonb(v.value_text), 'null'::jsonb
                ))
                from product_attribute_values v
                join product_type_attributes m on m.attribute_id = v.attribute_id
                  and m.product_type_id = p.product_type_id and m.is_active
                join attributes a on a.id = v.attribute_id
                  and a.is_active and a.deleted_at is null and a.key <> 'model'
                where v.product_id = p.id and v.archived_at is null
              ), '{}'::jsonb) as attribute_values
       from products p
       join categories c on c.id = p.category_id
       left join conditions cond on cond.id = p.condition_id
       left join stock s on s.product_id = p.id and s.variant_id is null
       where ${clauses.join(' and ')}
       order by p.name asc, p.id asc
       limit 10000`,
      params as never[],
    )) as Row[];

    const csvRows = rows.map((row) => [
      text(row.id),
      text(row.name),
      text(row.slug),
      text(row.brand),
      text(row.category_name),
      text(row.condition_label),
      text(row.description),
      money(row.price_paise),
      money(row.compare_at_paise),
      money(row.sale_price_paise),
      row.track_inventory !== true || row.on_hand == null ? '' : String(number(row.on_hand)),
      row.low_stock_threshold === null || row.low_stock_threshold === undefined
        ? ''
        : String(number(row.low_stock_threshold)),
      text(row.image_urls),
      row.is_active ? 'true' : 'false',
      text(row.seo_title),
      text(row.seo_description),
      JSON.stringify(row.inventory_variants),
      'false',
      ...metadataCsvCells({
        productTypeId: row.product_type_id == null ? null : text(row.product_type_id),
        deviceModelIds: row.device_model_ids as string[],
        attributeValues: row.attribute_values as Record<string, AttributePrimitive>,
      }),
      row.short_description == null ? 'null' : text(row.short_description),
      row.description_sections == null ? 'null' : JSON.stringify(row.description_sections),
      stamp(row.created_at),
      stamp(row.updated_at),
    ]);

    return { ok: true, data: { csv: toCsv(EXPORT_COLUMNS, csvRows), rows: csvRows.length } };
  } catch {
    console.warn('[store-admin/transfer] could not export the catalogue');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

export const STOCK_EXPORT_COLUMNS = [
  'product_id',
  'slug',
  'name',
  'variant_id',
  'variant_sku',
  'inventory_bucket',
  'on_hand',
  'reserved',
  'available',
  'low_stock_threshold',
  'track_inventory',
  'status',
  'updated_at',
] as const;

/**
 * Stock levels as a CSV. `low` mirrors the low-stock report (tracked rows at or
 * below their threshold); `all` lists every live product so the file doubles as
 * a stocktake sheet. Recorded product balances remain visible with tracking off;
 * untracked variant quantities are blank, matching the stock report.
 */
export async function exportStockReport(
  scope: 'low' | 'all',
): Promise<CatalogWrite<ExportResult>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  const lowOnly = scope === 'low'
    ? "and i.inventory_bucket <> 'retained_legacy' and i.track_inventory and (i.on_hand - i.reserved) <= i.low_stock_threshold"
    : '';

  try {
    const rows = (await sql.unsafe(
      `with ${INVENTORY_REPORT_CTE}
       select i.* from inventory i
       where true ${lowOnly}
       order by (i.on_hand - i.reserved) nulls last, i.name, i.product_id, i.variant_id nulls first
       limit 10000`,
    )) as Row[];

    const csvRows = rows.map((row) => {
      const tracked = row.track_inventory === true;
      const showBalance = tracked || row.inventory_bucket === 'product' || row.inventory_bucket === 'retained_legacy';
      const onHand = number(row.on_hand);
      const reserved = number(row.reserved);
      const available = onHand - reserved;
      const threshold = number(row.low_stock_threshold);
      const status = row.variant_id && !row.stock_id ? 'missing_stock_configuration' : !tracked ? 'untracked' : available <= threshold ? 'low' : 'ok';
      return [
        text(row.product_id),
        text(row.slug),
        inventoryReportLabel(row),
        text(row.variant_id),
        text(row.variant_sku),
        text(row.inventory_bucket),
        showBalance ? String(onHand) : '',
        showBalance ? String(reserved) : '',
        showBalance ? String(available) : '',
        tracked ? String(threshold) : '',
        tracked ? 'true' : 'false',
        status,
        stamp(row.updated_at),
      ];
    });

    return { ok: true, data: { csv: toCsv(STOCK_EXPORT_COLUMNS, csvRows), rows: csvRows.length } };
  } catch {
    console.warn('[store-admin/transfer] could not export stock levels');
    return fail('unavailable', 'The catalogue is not available.');
  }
}

async function variantInventoryChanges(tx: Tx, row: ImportRow): Promise<InventoryChange[]> {
  if (row.inventoryVariants === undefined) return [];
  const current = await tx`select v.*, s.id as stock_id, s.on_hand, s.track_inventory, s.low_stock_threshold
    from product_variants v left join stock s on s.product_id=v.product_id and s.variant_id=v.id
    where v.product_id=${row.productId} and v.is_purchasable order by v.id`;
  const identity = (v: CsvInventoryVariant) => [v.id,v.sku,v.deviceModelId,v.combinationKey,v.optionName,v.optionValue,v.isPurchasable,v.isActive,v.pricePaise,v.salePricePaise];
  if (row.inventoryVariants.length !== current.length) throw new MetadataImportError({rowNumber:row.rowNumber,column:'inventory_variants',message:'Variant identity set changed. Export a fresh file; CSV cannot create, archive or activate variants.'});
  const changes: InventoryChange[] = [];
  for (const value of row.inventoryVariants) {
    const v = current.find(v=>v.id===value.id);
    const saved: CsvInventoryVariant | undefined = v ? {
      id:text(v.id),sku:v.sku==null?null:text(v.sku),deviceModelId:v.device_model_id==null?null:text(v.device_model_id),
      combinationKey:v.combination_key==null?null:text(v.combination_key),optionName:text(v.option_name),optionValue:text(v.option_value),
      isPurchasable:v.is_purchasable===true,isActive:v.is_active===true,
      pricePaise:v.price_paise_override==null?null:number(v.price_paise_override),salePricePaise:v.sale_price_paise==null?null:number(v.sale_price_paise),stock:null,
    } : undefined;
    if (!v || !saved || JSON.stringify(identity(saved))!==JSON.stringify(identity(value))) throw new MetadataImportError({rowNumber:row.rowNumber,column:'inventory_variants',message:'Variant identity, mapping, status and prices are read-only in CSV. Export again after editor changes.'});
    if ((value.stock===null)!==!v.stock_id) throw new MetadataImportError({rowNumber:row.rowNumber,column:'inventory_variants',message:'CSV cannot create or delete variant stock rows. Configure explicit inventory in the editor first.'});
    if (!value.stock) continue;
    const stock=value.stock;
    if (stock.onHand===number(v.on_hand) && stock.trackInventory===v.track_inventory && stock.lowStockThreshold===number(v.low_stock_threshold)) continue;
    if (!value.isActive) throw new MetadataImportError({rowNumber:row.rowNumber,column:'inventory_variants',message:'Inventory changes on inactive variants require editor review.'});
    if (stock.trackInventory && !v.track_inventory && !row.confirmTracking) throw new MetadataImportError({rowNumber:row.rowNumber,column:'confirm_tracking',message:'Explicitly confirm enabling tracking with confirm_tracking=true.'});
    changes.push({productId:row.productId,variantId:value.id,...stock,confirmTracking:row.confirmTracking,reason:'adjustment',note:'CSV variant stocktake'});
  }
  return changes;
}

/* ----------------------------------------------------------------- import */

export interface ImportResult {
  importId: string;
  dryRun: boolean;
  status: 'validated' | 'imported' | 'rejected';
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportError[];
  errorCount: number;
}

async function loadContext(sql: postgres.Sql): Promise<ImportContext> {
  const [categories, brands, conditions, products] = await Promise.all([
    sql`select id, slug, name from categories where deleted_at is null order by name`,
    sql`select id, name, slug from brands where deleted_at is null order by name`,
    sql`select id, label from conditions order by sort_order`,
    sql`select id, slug, deleted_at from products`,
  ]);
  const existing = new Map<string, { slug: string }>();
  const existingSlugs = new Map<string, string>();
  const deletedIds = new Set<string>();
  const deletedSlugs = new Set<string>();
  for (const row of products as Row[]) {
    const id = text(row.id);
    const slug = text(row.slug);
    if (row.deleted_at == null) {
      existing.set(id, { slug });
      existingSlugs.set(slug.toLowerCase(), id);
    } else {
      deletedIds.add(id.toLowerCase());
      deletedSlugs.add(slug.toLowerCase());
    }
  }
  return {
    categories: (categories as Row[]).map((row) => ({
      id: text(row.id),
      slug: text(row.slug),
      name: text(row.name),
    })),
    brands: (brands as Row[]).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      slug: text(row.slug),
    })),
    conditions: (conditions as Row[]).map((row) => ({
      id: text(row.id),
      label: text(row.label),
    })),
    existing,
    existingSlugs,
    deletedIds,
    deletedSlugs,
  };
}

async function recordJob(
  sql: postgres.Sql,
  job: {
    id: string;
    filename: string;
    mode: 'dry_run' | 'commit';
    status: 'validated' | 'imported' | 'rejected';
    total: number;
    created: number;
    updated: number;
    failed: number;
    staffId: string;
  },
  errors: ImportError[],
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into catalog_imports (
        id, filename, mode, status, rows_total, rows_created, rows_updated, rows_failed, created_by
      ) values (
        ${job.id}, ${job.filename}, ${job.mode}, ${job.status}, ${job.total},
        ${job.created}, ${job.updated}, ${job.failed}, ${job.staffId}
      )
    `;
    for (const batch of chunks(errors, 500)) {
      // The dynamic fragment supplies both the column list and the values.
      await tx`
        insert into catalog_import_errors
        ${tx(
          batch.map((error) => ({
            import_id: job.id,
            row_number: error.rowNumber,
            column_name: error.column.slice(0, 80),
            message: error.message.slice(0, 500),
          })),
          'import_id',
          'row_number',
          'column_name',
          'message',
        )}
      `;
    }
  });
}

/**
 * Dry-run validates every row and writes nothing to the catalogue.
 *
 * Commit applies the whole file in one transaction: if any row is invalid the
 * import is rejected before it starts, and a failure part-way rolls everything
 * back. A 5,000-row file either lands completely or not at all.
 */
export async function runCatalogueImport(input: {
  csv: string;
  filename: string;
  dryRun: boolean;
  staffId: string;
}): Promise<CatalogWrite<ImportResult>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  const parsed = parseCsv(input.csv);
  if (!parsed.ok) return fail('invalid-input', parsed.error);

  let context: ImportContext;
  try {
    context = await loadContext(sql);
  } catch {
    console.warn('[store-admin/transfer] could not load the import context');
    return fail('unavailable', 'The catalogue is not available.');
  }

  const importId = newId('imp');
  const validation = validateImportRows(parsed.header, parsed.rows, context);
  const creates = validation.rows.filter((row) => row.mode === 'create');
  const updates = validation.rows.filter((row) => row.mode === 'update');
  if (!validation.errors.length) {
    if (input.dryRun) {
      try {
        await sql.begin(async (tx) => {
          // Run the same commit-time database, metadata, content and inventory gates, then roll back.
          await metadataGate(tx);
          await applyCreates(tx, creates, input.staffId);
          await applyUpdates(tx, updates, input.staffId);
          throw new DryRunValidated();
        });
      } catch (error) {
        if (!(error instanceof DryRunValidated)) {
          const converted = toImportError(error, validation.rows);
          if (converted) {
            validation.errors.push(converted);
          } else {
            console.warn(
              '[store-admin/transfer] dry-run validation failed',
              rollbackLogContext(error, {
                importId,
                dryRun: true,
                total: parsed.rows.length,
                creates: creates.length,
                updates: updates.length,
                mapped: null,
              }),
            );
            return fail('unavailable', 'Could not validate catalogue import.');
          }
        }
      }
    } else {
      try {
        await sql.begin(async (tx) => {
          for (const row of validation.rows) {
            if (row.stock !== null && !row.confirmTracking) {
              const [stock] = await tx`select track_inventory from stock where product_id=${row.productId} and variant_id is null`;
              if (!stock?.track_inventory) throw new MetadataImportError({rowNumber:row.rowNumber,column:'confirm_tracking',message:'Explicitly confirm enabling tracking with confirm_tracking=true.'});
            }
            await variantInventoryChanges(tx,row);
          }
        });
      } catch (error) {
        const converted = toImportError(error, validation.rows);
        if (converted) {
          validation.errors.push(converted);
        } else {
          console.warn(
            '[store-admin/transfer] pre-import stock check failed',
            rollbackLogContext(error, {
              importId,
              dryRun: false,
              total: parsed.rows.length,
              creates: creates.length,
              updates: updates.length,
              mapped: null,
            }),
          );
          return fail('unavailable', 'Could not validate variant inventory.');
        }
      }
    }
  }
  const failedRows = new Set(validation.errors.map((error) => error.rowNumber));
  const base = {
    importId,
    dryRun: input.dryRun,
    total: parsed.rows.length,
    failed: failedRows.size,
    errors: validation.errors.slice(0, 200),
    errorCount: validation.errors.length,
  };

  if (validation.errors.length > 0) {
    await recordJob(
      sql,
      {
        id: importId,
        filename: input.filename,
        mode: input.dryRun ? 'dry_run' : 'commit',
        status: 'rejected',
        total: parsed.rows.length,
        created: 0,
        updated: 0,
        failed: failedRows.size,
        staffId: input.staffId,
      },
      validation.errors,
    );
    return { ok: true, data: { ...base, status: 'rejected', created: 0, updated: 0 } };
  }

  if (input.dryRun) {
    await recordJob(
      sql,
      {
        id: importId,
        filename: input.filename,
        mode: 'dry_run',
        status: 'validated',
        total: parsed.rows.length,
        created: creates.length,
        updated: updates.length,
        failed: 0,
        staffId: input.staffId,
      },
      [],
    );
    return {
      ok: true,
      data: {
        ...base,
        status: 'validated',
        created: creates.length,
        updated: updates.length,
      },
    };
  }

  // The job row lands before the catalogue writes so the commit can flip it to
  // `imported` in the same transaction. A rollback leaves it `validated` and
  // the catch below turns it into a rejected job with the failure message.
  await recordJob(
    sql,
    {
      id: importId,
      filename: input.filename,
      mode: 'commit',
      status: 'validated',
      total: parsed.rows.length,
      created: creates.length,
      updated: updates.length,
      failed: 0,
      staffId: input.staffId,
    },
    [],
  );

  try {
    await sql.begin(async (tx) => {
      // Acquire the shared configuration gate before any product lock/write.
      await metadataGate(tx);
      await applyCreates(tx, creates, input.staffId);
      await applyUpdates(tx, updates, input.staffId);
      await strictMetadataAudit(tx,{actorId:input.staffId,action:'catalog.import.apply',entity:'catalog_import',entityId:importId,after:{created:creates.length,updated:updates.length},reason:'csv_import'});
      await tx`
        update catalog_imports
        set status = 'imported',
            rows_created = ${creates.length},
            rows_updated = ${updates.length},
            rows_failed = 0
        where id = ${importId}
      `;
    });
  } catch (error) {
    const converted = toImportError(error, validation.rows);
    console.warn(
      '[store-admin/transfer] import rolled back',
      rollbackLogContext(error, {
        importId,
        dryRun: false,
        total: parsed.rows.length,
        creates: creates.length,
        updates: updates.length,
        mapped: converted,
      }),
    );
    const importError: ImportError = converted ?? {
      rowNumber: 1,
      column: 'import',
      message: 'The import failed and nothing was written. Check the file and try again.',
    };
    try {
      await sql.begin(async (tx) => {
        await tx`
          update catalog_imports
          set status = 'rejected',
              rows_created = 0,
              rows_updated = 0,
              rows_failed = ${parsed.rows.length}
          where id = ${importId}
        `;
        await tx`
          insert into catalog_import_errors (import_id, row_number, column_name, message)
          values (
            ${importId}, ${importError.rowNumber}, ${importError.column.slice(0, 80)},
            ${importError.message.slice(0, 500)}
          )
        `;
      });
    } catch {
      console.warn('[store-admin/transfer] could not record the failed import', { importId });
    }
    if (converted) {
      return { ok: true, data: {
        ...base,
        status: 'rejected',
        created: 0,
        updated: 0,
        failed: parsed.rows.length,
        errors: [importError],
        errorCount: 1,
      } };
    }
    return fail('unavailable', 'The import failed and nothing was written.');
  }

  return {
    ok: true,
    data: {
      ...base,
      status: 'imported',
      created: creates.length,
      updated: updates.length,
    },
  };
}

async function runWithPgError(
  rows: ImportRow[],
  run: () => Promise<unknown>,
  fallbackRowNumber?: number,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const converted = postgresErrorToImportError(error, rows, fallbackRowNumber);
    if (converted) throw new MetadataImportError(converted, { cause: error });
    throw error;
  }
}

async function applyCreates(tx: Tx, rows: ImportRow[], staffId: string): Promise<void> {
  if (rows.length === 0) return;

  for (const batch of chunks(rows)) {
    await runWithPgError(batch, () => tx`
      insert into products ${tx(
        batch.map((row) => ({
          id: row.productId,
          category_id: row.categoryId,
          slug: row.slug,
          name: row.name,
          brand: row.brand,
          brand_id: row.brandId,
          condition_id: row.conditionId,
          description: row.description,
          price_paise: row.pricePaise,
          compare_at_paise: row.compareAtPaise,
          sale_price_paise: row.salePricePaise,
          in_stock: row.stock === null ? true : row.stock > 0,
          is_active: row.isActive ?? false,
          seo_title: row.seoTitle,
          seo_description: row.seoDescription,
          updated_by: staffId,
        })),
        'id',
        'category_id',
        'slug',
        'name',
        'brand',
        'brand_id',
        'condition_id',
        'description',
        'price_paise',
        'compare_at_paise',
        'sale_price_paise',
        'in_stock',
        'is_active',
        'seo_title',
        'seo_description',
        'updated_by',
      )}
    `);
  }

  for (const row of rows) {
    if (row.stock !== null && !row.confirmTracking) {
      throw new MetadataImportError({
        rowNumber: row.rowNumber,
        column: 'confirm_tracking',
        message: 'Explicitly confirm enabling tracking with confirm_tracking=true.',
      });
    }
    await applyMetadata(tx, row, staffId);
  }

  for (const batch of chunks(rows)) {
    await tx`
      insert into price_history
      ${tx(
        batch.map((row) => ({
          product_id: row.productId,
          variant_id: null,
          old_price_paise: null,
          new_price_paise: row.pricePaise,
          price_kind: 'regular',
          currency: 'INR',
          reason: 'csv_import',
          source: 'bulk_import',
          changed_by: staffId,
        })),
        'product_id',
        'variant_id',
        'old_price_paise',
        'new_price_paise',
        'price_kind',
        'currency',
        'reason',
        'source',
        'changed_by',
      )}
    `;
  }

  const saleRows = rows.filter((row) => row.salePricePaise !== null);
  for (const batch of chunks(saleRows)) {
    await tx`
      insert into price_history
      ${tx(
        batch.map((row) => ({
          product_id: row.productId,
          variant_id: null,
          old_price_paise: null,
          new_price_paise: row.salePricePaise as number,
          price_kind: 'sale',
          currency: 'INR',
          reason: 'csv_import',
          source: 'bulk_import',
          changed_by: staffId,
        })),
        'product_id',
        'variant_id',
        'old_price_paise',
        'new_price_paise',
        'price_kind',
        'currency',
        'reason',
        'source',
        'changed_by',
      )}
    `;
  }

  for (const batch of chunks(rows)) {
    await tx`
      insert into stock
      ${tx(
        batch.map((row) => ({
          id: newId('stk'),
          product_id: row.productId,
          variant_id: null,
          on_hand: row.stock ?? 0,
          reserved: 0,
          low_stock_threshold: row.lowStockThreshold ?? 0,
          track_inventory: row.stock !== null,
          updated_by: staffId,
        })),
        'id',
        'product_id',
        'variant_id',
        'on_hand',
        'reserved',
        'low_stock_threshold',
        'track_inventory',
        'updated_by',
      )}
    `;
  }

  const opening = rows.filter((row) => row.stock !== null && row.stock > 0);
  for (const batch of chunks(opening)) {
    await tx`
      insert into stock_movements
      ${tx(
        batch.map((row) => ({
          product_id: row.productId,
          variant_id: null,
          delta: row.stock as number,
          reason: 'receipt',
          note: 'CSV import opening stock',
          created_by: staffId,
        })),
        'product_id',
        'variant_id',
        'delta',
        'reason',
        'note',
        'created_by',
      )}
    `;
  }

  const images = rows.flatMap((row) =>
    row.imageUrls.map((url, index) => ({
      id: newId('img'),
      product_id: row.productId,
      url,
      alt: '',
      role: index === 0 ? 'primary' : 'gallery',
      sort_order: index,
      is_active: true,
    })),
  );
  for (const batch of chunks(images)) {
    await tx`
      insert into product_images
      ${tx(batch, 'id', 'product_id', 'url', 'alt', 'role', 'sort_order', 'is_active')}
    `;
  }
}

async function applyUpdates(tx: Tx, rows: ImportRow[], staffId: string): Promise<void> {
  if (rows.length === 0) return;

  const ids = rows.map((row) => row.productId);
  await tx`select id from products where id in ${tx(ids)} order by id for update`;
  const stockKeys = rows.flatMap(row => [
    ...(row.stock !== null || row.lowStockThreshold !== null ? [{productId:row.productId,variantId:null as string | null}] : []),
    ...(row.inventoryVariants ?? []).filter(v=>v.stock!==null).map(v=>({productId:row.productId,variantId:v.id as string | null})),
  ]).sort((a,b)=>inventoryKey(a.productId,a.variantId).localeCompare(inventoryKey(b.productId,b.variantId)));
  // Lock every affected exact key before reading any balance or deriving deltas.
  for (const key of stockKeys) await tx`select id from stock where product_id=${key.productId} and variant_id is not distinct from ${key.variantId}::text for update`;
  const currentRows = (await tx`
    select p.id, p.price_paise, p.sale_price_paise, p.category_id, p.product_type_id, p.is_active, p.inventory_mode,
           to_jsonb(p)->>'short_description' as short_description,
           to_jsonb(p)->'description_sections' as description_sections,
           s.id as stock_id, s.on_hand, s.reserved,
           s.track_inventory, s.low_stock_threshold
    from products p
    left join stock s on s.product_id = p.id and s.variant_id is null
    where p.id in ${tx(ids)} and p.deleted_at is null
    order by p.id
    for update of p
  `) as Row[];
  const current = new Map(currentRows.map((row) => [text(row.id), row]));

  const priceHistory: Row[] = [];
  const inventoryChanges: InventoryChange[] = [];
  const rowNumberByInventoryKey = new Map<string, number>();

  for (const row of [...rows].sort((a,b)=>a.productId.localeCompare(b.productId))) {
    const variantChanges = await variantInventoryChanges(tx, row);
    for (const change of variantChanges) {
      rowNumberByInventoryKey.set(inventoryKey(change.productId, change.variantId), row.rowNumber);
    }
    inventoryChanges.push(...variantChanges);
    const before = current.get(row.productId);
    if (!before) {
      throw new Error(`Product ${row.productId} disappeared during the import.`);
    }
    const nextTypeId = row.metadata.productTypeId === undefined
      ? before.product_type_id == null ? null : text(before.product_type_id)
      : row.metadata.productTypeId;
    if (nextTypeId) {
      const matching = await tx`
        select id from product_types
        where id = ${nextTypeId} and category_id = ${row.categoryId}
      `;
      if (!matching.length) throw new MetadataImportError({
        rowNumber: row.rowNumber,
        column: 'product_type_id',
        message: 'Select an active product type belonging to the new category, or use null and save as a draft.',
      });
    }
    const beforePrice = number(before.price_paise);
    const beforeSale =
      before.sale_price_paise === null || before.sale_price_paise === undefined
        ? null
        : number(before.sale_price_paise);
    const onHand = before.stock_id ? number(before.on_hand) : 0;
    const reserved = before.stock_id ? number(before.reserved) : 0;
    const nextOnHand = row.stock === null ? onHand : row.stock;
    const inStock = before.inventory_mode === 'variant' || row.stock === null ? null : nextOnHand - reserved > 0;

    if (row.shortDescription !== undefined || row.descriptionSections !== undefined) {
      await applyProductContent(tx, row, staffId);
    }
    await runWithPgError(
      [row],
      () => tx`
        update products
        set name = ${row.name},
            slug = ${row.slug},
            category_id = ${row.categoryId},
            product_type_id = ${nextTypeId},
            brand = ${row.brand},
            brand_id = ${row.brandId},
            condition_id = ${row.conditionId},
            description = ${row.description},
            price_paise = ${row.pricePaise},
            compare_at_paise = ${row.compareAtPaise},
            sale_price_paise = ${row.salePricePaise},
            is_active = ${row.isActive ?? Boolean(before.is_active)},
            seo_title = ${row.seoTitle},
            seo_description = ${row.seoDescription},
            updated_at = now(),
            updated_by = ${staffId}
        where id = ${row.productId}
      `,
      row.rowNumber,
    );

    await applyMetadata(tx, {...row,shortDescription:undefined,descriptionSections:undefined}, staffId, before);

    if (inStock !== null) {
      await tx`
        update products set in_stock = ${inStock} where id = ${row.productId}
      `;
    }

    if (beforePrice !== row.pricePaise) {
      priceHistory.push({
        product_id: row.productId,
        variant_id: null,
        old_price_paise: beforePrice,
        new_price_paise: row.pricePaise,
        price_kind: 'regular',
        currency: 'INR',
        reason: 'csv_import',
        source: 'bulk_import',
        changed_by: staffId,
      });
    }

    if (beforeSale !== row.salePricePaise) {
      // A blank cell clears the sale price; 0 is the not-null sentinel the
      // history table needs, and `price_kind` states what actually happened.
      priceHistory.push({
        product_id: row.productId,
        variant_id: null,
        old_price_paise: beforeSale,
        new_price_paise: row.salePricePaise ?? 0,
        price_kind: row.salePricePaise === null ? 'sale_cleared' : 'sale',
        currency: 'INR',
        reason: row.salePricePaise === null ? 'sale_price_cleared' : 'csv_import',
        source: 'bulk_import',
        changed_by: staffId,
      });
    }

    if (row.stock !== null || row.lowStockThreshold !== null) {
      const parentChange: InventoryChange = {productId:row.productId,variantId:null,
        ...(row.stock===null?{}:{onHand:row.stock}),
        ...(row.lowStockThreshold===null?{}:{lowStockThreshold:row.lowStockThreshold}),
        ...(!before.stock_id?{onHand:row.stock??0,trackInventory:row.stock!==null}:row.stock===null?{}:{trackInventory:true}),
        confirmTracking:row.confirmTracking,reason:'adjustment',note:'CSV parent stocktake'};
      rowNumberByInventoryKey.set(inventoryKey(row.productId, null), row.rowNumber);
      inventoryChanges.push(parentChange);
    }
  }

  for (const batch of chunks(priceHistory)) {
    await tx`
      insert into price_history
      ${tx(
        batch,
        'product_id',
        'variant_id',
        'old_price_paise',
        'new_price_paise',
        'price_kind',
        'currency',
        'reason',
        'source',
        'changed_by',
      )}
    `;
  }
  for (const change of inventoryChanges.sort((a,b)=>inventoryKey(a.productId,a.variantId).localeCompare(inventoryKey(b.productId,b.variantId)))) {
    try {
      await adjustVariantInventoryUsing(tx,change,staffId);
    } catch (error) {
      const rowNumber = rowNumberByInventoryKey.get(inventoryKey(change.productId, change.variantId)) ?? 1;
      const converted = inventoryAdjustmentToImportError(error, change, rowNumber);
      if (converted) throw new MetadataImportError(converted);
      throw error;
    }
  }
}

/* ------------------------------------------------------------ error report */

export interface ImportErrorReport {
  importId: string;
  filename: string;
  mode: string;
  status: string;
  createdAt: string;
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportError[];
}

export async function getImportReport(importId: string): Promise<CatalogWrite<ImportErrorReport>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Imports are not available.');

  try {
    const jobRows = (await sql`
      select * from catalog_imports where id = ${importId} limit 1
    `) as Row[];
    const job = jobRows[0];
    if (!job) return fail('not-found', 'Import not found.');

    const errors = (await sql`
      select row_number, column_name, message
      from catalog_import_errors
      where import_id = ${importId}
      order by row_number asc, id asc
    `) as Row[];

    return {
      ok: true,
      data: {
        importId,
        filename: text(job.filename),
        mode: text(job.mode),
        status: text(job.status),
        createdAt: stamp(job.created_at),
        total: number(job.rows_total),
        created: number(job.rows_created),
        updated: number(job.rows_updated),
        failed: number(job.rows_failed),
        errors: errors.map((error) => ({
          rowNumber: number(error.row_number),
          column: text(error.column_name),
          message: text(error.message),
        })),
      },
    };
  } catch {
    console.warn('[store-admin/transfer] could not read an import report');
    return fail('unavailable', 'Imports are not available.');
  }
}
