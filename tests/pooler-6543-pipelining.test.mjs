/**
 * Contract & regression tests for the port-6543 transaction-pooler pipelining
 * fix in `src/lib/platform/db.ts`.
 *
 * Covers:
 *   1. Exact version pin (`"postgres": "3.4.9"`) in package.json and package-lock.json.
 *   2. postgres.js internals contract check (`Query.prototype.handle`, `query.options`,
 *      `connection.js` `onexecute` return-value gate, and `index.js` `busy`/`full` queues).
 *   3. `DATABASE_DISABLE_POOLER_NO_PIPELINE` environment switch behavior.
 *   4. Read-only monitoring script (`scripts/check-db-clientread.mjs`) contract.
 *   5. Opt-in live port-6543 regression test (`RUN_POOLER_6543_REGRESSION=1`) that
 *      reproduces the original hang with concurrent unparameterized + parameterized
 *      queries when the workaround is disabled, and proves it completes cleanly with
 *      zero `ClientRead` stalls when enabled.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const loadDbModule = () =>
  createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
  }).import(path.join(root, 'src', 'lib', 'platform', 'db.ts'));

test('package.json and package-lock.json pin the exact postgres.js version', async () => {
  const dbMod = await loadDbModule();
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const installedPkg = JSON.parse(
    readFileSync(path.join(root, 'node_modules', 'postgres', 'package.json'), 'utf8'),
  );

  assert.equal(
    pkg.dependencies.postgres,
    dbMod.PINNED_POSTGRES_VERSION,
    'package.json must pin exact postgres version without ^ or ~',
  );
  assert.equal(
    lock.packages[''].dependencies.postgres,
    dbMod.PINNED_POSTGRES_VERSION,
    'package-lock.json root dependency spec must match pinned postgres version',
  );
  assert.equal(
    lock.packages['node_modules/postgres'].version,
    dbMod.PINNED_POSTGRES_VERSION,
    'package-lock.json resolved node_modules/postgres version must match',
  );
  assert.equal(
    installedPkg.version,
    dbMod.PINNED_POSTGRES_VERSION,
    'installed node_modules/postgres version must match PINNED_POSTGRES_VERSION',
  );
});

test('postgres.js internals required by disablePoolerPipelining are intact', async () => {
  const dbMod = await loadDbModule();
  const client = postgres('postgresql://nobody:nothing@127.0.0.1:5432/no_connection', {
    ssl: false,
  });

  try {
    const proto = dbMod.assertPostgresPoolerInternals(client);
    assert.equal(typeof proto.handle, 'function', 'Query.prototype.handle must be a function');

    // Verify source-level invariants in node_modules/postgres so any change to
    // how onexecute controls busy vs full queueing fails this test immediately.
    const querySrc = readFileSync(
      path.join(root, 'node_modules', 'postgres', 'src', 'query.js'),
      'utf8',
    );
    const connSrc = readFileSync(
      path.join(root, 'node_modules', 'postgres', 'src', 'connection.js'),
      'utf8',
    );
    const indexSrc = readFileSync(
      path.join(root, 'node_modules', 'postgres', 'src', 'index.js'),
      'utf8',
    );

    assert.match(
      querySrc,
      /this\.options\s*=\s*options/,
      'Query constructor must store options on this.options',
    );
    assert.match(
      querySrc,
      /async\s+handle\s*\(\)\s*\{/,
      'Query.prototype.handle must exist',
    );
    assert.match(
      connSrc,
      /&&\s*\(!q\.options\.onexecute\s*\|\|\s*q\.options\.onexecute\(connection\)\)/,
      'connection.js execute() must gate its boolean return on q.options.onexecute(connection)',
    );
    assert.match(
      indexSrc,
      /function\s+go\(c,\s*query\)\s*\{\s*return\s+c\.execute\(query\)\s*\?\s*move\(c,\s*busy\)\s*:\s*move\(c,\s*full\)/,
      'index.js go() must move connection to full when c.execute(query) returns false',
    );
    assert.match(
      indexSrc,
      /sql\.unsafe\(['"]begin\s*['"]/,
      'index.js begin() must pass its own onexecute option on BEGIN',
    );
  } finally {
    await client.end({ timeout: 0 });
  }
});

test('DATABASE_DISABLE_POOLER_NO_PIPELINE switch controls the workaround', async () => {
  const dbMod = await loadDbModule();

  assert.equal(dbMod.isPoolerPipeliningWorkaroundDisabled({}), false);
  assert.equal(
    dbMod.isPoolerPipeliningWorkaroundDisabled({ DATABASE_DISABLE_POOLER_NO_PIPELINE: '0' }),
    false,
  );
  assert.equal(
    dbMod.isPoolerPipeliningWorkaroundDisabled({ DATABASE_DISABLE_POOLER_NO_PIPELINE: 'false' }),
    false,
  );
  assert.equal(
    dbMod.isPoolerPipeliningWorkaroundDisabled({ DATABASE_DISABLE_POOLER_NO_PIPELINE: '1' }),
    true,
  );
  assert.equal(
    dbMod.isPoolerPipeliningWorkaroundDisabled({ DATABASE_DISABLE_POOLER_NO_PIPELINE: 'true' }),
    true,
  );
  assert.equal(
    dbMod.isPoolerPipeliningWorkaroundDisabled({ DATABASE_DISABLE_POOLER_NO_PIPELINE: ' ON ' }),
    true,
  );

  const client = postgres('postgresql://nobody:nothing@127.0.0.1:6543/no_connection', {
    ssl: false,
    prepare: false,
  });
  try {
    assert.equal(
      dbMod.disablePoolerPipelining(client, { DATABASE_DISABLE_POOLER_NO_PIPELINE: '1' }),
      false,
      'disablePoolerPipelining returns false when disabled via env',
    );
    assert.equal(
      dbMod.disablePoolerPipelining(client, {}),
      true,
      'disablePoolerPipelining returns true when enabled',
    );
  } finally {
    await client.end({ timeout: 0 });
  }
});

test('scripts/check-db-clientread.mjs is read-only and queries pg_stat_activity for ClientRead', () => {
  const src = readFileSync(path.join(root, 'scripts', 'check-db-clientread.mjs'), 'utf8');
  assert.match(src, /wait_event\s*=\s*'ClientRead'/);
  assert.match(src, /state\s*=\s*'active'/);
  assert.doesNotMatch(
    src,
    /pg_terminate_backend|pg_cancel_backend|insert\s+into|update\s+|delete\s+from/i,
    'monitoring script must be strictly read-only',
  );
});

const runLive6543 = process.env.RUN_POOLER_6543_REGRESSION === '1' && Boolean(process.env.DATABASE_URL);

test(
  'live 6543 regression: reproduces hang when workaround is disabled and passes when enabled',
  { skip: !runLive6543 ? 'opt-in only: set RUN_POOLER_6543_REGRESSION=1 with a port-6543 DATABASE_URL' : false },
  async () => {
    const dbMod = await loadDbModule();
    const poolerUrl = process.env.DATABASE_URL;
    const migUrl = process.env.DATABASE_MIGRATION_URL || poolerUrl;
    assert.equal(new URL(poolerUrl).port, '6543', 'DATABASE_URL must be on port 6543');

    // 1. With workaround DISABLED (DATABASE_DISABLE_POOLER_NO_PIPELINE=1), concurrent
    //    unparameterized + parameterized queries on max=1 hang on Supavisor 6543.
    process.env.DATABASE_DISABLE_POOLER_NO_PIPELINE = '1';
    const rawClient = postgres(poolerUrl, {
      max: 1,
      connect_timeout: 10,
      ssl: 'require',
      prepare: false,
      onnotice: () => {},
    });

    let hungAsExpected = false;
    try {
      // Warm the single connection so needsTypes is satisfied and the connection
      // sits in `open`; the next concurrent pair pipelines onto `busy`.
      await rawClient`select 1`;
      await Promise.race([
        Promise.all([
          rawClient`select 1 as unparam`,
          rawClient`select ${'param_val'}::text as param`,
        ]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('EXPECTED_6543_PIPELINE_HANG')), 3500),
        ),
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === 'EXPECTED_6543_PIPELINE_HANG') {
        hungAsExpected = true;
      } else {
        throw err;
      }
    } finally {
      await rawClient.end({ timeout: 0 }).catch(() => {});
    }

    assert.equal(
      hungAsExpected,
      true,
      'Without the workaround, pipelined unparameterized + parameterized queries on port 6543 must reproduce the hang',
    );

    // Clean up the backend that the disabled run stranded in ClientRead
    const mig = postgres(migUrl, {
      max: 1,
      connect_timeout: 10,
      ssl: 'require',
      prepare: false,
      onnotice: () => {},
    });
    try {
      const stuck = await mig`
        select pid from pg_stat_activity
        where datname = current_database()
          and pid <> pg_backend_pid()
          and state = 'active'
          and wait_event = 'ClientRead'
      `;
      for (const row of stuck) {
        await mig`select pg_terminate_backend(${row.pid})`;
      }
    } finally {
      await mig.end({ timeout: 1 });
    }

    // 2. With workaround ENABLED, run 30 interleaved unparameterized + parameterized
    //    + array + transaction queries on max=2 over port 6543 and verify zero hangs.
    delete process.env.DATABASE_DISABLE_POOLER_NO_PIPELINE;
    const fixedClient = postgres(poolerUrl, {
      max: 2,
      connect_timeout: 10,
      ssl: 'require',
      prepare: false,
      onnotice: () => {},
    });
    dbMod.disablePoolerPipelining(fixedClient, {});

    try {
      const queries = [];
      for (let i = 0; i < 10; i += 1) {
        queries.push(fixedClient`select 1 as unparam`);
        queries.push(fixedClient`select ${`val_${i}`}::text as param`);
        queries.push(fixedClient`select id from categories where id = any(${fixedClient.array(['mobile-cases'])})`);
      }
      queries.push(
        fixedClient.begin(async (tx) =>
          Promise.all([
            tx`select count(*)::int as c from categories`,
            tx`select ${'tx_param'}::text as p`,
          ]),
        ),
      );
      await Promise.all(queries);
    } finally {
      await fixedClient.end({ timeout: 1 });
    }
  },
);
