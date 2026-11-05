#!/usr/bin/env node
/**
 * Read-only review of existing products for the options-table rollout.
 *
 * Reports counts only — never product names, SKUs, prices or IDs — for
 * products that would show "Needs review" in the store admin:
 *
 *   - sold by options while the shared parent stock still holds units;
 *   - an active option whose effective price is missing or zero;
 *   - a SKU used by more than one option.
 *
 * It never writes. It refuses to run unless the target is clearly safe:
 * localhost, or a host whose name marks it as test/staging/sandbox/dev, and
 * only with an explicit acknowledgement variable. Connection details are
 * never printed.
 *
 *   REVIEW_PRODUCT_OPTIONS=read-only node scripts/review-product-options.mjs
 */
import fs from 'node:fs';
import postgres from 'postgres';

const ACK = 'read-only';

function envFile() {
  const env = {};
  if (!fs.existsSync('.env.local')) return env;
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function safeTarget(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return 'local';
  if (/(^|[.-])(test|testing|staging|sandbox|dev|review)([.-]|$)/.test(host)) return 'test-like';
  return null;
}

let sql;
try {
  if (process.env.REVIEW_PRODUCT_OPTIONS !== ACK) {
    throw new Error('refused: set REVIEW_PRODUCT_OPTIONS=read-only to acknowledge this is a safe read-only target');
  }
  const env = envFile();
  const connection = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!connection) throw new Error('refused: DATABASE_URL is not set');

  const url = new URL(connection);
  const target = safeTarget(url.hostname);
  if (!target) {
    throw new Error('refused: the database host is not localhost or a test/staging/sandbox/dev host');
  }

  sql = postgres(connection, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl: (process.env.DATABASE_SSL || env.DATABASE_SSL) === 'false' ? undefined : 'require',
    onnotice: () => {},
    connection: {
      default_transaction_read_only: 'on',
      search_path: 'public',
      statement_timeout: 30000,
      lock_timeout: 3000,
    },
  });

  const report = await sql.begin('isolation level repeatable read read only', async (tx) => {
    const [mode] = await tx`show transaction_read_only`;
    if (mode.transaction_read_only !== 'on') throw new Error('refused: the transaction is not read-only');

    const [totals] = await tx`
      select
        count(*)::int as products,
        count(*) filter (where exists (
          select 1 from product_variants v where v.product_id = p.id and v.is_active
        ))::int as products_with_options
      from products p
      where p.deleted_at is null`;

    const [flags] = await tx`
      with product_flags as (
        select
          p.id,
          exists (
            select 1 from product_variants v where v.product_id = p.id and v.is_active
          ) as has_options,
          exists (
            select 1 from stock s
            where s.product_id = p.id and s.variant_id is null
              and s.track_inventory and s.on_hand > 0
          ) as shared_stock,
          exists (
            select 1 from stock s
            where s.product_id = p.id and s.variant_id is null
              and s.track_inventory and (s.on_hand - s.reserved) > 0
          ) as shared_available,
          exists (
            select 1 from product_variants v
            where v.product_id = p.id and v.is_active and v.is_purchasable
              and coalesce(
                nullif(greatest(coalesce(v.price_paise_override, 0), 0), 0),
                nullif(greatest(coalesce(p.price_paise, 0), 0), 0)
              ) is null
          ) as missing_option_price,
          exists (
            select 1 from product_variants v
            where v.product_id = p.id and v.is_active and v.is_purchasable
              and v.sku is not null and btrim(v.sku) <> ''
              and lower(btrim(v.sku)) in (
                select lower(btrim(dupe.sku)) from product_variants dupe
                where dupe.sku is not null and btrim(dupe.sku) <> ''
                group by lower(btrim(dupe.sku)) having count(*) > 1
              )
          ) as duplicate_sku
        from products p
        where p.deleted_at is null
      )
      select
        count(*) filter (where has_options and shared_stock)::int as products_options_with_shared_stock,
        count(*) filter (where has_options and shared_stock and shared_available)::int as products_shared_stock_not_allocated,
        count(*) filter (where missing_option_price)::int as products_missing_option_price,
        count(*) filter (where duplicate_sku)::int as products_duplicate_sku,
        count(*) filter (where
          (has_options and shared_stock) or missing_option_price or duplicate_sku
        )::int as products_needs_review
      from product_flags`;

    const [options] = await tx`
      select
        count(*)::int as total,
        count(*) filter (where is_active and is_purchasable)::int as sellable,
        count(*) filter (where is_active and is_purchasable and (sku is null or btrim(sku) = ''))::int as missing_sku,
        count(*) filter (where is_active and is_purchasable and coalesce(price_paise_override, 0) <= 0)::int as zero_or_missing_override
      from product_variants`;

    const [duplicates] = await tx`
      select
        count(*)::int as groups,
        coalesce(sum(rows), 0)::int as rows
      from (
        select lower(btrim(sku)) as sku, count(*)::int as rows
        from product_variants
        where sku is not null and btrim(sku) <> ''
        group by lower(btrim(sku))
        having count(*) > 1
      ) duplicate_skus`;

    return {
      target,
      readOnly: true,
      proposedWrites: 0,
      products: totals,
      options,
      duplicateSkus: duplicates,
      needsReview: {
        products: flags.products_needs_review,
        reasons: {
          optionsWithSharedStock: flags.products_options_with_shared_stock,
          sharedStockNotAllocated: flags.products_shared_stock_not_allocated,
          missingOptionPrice: flags.products_missing_option_price,
          duplicateSku: flags.products_duplicate_sku,
        },
      },
    };
  });

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Never echo the connection string or driver error, which may contain it.
  console.error(
    error instanceof Error && error.message.startsWith('refused')
      ? `Product options review ${error.message}. No writes attempted.`
      : 'Product options review refused or failed; details withheld. No writes attempted.',
  );
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
