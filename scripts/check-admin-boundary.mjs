/**
 * Prove the admin boundary: the legacy CMS may edit design/marketing content,
 * but it may not accept product, price, stock, order, customer or shipping
 * data. Exit code 1 on any violation.
 *
 * Checks:
 *   1. Every non-Education field in the legacy collection registry is a
 *      design/marketing field (no commerce-shaped names).
 *   2. Legacy /api/admin routes never write a commerce table.
 *   3. The content save route calls the shared boundary validator.
 *   4. The legacy media uploader writes the shared `store_media` source.
 *   5. The collection migration and its RLS/archive columns exist.
 *
 * Usage: node scripts/check-admin-boundary.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(ROOT, 'src') },
});

let failed = false;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failed = true;
}
function ok(message) {
  console.log(`OK: ${message}`);
}

const { COLLECTIONS, THEME_FIELDS } = await jiti.import(
  path.join(ROOT, 'src', 'lib', 'admin', 'collections.ts'),
);
const { isCommerceFieldName, isExemptCollectionKey } = await jiti.import(
  path.join(ROOT, 'src', 'lib', 'admin', 'boundary.ts'),
);

/** Last property name in a field path, e.g. `ctas[0].label` -> `label`. */
function lastPathToken(input) {
  const matches = String(input).match(/[A-Za-z_][A-Za-z0-9_]*/g);
  return matches?.length ? matches[matches.length - 1] : String(input);
}

/* ------------------------------------------------ 1. legacy field registry */

let fieldCount = 0;
let exemptCount = 0;
for (const collection of COLLECTIONS) {
  if (isExemptCollectionKey(collection.key)) {
    exemptCount += 1;
    continue;
  }

  const paths = [
    ...collection.fields.map((field) => field.path),
    ...(collection.lists ?? []).flatMap((list) => [
      list.path,
      ...list.itemFields.map((field) => field.path),
    ]),
  ];

  for (const fieldPath of paths) {
    fieldCount += 1;
    const token = lastPathToken(fieldPath);
    if (isCommerceFieldName(token)) {
      fail(
        `${collection.key} exposes commerce field "${fieldPath}" in the legacy editor. ` +
          'Move it to Store Admin.',
      );
    }
  }
}

for (const field of THEME_FIELDS) {
  fieldCount += 1;
  if (isCommerceFieldName(field.path)) {
    fail(`theme setting "${field.path}" is commerce data.`);
  }
}

ok(
  `${fieldCount} legacy design/marketing fields checked; ` +
    `${exemptCount} Education Store collection(s) left alone by rule.`,
);

/* ------------------------------------------------ 2. legacy route writes */

async function collectRouteFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectRouteFiles(full)));
    else if (/^route\.(ts|tsx|js|jsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const COMMERCE_WRITE =
  /\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:public\.)?(products?|product_variants|product_images|stock|stock_movements|orders?|order_items|order_payments|refunds|customers?|users|shipping_methods|payment_methods)\b/i;

const ADMIN_API = path.join(ROOT, 'src', 'app', 'api', 'admin');
const routeFiles = await collectRouteFiles(ADMIN_API);
if (routeFiles.length === 0) fail('no legacy admin API routes found.');

for (const file of routeFiles) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  const source = await readFile(file, 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const write = COMMERCE_WRITE.exec(code);
  if (write) {
    fail(`${relative} writes commerce table "${write[1]}".`);
  }

  if (relative.endsWith('api/admin/content/route.ts')) {
    if (!/validateLegacyContentWrite\s*\(/.test(code)) {
      fail(`${relative} does not call validateLegacyContentWrite().`);
    }
    if (/delete\s+from\s+content_blocks/i.test(code)) {
      fail(`${relative} deletes content_blocks rows; archive them instead.`);
    }
  }

  if (relative.endsWith('api/admin/media/route.ts')) {
    if (!/insert\s+into\s+store_media/i.test(code)) {
      fail(`${relative} must write the shared store_media source.`);
    }
  }

  if (relative.endsWith('api/admin/settings/route.ts')) {
    if (!/THEME_SETTING_KEYS/.test(code)) {
      fail(`${relative} must whitelist theme keys.`);
    }
  }
}

ok(`${routeFiles.length} legacy admin API route(s) checked for commerce writes.`);

/* ------------------------------------------- 3. migration / archive shape */

const migrationPath = path.join(ROOT, 'migrations', '0033_storefront_collections.sql');
const migration = await readFile(migrationPath, 'utf8').catch(() => '');
if (!migration) {
  fail('migrations/0033_storefront_collections.sql is missing.');
} else {
  if (!/create\s+table\s+if\s+not\s+exists\s+product_collections/i.test(migration)) {
    fail('0033 must create product_collections idempotently.');
  }
  if (!/alter\s+table\s+product_collections\s+enable\s+row\s+level\s+security/i.test(migration)) {
    fail('0033 must enable RLS on product_collections in the same file.');
  }
  if (!/alter\s+table\s+content_blocks\s+add\s+column\s+if\s+not\s+exists\s+archived_at/i.test(migration)) {
    fail('0033 must add content_blocks.archived_at non-destructively.');
  }
  if (/create\s+policy/i.test(migration)) {
    fail('0033 must not add policies to the new table.');
  }
  ok('migration 0033 creates product_collections with RLS and content archiving.');
}

/* --------------------------------------- 4. legacy tree cannot touch them */

const LEGACY_DIRS = [
  path.join(ROOT, 'src', 'app', '(admin)'),
  path.join(ROOT, 'src', 'lib', 'admin'),
  ADMIN_API,
];

async function collectFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// boundary.ts and cms-product-migration.ts name commerce concepts by design;
// they contain no SQL and no editor fields.
const PLANNER_FILES = new Set(['boundary.ts', 'cms-product-migration.ts']);

let legacyFiles = 0;
for (const dir of LEGACY_DIRS) {
  for (const file of await collectFiles(dir)) {
    if (PLANNER_FILES.has(path.basename(file))) continue;
    legacyFiles += 1;
    const source = await readFile(file, 'utf8');
    if (/product_collections/i.test(source)) {
      fail(
        `${path.relative(ROOT, file)} references product_collections in the legacy admin tree.`,
      );
    }
  }
}
ok(`${legacyFiles} legacy admin source file(s) checked for collection access.`);

if (failed) {
  console.error('\nAdmin boundary check FAILED.');
  process.exit(1);
}
console.log('\nAdmin boundary check passed.');
