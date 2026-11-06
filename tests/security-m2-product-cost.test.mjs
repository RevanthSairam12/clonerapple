/**
 * SECURITY (M-2): the public products policy was row-level only, so the
 * publishable key could read `cost_paise` (purchase cost) and other internal
 * columns alongside the display fields.
 *
 * The table-wide SELECT grant is replaced with a column grant for the
 * storefront fields. `select=*` therefore fails, and every safe column still
 * reads. The app does not use PostgREST for products at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const migrationPath = path.join(root, 'migrations', '0064_products_column_grants.sql');
const verifierPath = path.join(root, 'scripts', 'verify-rls-consumer-tables.mjs');

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

test('migration 0064 replaces the table grant with display columns only', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /revoke\s+select\s+on\s+public\.products\s+from\s+anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+select\s*\([\s\S]*?\)\s+on\s+public\.products\s+to\s+anon\s*,\s*authenticated/i);

  const grantStart = sql.indexOf('grant select (');
  const grant = sql.slice(grantStart, sql.indexOf(' on public.products', grantStart));
  for (const safe of ['id', 'name', 'price_paise', 'sale_price_paise', 'slug', 'is_active']) {
    assert.match(grant, new RegExp(`\\b${safe}\\b`), `${safe} must stay readable`);
  }
  for (const internal of ['cost_paise', 'updated_by', 'compatibility_reviewed_at', 'catalog_revision', 'sku_pattern']) {
    assert.doesNotMatch(grant, new RegExp(`\\b${internal}\\b`), `${internal} must not be granted`);
  }

  // Additive: the public row policy and RLS stay exactly as they were.
  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/i);
  assert.doesNotMatch(sql, /\bdrop\s+policy\b/i);
});

test('the app never reads products with the publishable key', async () => {
  for (const file of await sourceFiles(path.join(root, 'src'))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\.from\(['"]products['"]\)|rest\/v1\/products/,
      `${path.relative(root, file)} reads products through PostgREST`,
    );
  }
});

test('the verifier checks safe columns and the cost column denial', async () => {
  const source = await readFile(verifierPath, 'utf8');
  assert.match(source, /readRows\('products', 'id,name,price_paise'\)/);
  assert.match(source, /readRows\('products', 'id,cost_paise'\)/);
  assert.match(source, /deniedCheck\(productCost\)/);
});
