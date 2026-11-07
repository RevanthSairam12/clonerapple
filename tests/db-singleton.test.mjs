/**
 * One connection pool per process.
 *
 * `next dev` evaluates server modules in more than one graph and again on
 * edits. While `getSql()` kept its pool in a module-level variable, every
 * graph and every re-evaluation opened another pool that was never closed;
 * together they exhausted the session pooler's 15-client limit and ordinary
 * page loads failed with `EMAXCONNSESSION`. The pool now lives on
 * `globalThis`, so two independent evaluations of the module must return the
 * very same client.
 *
 * No connection is opened: postgres.js connects lazily, on the first query.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('two evaluations of the db module share one pool', async () => {
  // A URL that resolves nowhere is enough: nothing connects until a query.
  process.env.DATABASE_URL = 'postgresql://nobody:nothing@127.0.0.1:5432/no_connection';
  process.env.DATABASE_SSL = 'false';

  // moduleCache:false makes each import a separate module instance, which is
  // exactly what the dev bundler's extra graph looks like.
  const load = () =>
    createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
    }).import(path.join(root, 'src', 'lib', 'platform', 'db.ts'));

  const first = await load();
  const second = await load();

  const a = first.getSql();
  const b = second.getSql();
  assert.ok(a, 'DATABASE_URL is set, so a pool must exist');
  assert.equal(a, b, 'the second evaluation must reuse the process-wide pool');
  assert.equal(globalThis.__gadzioSql, a, 'the pool is stored on globalThis');
  assert.equal(a.options.idle_timeout, 20, 'idle_timeout is 20s');
  assert.equal(a.options.connect_timeout, 10, 'connect_timeout is 10s');
  assert.equal(a.options.max_lifetime, 1800, 'max_lifetime is 1800s');

  assert.equal(first.resolvePoolMax(undefined, 'production'), 10, 'production default max is 10');
  assert.equal(first.resolvePoolMax(undefined, 'development'), 5, 'non-production default max is 5');
  assert.equal(first.resolvePoolMax('15', 'production'), 15, 'DATABASE_POOL_MAX overrides default');
  assert.equal(first.resolvePoolMax('invalid', 'production'), 10, 'invalid DATABASE_POOL_MAX falls back to default');
  assert.equal(first.resolvePoolMax('0', 'production'), 10, 'out-of-range DATABASE_POOL_MAX falls back to default');

  await a.end({ timeout: 0 });
  globalThis.__gadzioSql = null;
});

test('DATABASE_MIGRATION_URL prefers migration URL, falls back to DATABASE_URL, and refuses port 6543', async () => {
  const load = () =>
    createJiti(import.meta.url, {
      moduleCache: false,
      alias: { '@': path.join(root, 'src') },
    }).import(path.join(root, 'src', 'lib', 'platform', 'db.ts'));

  const mod = await load();

  // 1. Prefers DATABASE_MIGRATION_URL over DATABASE_URL (even when DATABASE_URL is port 6543)
  assert.equal(
    mod.resolveMigrationDatabaseUrl({
      DATABASE_URL: 'postgresql://app:pass@pooler.supabase.com:6543/postgres',
      DATABASE_MIGRATION_URL: 'postgresql://mig:pass@pooler.supabase.com:5432/postgres',
    }),
    'postgresql://mig:pass@pooler.supabase.com:5432/postgres',
  );

  // 2. Falls back to DATABASE_URL when DATABASE_MIGRATION_URL is unset
  assert.equal(
    mod.resolveMigrationDatabaseUrl({
      DATABASE_URL: 'postgresql://app:pass@pooler.supabase.com:5432/postgres',
    }),
    'postgresql://app:pass@pooler.supabase.com:5432/postgres',
  );

  // 3. Refuses port 6543 with a clear message
  assert.throws(
    () =>
      mod.resolveMigrationDatabaseUrl({
        DATABASE_MIGRATION_URL: 'postgresql://mig:pass@pooler.supabase.com:6543/postgres',
      }),
    /Refusing port 6543 \(transaction pooler\)/,
  );
  assert.throws(
    () =>
      mod.resolveMigrationDatabaseUrl({
        DATABASE_URL: 'postgresql://app:pass@pooler.supabase.com:6543/postgres',
      }),
    /Refusing port 6543 \(transaction pooler\)/,
  );

  // 4. Throws when neither is set
  assert.throws(
    () => mod.resolveMigrationDatabaseUrl({}),
    /Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set/,
  );
});
