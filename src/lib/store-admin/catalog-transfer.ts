import { randomBytes } from 'node:crypto';

import type postgres from 'postgres';

import { getSql } from '@/lib/admin/db';

import {
  EXPORT_COLUMNS,
  parseCsv,
  toCsv,
  validateImportRows,
  type ImportContext,
  type ImportError,
  type ImportRow,
} from './catalog-csv';
import type { CatalogWrite } from './catalog-writes';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Catalogue transfer runs on the server only.');
}

type Row = Record<string, unknown>;
type Tx = postgres.TransactionSql;

const CHUNK = 400;

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
              p.compare_at_paise, s.on_hand, s.low_stock_threshold,
              coalesce((
                select string_agg(i.url, '|' order by (i.role = 'primary') desc, i.sort_order, i.id)
                from product_images i
                where i.product_id = p.id and i.is_active and i.deleted_at is null
              ), '') as image_urls,
              p.is_active, p.seo_title, p.seo_description, p.created_at, p.updated_at
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
      row.on_hand === null || row.on_hand === undefined ? '' : String(number(row.on_hand)),
      row.low_stock_threshold === null || row.low_stock_threshold === undefined
        ? ''
        : String(number(row.low_stock_threshold)),
      text(row.image_urls),
      row.is_active ? 'true' : 'false',
      text(row.seo_title),
      text(row.seo_description),
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
 * a stocktake sheet. Untracked products show an empty quantity, because
 * checkout ignores their number.
 */
export async function exportStockReport(
  scope: 'low' | 'all',
): Promise<CatalogWrite<ExportResult>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  const lowOnly = scope === 'low'
    ? 'and s.track_inventory and (s.on_hand - s.reserved) <= s.low_stock_threshold'
    : '';

  try {
    const rows = (await sql.unsafe(
      `select p.id, p.slug, p.name,
              s.on_hand, s.reserved, s.low_stock_threshold, s.track_inventory,
              s.updated_at
       from products p
       left join stock s on s.product_id = p.id and s.variant_id is null
       where p.deleted_at is null ${lowOnly}
       order by (s.on_hand - s.reserved) nulls last, p.name asc
       limit 10000`,
    )) as Row[];

    const csvRows = rows.map((row) => {
      const tracked = row.track_inventory === true;
      const onHand = number(row.on_hand);
      const reserved = number(row.reserved);
      const available = onHand - reserved;
      const threshold = number(row.low_stock_threshold);
      const status = !tracked ? 'untracked' : available <= threshold ? 'low' : 'ok';
      return [
        text(row.id),
        text(row.slug),
        text(row.name),
        tracked ? String(onHand) : '',
        tracked ? String(reserved) : '',
        tracked ? String(available) : '',
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
    sql`select id, slug from products where deleted_at is null`,
  ]);
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
    existing: new Map(
      (products as Row[]).map((row) => [text(row.id), { slug: text(row.slug) }]),
    ),
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

  const validation = validateImportRows(parsed.header, parsed.rows, context);
  const importId = newId('imp');
  const failedRows = new Set(validation.errors.map((error) => error.rowNumber));
  const creates = validation.rows.filter((row) => row.mode === 'create');
  const updates = validation.rows.filter((row) => row.mode === 'update');
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
      await applyCreates(tx, creates, input.staffId);
      await applyUpdates(tx, updates, input.staffId);
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
    console.warn('[store-admin/transfer] import rolled back');
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
            ${importId}, 1, 'import',
            ${
              error instanceof Error
                ? `The import failed and nothing was written: ${error.message.slice(0, 300)}`
                : 'The import failed and nothing was written.'
            }
          )
        `;
      });
    } catch {
      console.warn('[store-admin/transfer] could not record the failed import');
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

async function applyCreates(tx: Tx, rows: ImportRow[], staffId: string): Promise<void> {
  if (rows.length === 0) return;

  for (const batch of chunks(rows)) {
    await tx`
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
          in_stock: row.stock === null ? true : row.stock > 0,
          is_active: row.isActive,
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
        'in_stock',
        'is_active',
        'seo_title',
        'seo_description',
        'updated_by',
      )}
    `;
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
          currency: 'INR',
          reason: 'csv_import',
          source: 'bulk_import',
          changed_by: staffId,
        })),
        'product_id',
        'variant_id',
        'old_price_paise',
        'new_price_paise',
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
  const currentRows = (await tx`
    select p.id, p.price_paise, s.id as stock_id, s.on_hand, s.reserved,
           s.track_inventory, s.low_stock_threshold
    from products p
    left join stock s on s.product_id = p.id and s.variant_id is null
    where p.id in ${tx(ids)}
  `) as Row[];
  const current = new Map(currentRows.map((row) => [text(row.id), row]));

  const priceHistory: Row[] = [];
  const movements: Row[] = [];

  for (const row of rows) {
    const before = current.get(row.productId);
    if (!before) {
      throw new Error(`Product ${row.productId} disappeared during the import.`);
    }
    const beforePrice = number(before.price_paise);
    const onHand = before.stock_id ? number(before.on_hand) : 0;
    const reserved = before.stock_id ? number(before.reserved) : 0;
    const nextOnHand = row.stock === null ? onHand : row.stock;
    const inStock = row.stock === null ? null : nextOnHand - reserved > 0;

    await tx`
      update products
      set name = ${row.name},
          slug = ${row.slug},
          category_id = ${row.categoryId},
          brand = ${row.brand},
          brand_id = ${row.brandId},
          condition_id = ${row.conditionId},
          description = ${row.description},
          price_paise = ${row.pricePaise},
          compare_at_paise = ${row.compareAtPaise},
          is_active = ${row.isActive},
          seo_title = ${row.seoTitle},
          seo_description = ${row.seoDescription},
          updated_at = now(),
          updated_by = ${staffId}
      where id = ${row.productId}
    `;

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
        currency: 'INR',
        reason: 'csv_import',
        source: 'bulk_import',
        changed_by: staffId,
      });
    }

    const threshold = row.lowStockThreshold ?? (before.stock_id ? number(before.low_stock_threshold) : 0);
    if (before.stock_id) {
      await tx`
        update stock
        set on_hand = ${nextOnHand},
            low_stock_threshold = ${threshold},
            track_inventory = ${row.stock === null ? Boolean(before.track_inventory) : true},
            updated_at = now(),
            updated_by = ${staffId}
        where id = ${text(before.stock_id)}
      `;
    } else {
      await tx`
        insert into stock (
          id, product_id, variant_id, on_hand, reserved, low_stock_threshold,
          track_inventory, updated_by
        ) values (
          ${newId('stk')}, ${row.productId}, null, ${nextOnHand}, 0, ${threshold},
          ${row.stock !== null}, ${staffId}
        )
      `;
    }

    if (row.stock !== null && row.stock !== onHand) {
      movements.push({
        product_id: row.productId,
        variant_id: null,
        delta: row.stock - onHand,
        reason: 'adjustment',
        note: 'CSV import',
        created_by: staffId,
      });
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
        'currency',
        'reason',
        'source',
        'changed_by',
      )}
    `;
  }
  for (const batch of chunks(movements)) {
    await tx`
      insert into stock_movements
      ${tx(batch, 'product_id', 'variant_id', 'delta', 'reason', 'note', 'created_by')}
    `;
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
