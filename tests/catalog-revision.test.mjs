import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { MAX_CATALOG_REVISION, validateExpectedRevision, readCatalogRevision, assertCatalogRevision } =
  await jiti.import(path.join(root, 'src/lib/store-admin/catalog-revision.ts'));
const errorIs = (status, code) => error => error.status === status && error.code === code;

test('expected revision accepts only bounded JSON integer numbers including zero', () => {
  for (const value of [0, 1, 234, MAX_CATALOG_REVISION]) assert.equal(validateExpectedRevision(value), value);
  for (const value of [undefined, null, '', '0', '1', '01', '1.0', true, false, [], {}, 1n, -1, 0.5, NaN, Infinity, -Infinity, MAX_CATALOG_REVISION + 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => validateExpectedRevision(value), errorIs(400, 'CATALOG_REVISION_INVALID'));
  }
});

test('locked row comparison fails closed on missing schema and stale edits with stable conflict code', () => {
  assert.doesNotThrow(() => assertCatalogRevision({ catalog_revision: 0 }, 0));
  assert.doesNotThrow(() => assertCatalogRevision({ catalog_revision: MAX_CATALOG_REVISION }, MAX_CATALOG_REVISION));
  for (const [actual, expected] of [[1, 0], [5, 4], [0, 1]]) {
    assert.throws(() => assertCatalogRevision({ catalog_revision: actual }, expected), errorIs(409, 'CATALOG_REVISION_CONFLICT'));
  }
  for (const value of [undefined, null, '0', -1, MAX_CATALOG_REVISION + 1]) {
    assert.throws(() => readCatalogRevision(value), errorIs(503, 'CATALOG_REVISION_UNAVAILABLE'));
    assert.throws(() => assertCatalogRevision({ catalog_revision: value }, 0), errorIs(503, 'CATALOG_REVISION_UNAVAILABLE'));
  }
  assert.throws(() => assertCatalogRevision({ catalog_revision: 0 }, null), errorIs(400, 'CATALOG_REVISION_INVALID'));
});

test('revision helpers have no DB/env/time dependencies and do not mutate locked rows', async () => {
  const row = Object.freeze({ catalog_revision: 4 });
  assertCatalogRevision(row, 4);
  const source = await readFile(path.join(root, 'src/lib/store-admin/catalog-revision.ts'), 'utf8');
  assert.doesNotMatch(source, /^import\b|process\.env|getSql\(|postgres\(|Date\.|fetch\(/m);
});

test('admin product detail returns exact opaque revision while public/list DTOs stay unchanged', async () => {
  const queries = [];
  let revision = 47;
  const sql = async strings => {
    const query = strings.join('?');
    queries.push(query);
    if (/from products p/.test(query)) return [{ id: 'p', catalog_revision: revision }];
    return [];
  };
  const reader = createJiti(import.meta.url, {
    moduleCache: false, alias: { '@': path.join(root, 'src') },
    virtualModules: { '@/lib/platform/db': { getSql: () => sql } },
  });
  const catalog = await reader.import(path.join(root, 'src/lib/store-admin/catalog.ts'));
  const detail = await catalog.getCatalogProduct('p');
  assert.equal(detail.ok, true);
  assert.equal(detail.data.catalogRevision, 47);
  assert.match(queries[0], /p\.catalog_revision/);
  assert.ok(!Object.hasOwn(catalog.mapCatalogOverviewProduct({ id: 'p', catalog_revision: 47 }), 'catalogRevision'));
  revision = null;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await catalog.getCatalogProduct('p'), { ok: false, reason: 'unavailable' });
  } finally { console.warn = warn; }
});

test('migration statically covers editorial child mutations, bounded monotonic parent guard, no stock or RLS writes', async () => {
  // Source contract only, not evidence of executing PostgreSQL triggers.
  const migration = await readFile(path.join(root, 'migrations/0057_catalog_edit_revision.sql'), 'utf8');
  assert.match(migration, /catalog_revision integer not null default 0\s+check \(catalog_revision >= 0\)/);
  assert.match(migration, /new\.catalog_revision := old\.catalog_revision \+ 1/);
  assert.match(migration, /new\.catalog_revision::bigint <> old\.catalog_revision::bigint \+ 1/);
  assert.match(migration, /old\.catalog_revision = 2147483647/);
  assert.match(migration, /\['catalog_revision','updated_at','updated_by','created_at','in_stock'\]/);
  for (const table of ['product_images', 'product_variants', 'product_device_models', 'product_attribute_values', 'product_facets', 'product_specs']) {
    assert.match(migration, new RegExp(`after insert or update or delete on ${table}\\b`));
  }
  for (const table of ['product_types', 'product_type_attributes', 'device_models', 'device_brands']) {
    assert.match(migration, new RegExp(`after insert or update or delete on ${table}\\b`));
  }
  assert.doesNotMatch(migration, /after insert or update or delete on (?:attributes|attribute_options|units)\b/);
  assert.match(migration, /is not distinct from \(to_jsonb\(old\)/);
  assert.match(migration, /select distinct id from unnest\(product_ids\).*order by id/);
  assert.doesNotMatch(migration, /\bon stock\b|\bupdate stock\b|enable row level security|disable row level security|create policy|pg_advisory_xact_lock\(/i);
  assert.doesNotMatch(migration, /\b(drop\s+(table|column|database)|truncate|alter\s+table\s+\w+\s+drop\s+(?!constraint\b|policy\b))\b/i);
});

test('preflight source refuses modes, limits connections, defaults to readonly and prints aggregates only', async () => {
  // Deliberately inspect source: never import/execute a DB-capable preflight in offline tests.
  const source = await readFile(path.join(root, 'scripts/inspect-product-simplification.mjs'), 'utf8');
  assert.match(source, /process\.argv\.length > 2/);
  assert.match(source, /max: 1/);
  assert.match(source, /default_transaction_read_only: 'on'/);
  assert.match(source, /isolation level repeatable read read only/);
  assert.match(source, /transaction_read_only !== 'on'/);
  assert.match(source, /indisunique && index\?\.indisvalid && index\?\.indisready/);
  for (const required of ['option_identity', 'retired_at', 'idx_variants_live_option', 'idx_variants_semantic_identity']) assert.ok(source.includes(required));
  assert.match(source, /where retired_at is null and is_purchasable and option_identity is not null/);
  assert.match(source, /coalesce\(device_model_id,''\)/);
  assert.match(source, /column_name === 'option_identity' && c\.data_type === 'text'/);
  assert.match(source, /column_name === 'retired_at' && c\.data_type === 'timestamp with time zone'/);
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*(connection|process\.env|error\.|host|rows)/);
  assert.doesNotMatch(source, /sql\.unsafe|tx\.unsafe|\b(insert into|update products|delete from|alter table|create table)\b/i);
});
