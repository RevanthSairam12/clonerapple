/**
 * Verify the seeded store catalogue against ../catalog-snapshot.json and the
 * anonymous (publishable-key) read surface.
 *
 * Usage: node scripts/verify-store-catalog.mjs
 *
 * Exit code 0 means every check passed. Any failed check prints FAIL and the
 * script exits 1, so this is safe to wire into a release gate.
 *
 * Requires DATABASE_URL in .env.local (or the environment). The anonymous
 * checks use NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * when present and fall back to SET LOCAL ROLE anon otherwise. No key or
 * connection string is ever printed.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const SNAPSHOT_PATH = path.resolve(ROOT, '..', 'catalog-snapshot.json');

const EXPECTED_CATEGORIES = [
  'airpods-case',
  'cable-plug-case',
  'cases-protection',
  'mobile-cases',
  'power-adapter-cable',
  'wired-earphones',
];
const EXPECTED_PRODUCTS_PER_CATEGORY = 2;

const checks = [];

function record(ok, label, detail) {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function formatINR(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

async function loadEnvLocal() {
  try {
    const env = await readFile(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Environment variables may already be set.
  }
}

async function readSnapshot() {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));
  } catch {
    console.error(
      'Could not read ../catalog-snapshot.json. Run scripts/dump-catalog-snapshot.mjs first.',
    );
    process.exit(1);
  }
}

async function restRows(table) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${base}/rest/v1/${table}?select=*&limit=100`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`${table}: HTTP ${response.status}`);
  }
  return response.json();
}

async function anonymousCounts(sql) {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    const [priceHistory, stock, products] = await Promise.all([
      restRows('price_history'),
      restRows('stock'),
      restRows('products'),
    ]);
    return {
      method: 'REST with the publishable key',
      priceHistory: priceHistory.length,
      stock: stock.length,
      products: products.length,
    };
  }

  // The direct connection is the table owner, which bypasses RLS. Switching
  // to the anon role for one transaction exercises the same policies.
  return sql.begin(async (tx) => {
    await tx`set local role anon`;
    const priceHistory = await tx`select id from price_history limit 100`;
    const stock = await tx`select id from stock limit 100`;
    const products = await tx`select id from products limit 100`;
    return {
      method: 'SET LOCAL ROLE anon',
      priceHistory: priceHistory.length,
      stock: stock.length,
      products: products.length,
    };
  });
}

async function main() {
  await loadEnvLocal();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
    process.exit(1);
  }

  const snapshot = await readSnapshot();
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    onnotice: () => {},
  });

  try {
    /* ------------------------------------------------------ categories */

    const categoryRows = await sql`
      select c.slug, count(p.id)::int as product_count
      from categories c
      left join products p
        on p.category_id = c.id and p.deleted_at is null
      where c.deleted_at is null
      group by c.slug
      order by c.slug
    `;
    record(
      categoryRows.length === 6,
      'category count',
      `expected 6, got ${categoryRows.length}`,
    );

    const categoryMap = new Map(
      categoryRows.map((row) => [row.slug, Number(row.product_count)]),
    );
    const missingCategories = EXPECTED_CATEGORIES.filter(
      (slug) => !categoryMap.has(slug),
    );
    record(
      missingCategories.length === 0,
      'expected category slugs',
      missingCategories.length
        ? `missing ${missingCategories.join(', ')}`
        : 'all six present',
    );

    const wrongCounts = EXPECTED_CATEGORIES.filter(
      (slug) => categoryMap.get(slug) !== EXPECTED_PRODUCTS_PER_CATEGORY,
    );
    record(
      wrongCounts.length === 0,
      'per-category product counts',
      wrongCounts.length
        ? wrongCounts
            .map((slug) => `${slug}=${categoryMap.get(slug) ?? 0}`)
            .join(', ')
        : '2 products in each category',
    );

    /* -------------------------------------------------------- products */

    const productRows = await sql`
      select id, price_paise, is_active, deleted_at
      from products
      where deleted_at is null
    `;
    record(
      productRows.length === 12,
      'product count',
      `expected 12, got ${productRows.length}`,
    );

    const productMap = new Map(
      productRows.map((row) => [String(row.id), Number(row.price_paise)]),
    );

    const missingProducts = snapshot.products.filter(
      (product) => !productMap.has(product.id),
    );
    record(
      missingProducts.length === 0,
      'snapshot products present',
      missingProducts.length
        ? `missing ${missingProducts.map((p) => p.id).join(', ')}`
        : '12/12',
    );

    const priceMismatches = snapshot.products.filter(
      (product) => productMap.get(product.id) !== product.price_paise,
    );
    record(
      priceMismatches.length === 0,
      'price_paise equals snapshot price × 100',
      priceMismatches.length
        ? priceMismatches
            .map(
              (product) =>
                `${product.id}: expected ${product.price_paise}, got ${productMap.get(product.id)}`,
            )
            .join('; ')
        : '12/12',
    );

    const displayMismatches = snapshot.products.filter((product) => {
      const paise = productMap.get(product.id);
      return paise === undefined || formatINR(paise) !== product.price_display;
    });
    record(
      displayMismatches.length === 0,
      'derived display string equals the code priceDisplay',
      displayMismatches.length
        ? displayMismatches
            .map(
              (product) =>
                `${product.id}: expected ${product.price_display}, got ${
                  productMap.has(product.id)
                    ? formatINR(productMap.get(product.id))
                    : 'missing'
                }`,
            )
            .join('; ')
        : '12/12',
    );

    const zeroPriceRows = productRows.filter((row) => Number(row.price_paise) <= 0);
    record(
      zeroPriceRows.length === 0,
      'non-positive prices',
      zeroPriceRows.length ? `${zeroPriceRows.length} found` : 'none',
    );

    /* --------------------------------------------------- price history */

    const historyRows = await sql`
      select product_id, count(*)::int as history_count
      from price_history
      where source = 'seed'
      group by product_id
    `;
    const historyMap = new Map(
      historyRows.map((row) => [String(row.product_id), Number(row.history_count)]),
    );
    const productsWithoutSeedHistory = snapshot.products.filter(
      (product) => !historyMap.has(product.id),
    );
    record(
      productsWithoutSeedHistory.length === 0,
      'seed price_history row per product',
      productsWithoutSeedHistory.length
        ? `missing ${productsWithoutSeedHistory.map((p) => p.id).join(', ')}`
        : '12/12',
    );

    /* ------------------------------------------------------------- RLS */

    const anon = await anonymousCounts(sql);
    record(
      anon.priceHistory === 0,
      'anon SELECT on price_history',
      `expected 0 rows, got ${anon.priceHistory} (${anon.method})`,
    );
    record(
      anon.stock === 0,
      'anon SELECT on stock',
      `expected 0 rows, got ${anon.stock} (${anon.method})`,
    );
    record(
      anon.products === 12,
      'anon SELECT on products',
      `expected 12 rows, got ${anon.products} (${anon.method})`,
    );
  } finally {
    await sql.end();
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed.`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    'Verification failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
