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

  await a.end({ timeout: 0 });
});
