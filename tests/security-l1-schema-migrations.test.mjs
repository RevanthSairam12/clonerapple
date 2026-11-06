/**
 * SECURITY (L-1): the migration ledger was readable with the publishable key.
 * It is internal: RLS with no policies, no grants for the API roles, and the
 * runner applies the same lockdown to a database it creates from scratch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const migrationPath = path.join(root, 'migrations', '0065_schema_migrations_lockdown.sql');
const runnerPath = path.join(root, 'scripts', 'migrate.mjs');
const verifierPath = path.join(root, 'scripts', 'verify-rls-consumer-tables.mjs');

test('migration 0065 enables RLS and revokes the API roles, guarded', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /to_regclass\('public\.schema_migrations'\)/);
  assert.match(sql, /alter table schema_migrations enable row level security/i);
  assert.match(sql, /revoke all on schema_migrations from anon/i);
  assert.match(sql, /revoke all on schema_migrations from authenticated/i);
  // Roles are checked so a local Postgres without them still migrates.
  assert.match(sql, /pg_roles where rolname = 'anon'/);
  assert.match(sql, /pg_roles where rolname = 'authenticated'/);
  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/i);
});

test('the runner locks down a freshly created ledger', async () => {
  const source = await readFile(runnerPath, 'utf8');
  const create = source.slice(source.indexOf('create table if not exists schema_migrations'));
  const block = create.slice(0, create.indexOf('const applied'));

  assert.match(block, /alter table schema_migrations enable row level security/i);
  assert.match(block, /revoke all on schema_migrations from anon/i);
  assert.match(block, /revoke all on schema_migrations from authenticated/i);
  assert.match(block, /pg_roles where rolname = 'anon'/);
});

test('the verifier asserts the ledger is denied', async () => {
  const source = await readFile(verifierPath, 'utf8');
  assert.match(source, /readRows\('schema_migrations', 'filename'\)/);
  assert.match(source, /deniedCheck\(schemaMigrations\)/);
});
