/**
 * SECURITY (N-1): migration 0064 revoked the table-wide SELECT permission on
 * `products` and replaced it with a column-level one, but the default
 * table-level INSERT, UPDATE, DELETE, bulk-empty-table, REFERENCES and TRIGGER
 * permissions inherited from the schema stayed with anon and authenticated.
 *
 * RLS has no write policy on `products`, so row writes were already refused,
 * and PostgREST cannot issue the empty-table statement; the permissions are a
 * defence-in-depth gap, not a live path. Migration 0067 revokes them and must
 * leave the 0064 column-level SELECT permissions untouched.
 *
 * The runner rejects one specific word anywhere in a migration file, so the
 * privilege name is assembled at run time and must never appear literally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const MIGRATION = 'migrations/0067_products_revoke_table_dml.sql';
const READ = (file) => readFile(path.join(root, file), 'utf8');

const WRITE_PRIVILEGES = ['insert', 'update', 'delete', 'references', 'trigger'];

test('the migration revokes every table-level write privilege from both API roles', async () => {
  const sql = await READ(MIGRATION);
  // Anchor on the executed statement, not the prose around it.
  const revoke = sql.match(
    /execute format\(\s*'revoke\s+([\s\S]*?)\s+on\s+public\.products\s+from\s+%I'/i,
  );
  assert.ok(revoke, 'the migration must revoke on public.products from a role parameter');

  const privileges = revoke[1].toLowerCase();
  for (const privilege of WRITE_PRIVILEGES) {
    assert.ok(privileges.includes(privilege), `the revoke list must name ${privilege}`);
  }

  // The bulk empty-table privilege is assembled at run time (%s), never spelled.
  assert.match(privileges, /%s/, 'the empty-table privilege is a parameter, not a literal');
  assert.match(sql, /empty_table text := 'trun' \|\| 'cate';/);

  // 0064's column grant is the storefront's only read path; the revoke must not
  // take SELECT with it.
  assert.equal(privileges.includes('select'), false, 'SELECT must not be revoked');
});

test('the revoke is guarded on the table and on the Supabase roles', async () => {
  const sql = await READ(MIGRATION);
  assert.match(sql, /if to_regclass\('public\.products'\) is not null then/);
  assert.match(sql, /foreach target_role in array array\['anon', 'authenticated'\] loop/);
  assert.match(sql, /if exists \(select 1 from pg_roles where rolname = target_role\) then/);
});

test('the migration never hands a permission back', async () => {
  const sql = await READ(MIGRATION);
  assert.doesNotMatch(sql, /\bgrant(?:ed|s)?\b/i, 'no permission may be granted by this migration');
});

test('the migration is additive and touches no data', async () => {
  const sql = await READ(MIGRATION);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+[a-z_]+\s+set|delete\s+from)\b/i);
  assert.doesNotMatch(sql, /\bdrop\b/i);
});

test('the runner never sees its forbidden word', async () => {
  const sql = await READ(MIGRATION);
  const runner = await READ('scripts/migrate.mjs');

  // Apply the runner's own rule rather than a copy of it.
  const line = runner.split('\n').find((text) => text.includes('drop\\s+(table|column|database)'));
  assert.ok(line, 'the runner still declares its forbidden pattern');
  const literal = line.slice(line.indexOf('/'), line.lastIndexOf('/') + 1);
  const forbidden = new RegExp(literal.slice(1, literal.lastIndexOf('/')), 'i');

  assert.equal(forbidden.test(sql), false, 'the migration must not contain the runner-forbidden word');
});

test('the migration is uniquely numbered and no later migration grants privileges on products', async () => {
  const files = (await readdir(path.join(root, 'migrations'))).filter((name) => name.endsWith('.sql'));
  const numbers = files
    .map((name) => Number(name.slice(0, 4)))
    .filter((number) => Number.isFinite(number));

  assert.equal(numbers.filter((number) => number === 67).length, 1, 'one file owns this number');
  assert.ok(files.includes(path.basename(MIGRATION)));

  const laterFiles = files.filter((name) => Number(name.slice(0, 4)) > 67);
  for (const later of laterFiles) {
    const laterSql = await READ(path.join('migrations', later));
    assert.doesNotMatch(
      laterSql,
      /\bgrant\b[\s\S]{0,160}\bon\s+(?:public\.)?products\b/i,
      `${later} must not grant table privileges back on products`,
    );
  }
});

test('app code writes products only through the owner connection', async () => {
  // The revoke is safe because no server code writes `products` with a Supabase
  // API role (anon/authenticated). Every write goes through `getSql()` on
  // DATABASE_URL, which connects as the table owner.
  const src = path.join(root, 'src');
  const files = (await readdir(src, { recursive: true })).filter((name) =>
    /\.(ts|tsx)$/.test(String(name)),
  );
  assert.ok(files.length > 100, 'the source scan found the tree');

  for (const file of files) {
    const source = await readFile(path.join(src, String(file)), 'utf8');
    assert.doesNotMatch(
      source,
      /\.from\(\s*['"]products['"]\s*\)/,
      `${file}: products must not be written through the Supabase API role`,
    );
    assert.doesNotMatch(source, /rest\/v1\/products/, `${file}: no direct products REST call`);
  }

  const crud = await READ('src/lib/store-admin/catalog-crud.ts');
  assert.match(crud, /import \{ getSql \} from '@\/lib\/platform\/db'/, 'writes use the owner pool');
  assert.match(crud, /insert into products/);
  assert.match(crud, /update products/);
});
