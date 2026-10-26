/**
 * Catalogue parity report — static storefront bundles vs the products tables.
 *
 * READ ONLY. Makes no writes. Run before switching any page to the database:
 *
 *   node scripts/catalog-parity.mjs
 *
 * Matching is by product id (case-insensitively) and then by variant SKU.
 * Names are never used to match, because two products may share a name.
 *
 * Reports:
 *   * static products that have no live database row (fatal: they would vanish)
 *   * static colour options that have no database variant (fatal: they would
 *     disappear from the detail page)
 *   * database products that are not in the static bundles (informational:
 *     these are products created in Store Admin)
 *   * per-field differences for name, subtitle, price, compare-at price,
 *     images, variants, specs and facets.
 *
 * Exit codes: 0 = parity is safe to wire, 2 = fatal gaps found, 1 = could not run.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createJiti } from 'jiti';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

try {
  const env = await readFile(path.resolve(ROOT, '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local — DATABASE_URL must come from the environment.
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(ROOT, 'src') },
});
const registry = await jiti.import(path.join(ROOT, 'src', 'lib', 'products', 'registry.ts'));

const staticProducts = [
  ...registry.CASE_PRODUCTS.map((product) => ({ ...product, kind: 'case' })),
  ...registry.ALL_ACCESSORY_PRODUCTS.map((product) => ({ ...product, kind: 'accessory' })),
];

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  max: 1,
  onnotice: () => {},
});

const [categories, products, variants, images, specs, facets] = await Promise.all([
  sql`select id, slug, name from categories where deleted_at is null order by slug`,
  sql`
    select id, category_id, slug, name, subtitle, price_paise, compare_at_paise,
           material, brand, badge, in_stock, is_active, deleted_at
    from products
    order by id
  `,
  sql`
    select product_id, sku, option_name, option_value, option_hex, is_active, sort_order
    from product_variants
    order by product_id, sort_order, option_value
  `,
  sql`
    select product_id, id, url, role, sort_order, is_active, deleted_at
    from product_images
    order by product_id, role, sort_order, id
  `,
  sql`
    select product_id, label, value, sort_order
    from product_specs
    order by product_id, sort_order
  `,
  sql`
    select product_id, facet_key, facet_value, sort_order
    from product_facets
    order by product_id, facet_key, sort_order
  `,
]);

await sql.end();

const grouped = (rows, key = 'product_id') => {
  const map = new Map();
  for (const row of rows) {
    const id = String(row[key]);
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
};

const dbById = new Map(products.map((row) => [String(row.id).toLowerCase(), row]));
const dbVariants = grouped(variants);
const dbImages = grouped(images);
const dbSpecs = grouped(specs);
const dbFacets = grouped(facets);
const dbCategoryById = new Map(categories.map((row) => [String(row.id), row]));

const STATIC_IDS = new Set(staticProducts.map((product) => product.id.toLowerCase()));
const DB_IDS = new Set(products.map((row) => String(row.id).toLowerCase()));

const fatal = [];
const warnings = [];
const info = [];
const perProduct = [];

const rupeesToPaise = (value) => Math.round(Number(value) * 100);
const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

function liveImages(productId) {
  return (dbImages.get(productId) ?? [])
    .filter((row) => row.is_active && !row.deleted_at)
    .slice()
    .sort((a, b) => {
      const rank = (role) => (role === 'primary' ? 0 : role === 'hover' ? 1 : 2);
      return rank(a.role) - rank(b.role) || Number(a.sort_order) - Number(b.sort_order) || String(a.id).localeCompare(String(b.id));
    })
    .map((row) => String(row.url));
}

for (const product of staticProducts) {
  const key = product.id.toLowerCase();
  let db = dbById.get(key);
  let matchedBy = 'id';

  if (!db) {
    const sku = String(product.sku ?? '').trim().toLowerCase();
    if (sku) {
      const variant = (variants ?? []).find(
        (row) => String(row.sku ?? '').trim().toLowerCase() === sku,
      );
      if (variant) {
        db = dbById.get(String(variant.product_id).toLowerCase());
        matchedBy = 'sku';
      }
    }
  }

  if (!db) {
    fatal.push(`static product ${product.id} has no database row`);
    perProduct.push({ id: product.id, status: 'MISSING IN DB', diffs: [] });
    continue;
  }

  if (db.deleted_at || !db.is_active) {
    fatal.push(
      `static product ${product.id} exists but is ${db.deleted_at ? 'deleted' : 'inactive'} in the database`,
    );
    perProduct.push({ id: product.id, status: 'NOT LIVE IN DB', diffs: [] });
    continue;
  }

  const diffs = [];

  if (!sameText(product.name, db.name)) {
    diffs.push({ field: 'name', static: product.name, db: db.name });
  }
  if (!sameText(product.subtitle, db.subtitle)) {
    diffs.push({ field: 'subtitle', static: product.subtitle, db: db.subtitle });
  }
  if (rupeesToPaise(product.price) !== Number(db.price_paise)) {
    diffs.push({
      field: 'price',
      static: `${product.price} (${rupeesToPaise(product.price)} paise)`,
      db: `${Number(db.price_paise) / 100} (${db.price_paise} paise)`,
    });
  }
  if (db.compare_at_paise !== null && db.compare_at_paise !== undefined) {
    info.push(
      `${product.id}: database compare-at ${Number(db.compare_at_paise) / 100} has no static counterpart`,
    );
  }

  const dbImageUrls = liveImages(String(db.id));
  const staticImages = [
    product.image,
    ...(Array.isArray(product.images) ? product.images : []),
  ].filter(Boolean);
  const staticImageSet = [...new Set(staticImages)];
  const missingImages = staticImageSet.filter((url) => !dbImageUrls.includes(url));
  const extraImages = dbImageUrls.filter((url) => !staticImageSet.includes(url));
  if (missingImages.length > 0) {
    diffs.push({ field: 'images (static not in DB)', static: missingImages.join(', '), db: dbImageUrls.join(', ') });
  }
  if (extraImages.length > 0) {
    diffs.push({ field: 'images (DB extra)', static: staticImageSet.join(', '), db: extraImages.join(', ') });
  }

  const staticColors = (product.colors ?? []).map((color) => ({
    name: String(color.name ?? '').trim(),
    hex: String(color.hex ?? '').trim(),
  }));
  const dbColors = (dbVariants.get(String(db.id)) ?? [])
    .filter((row) => row.is_active)
    .map((row) => ({
      name: String(row.option_value ?? '').trim(),
      hex: String(row.option_hex ?? '').trim(),
    }));
  const dbColorNames = new Set(dbColors.map((color) => color.name.toLowerCase()));
  const missingColors = staticColors.filter((color) => !dbColorNames.has(color.name.toLowerCase()));
  if (missingColors.length > 0) {
    fatal.push(
      `static product ${product.id} has colour option(s) with no database variant: ` +
        missingColors.map((color) => color.name).join(', '),
    );
  }
  const staticColorNames = new Set(staticColors.map((color) => color.name.toLowerCase()));
  const extraColors = dbColors.filter((color) => !staticColorNames.has(color.name.toLowerCase()));
  if (extraColors.length > 0) {
    diffs.push({
      field: 'variants (DB extra)',
      static: staticColors.map((color) => color.name).join(', ') || '(none)',
      db: extraColors.map((color) => color.name).join(', '),
    });
  }
  const hexDiffs = staticColors.filter((color) => {
    const match = dbColors.find((dbColor) => dbColor.name.toLowerCase() === color.name.toLowerCase());
    return match && color.hex && match.hex && match.hex !== color.hex;
  });
  for (const color of hexDiffs) {
    const match = dbColors.find((dbColor) => dbColor.name.toLowerCase() === color.name.toLowerCase());
    diffs.push({ field: `variant hex (${color.name})`, static: color.hex, db: match.hex });
  }

  const staticSpecs = Array.isArray(product.specs)
    ? product.specs.map((spec) => ({ label: spec.label, value: spec.value }))
    : Object.entries(product.specs ?? {}).map(([label, value]) => ({ label, value }));
  const dbSpecRows = dbSpecs.get(String(db.id)) ?? [];
  for (const spec of staticSpecs) {
    const match = dbSpecRows.find((row) => sameText(row.label, spec.label));
    if (!match) {
      diffs.push({ field: `spec "${spec.label}" missing in DB`, static: spec.value, db: '(static will fill)' });
    } else if (!sameText(match.value, spec.value)) {
      diffs.push({ field: `spec "${spec.label}"`, static: spec.value, db: match.value });
    }
  }
  for (const row of dbSpecRows) {
    if (!staticSpecs.some((spec) => sameText(spec.label, row.label))) {
      diffs.push({ field: `spec "${row.label}" only in DB`, static: '(none)', db: row.value });
    }
  }

  const staticFacets = product.facets ?? {};
  const dbFacetRows = dbFacets.get(String(db.id)) ?? [];
  for (const [facetKey, staticValue] of Object.entries(staticFacets)) {
    const values = dbFacetRows
      .filter((row) => row.facet_key === facetKey)
      .map((row) => String(row.facet_value));
    if (values.length === 0) {
      diffs.push({ field: `facet "${facetKey}" missing in DB`, static: staticValue, db: '(static will fill)' });
    } else if (!values.some((value) => sameText(value, staticValue))) {
      diffs.push({ field: `facet "${facetKey}"`, static: staticValue, db: values.join(', ') });
    }
  }

  const dbCategory = dbCategoryById.get(String(db.category_id));
  const staticCategorySlug = product.categorySlug ?? (product.kind === 'case' ? 'cases-protection' : '');
  if (staticCategorySlug && dbCategory && dbCategory.slug !== staticCategorySlug) {
    diffs.push({ field: 'category', static: staticCategorySlug, db: dbCategory.slug });
  }

  const status = diffs.length > 0 ? 'DIFFS' : 'MATCH';
  perProduct.push({ id: product.id, status, diffs, matchedBy });
}

const extraDbProducts = products.filter(
  (row) => !STATIC_IDS.has(String(row.id).toLowerCase()) && !row.deleted_at,
);

console.log('=== Storefront catalogue parity ===');
console.log(`Static products: ${staticProducts.length}`);
console.log(`Database products: ${products.length} (${extraDbProducts.length} not in the static bundles)`);
console.log('');

console.log('Per-product result');
for (const row of perProduct) {
  console.log(`  ${row.status.padEnd(14)} ${row.id}${row.matchedBy === 'sku' ? ' (matched by SKU)' : ''}`);
  for (const diff of row.diffs) {
    console.log(`      ${diff.field}: static=${diff.static} | db=${diff.db}`);
  }
}

if (extraDbProducts.length > 0) {
  console.log('\nDatabase products absent from the static bundles (expected for Store Admin creations):');
  for (const row of extraDbProducts) {
    console.log(
      `  ${row.id} | ${row.name} | ${Number(row.price_paise) / 100} | ` +
        `${dbCategoryById.get(String(row.category_id))?.slug ?? row.category_id}`,
    );
  }
}

if (info.length > 0) {
  console.log('\nInformational:');
  for (const line of info) console.log(`  ${line}`);
}

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const line of warnings) console.log(`  ${line}`);
}

if (fatal.length > 0) {
  console.log('\nFATAL — static storefront data the database lacks:');
  for (const line of fatal) console.log(`  ${line}`);
  console.log('\nDo not switch the storefront to database reads until these are resolved.');
  process.exit(2);
}

console.log('\nNo fatal parity gaps. Safe to wire the storefront to the database.');
process.exit(0);
