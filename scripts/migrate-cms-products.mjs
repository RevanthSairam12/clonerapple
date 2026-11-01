/**
 * One-way migration: product-shaped CMS rows -> the live catalogue.
 *
 * Older Cases & Protection content blocks could describe products inline
 * (name, price, image, badge). Products are now owned by the store admin, so
 * this script maps those items onto `products`, `product_variants` and
 * `product_images` by product id or variant SKU.
 *
 * Safety rules:
 *   * DRY RUN BY DEFAULT. Pass --commit to write anything.
 *   * The database wins. Only an empty database field is filled; a differing
 *     price/image/subtitle is reported and kept as the database value.
 *   * Never guesses. An item with no id/SKU, or an id/SKU that matches nothing,
 *     is reported as unmatched and left alone.
 *   * Idempotent. Re-running after a commit produces no new writes.
 *
 * Usage:
 *   node scripts/migrate-cms-products.mjs
 *   node scripts/migrate-cms-products.mjs --commit
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createJiti } from 'jiti';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const envPath = path.resolve(ROOT, '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // no .env.local — DATABASE_URL must come from the real environment
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

const commit = process.argv.includes('--commit');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(ROOT, 'src') },
});
const {
  isCmsProductCollectionKey,
  parseCmsProductItems,
  planCmsItemMigration,
  resolveCmsItemProduct,
} = await jiti.import(path.join(ROOT, 'src', 'lib', 'catalogue', 'product-import.ts'));

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  max: 1,
  onnotice: () => {},
});

let blocks;
try {
  // Archived blocks are rollback history, not a source to migrate from.
  blocks = await sql`
    select key, value from content_blocks
    where archived_at is null
    order by key
  `;
} catch {
  // Migration 0033 has not run yet; archived rows cannot be distinguished.
  blocks = await sql`select key, value from content_blocks order by key`;
}

const [products, variants, images] = await Promise.all([
  sql`
    select id, name, subtitle, description, badge, price_paise
    from products
    where deleted_at is null
    order by id
  `,
  sql`
    select sku, product_id from product_variants
    where sku is not null and sku <> ''
    order by sku
  `,
  sql`
    select product_id, url from product_images
    where deleted_at is null and is_active
    order by product_id, sort_order
  `,
]);

const imagesByProduct = new Map();
for (const row of images) {
  const list = imagesByProduct.get(row.product_id) ?? [];
  list.push(row.url);
  imagesByProduct.set(row.product_id, list);
}

const productById = new Map(products.map((row) => [row.id, row]));

const unmatched = [];
const notes = [];
const updates = [];
const imageInserts = [];
let scannedBlocks = 0;
let scannedItems = 0;
let matchedItems = 0;
let keptValues = 0;

for (const block of blocks) {
  if (!isCmsProductCollectionKey(block.key)) continue;
  scannedBlocks += 1;

  const items = parseCmsProductItems(block.key, block.value);
  scannedItems += items.length;

  for (const item of items) {
    const productId = resolveCmsItemProduct(item, products, variants);
    if (!productId) {
      unmatched.push({
        key: block.key,
        path: item.path,
        id: item.id,
        sku: item.sku,
        name: item.name,
        reason: item.id || item.sku ? 'no matching product id or SKU' : 'no product id or SKU',
      });
      continue;
    }

    const product = productById.get(productId);
    if (!product) continue;
    matchedItems += 1;

    const plan = planCmsItemMigration(
      item,
      {
        id: product.id,
        name: product.name,
        subtitle: product.subtitle ?? '',
        description: product.description ?? '',
        badge: product.badge,
        price_paise: Number(product.price_paise),
      },
      imagesByProduct.get(productId) ?? [],
    );

    keptValues += plan.kept.length;
    for (const note of plan.notes) {
      notes.push(`${block.key} ${item.path} (${productId}): ${note}`);
    }

    if (Object.keys(plan.fills).length > 0) {
      updates.push({ productId, fills: plan.fills });
    }
    if (plan.addImage && plan.imageRowId) {
      imageInserts.push({
        id: plan.imageRowId,
        productId,
        url: plan.addImage,
        alt: item.name || product.name,
      });
    }
  }
}

if (commit && (updates.length > 0 || imageInserts.length > 0)) {
  await sql.begin(async (tx) => {
    for (const update of updates) {
      // COALESCE keeps the current value for any field this item did not fill,
      // so the database still wins for non-empty fields.
      await tx`
        update products set
          subtitle = coalesce(${update.fills.subtitle ?? null}, subtitle),
          description = coalesce(${update.fills.description ?? null}, description),
          badge = coalesce(${update.fills.badge ?? null}, badge),
          updated_at = now(),
          updated_by = 'cms_migration'
        where id = ${update.productId}
      `;
    }

    for (const image of imageInserts) {
      await tx`
        insert into product_images
          (id, product_id, url, alt, role, sort_order, is_active)
        values
          (${image.id}, ${image.productId}, ${image.url}, ${image.alt},
           'primary', 0, true)
        on conflict (id) do nothing
      `;
    }
  });
}

await sql.end();

console.log('=== CMS product migration ===');
console.log(commit ? 'Mode: COMMIT' : 'Mode: DRY RUN (pass --commit to apply)');
console.log(`Scanned ${scannedBlocks} cases.* content block(s), ${scannedItems} product-shaped item(s).`);
console.log(`Matched: ${matchedItems}; unmatched: ${unmatched.length}.`);
console.log(`Database values kept over CMS values: ${keptValues}.`);
console.log(`Planned field fills: ${updates.length}; planned image additions: ${imageInserts.length}.`);

if (unmatched.length > 0) {
  console.log('\nUnmatched items (left alone):');
  for (const row of unmatched) {
    console.log(
      `  ${row.key} ${row.path}: id=${row.id || '-'} sku=${row.sku || '-'} ` +
        `name=${row.name || '-'} (${row.reason})`,
    );
  }
}

if (notes.length > 0) {
  console.log('\nDatabase-wins notes:');
  for (const note of notes) console.log(`  ${note}`);
}

if (!commit && (updates.length > 0 || imageInserts.length > 0)) {
  console.log('\nNo writes were made. Re-run with --commit to apply the plan.');
}
