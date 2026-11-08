/**
 * Read-only census of test schemas and non-system schemas.
 * Never prints connection strings, credentials, or passwords.
 *
 * Usage:
 *   node scripts/list-test-schemas.mjs             # lists known test prefixes (itest_, fs_)
 *   node scripts/list-test-schemas.mjs --all-non-system  # lists all non-Supabase-system, non-public schemas
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

const KNOWN_TEST_PREFIXES = ['itest_', 'fs_'];

const SUPABASE_SYSTEM_SCHEMAS = new Set([
  'public',
  'information_schema',
  'auth',
  'extensions',
  'graphql',
  'graphql_public',
  'pgbouncer',
  'realtime',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'vault',
  'net',
  'cron',
  'pgsodium',
  'pgsodium_masks',
]);

function loadEnvConfig() {
  const config = {};
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(DATABASE_MIGRATION_URL|DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
      if (m) config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // .env.local is optional when env vars are set directly
  }
  return config;
}

export function decodeBase36TimestampAge(schemaName, nowMs = Date.now()) {
  // Known test schema names end with `_${timestampBase36}${8HexChars}` or `_${timestampBase36}_${6HexChars}`
  const match = schemaName.match(/_([0-9a-z]{8,10})(?:_[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (!match) return { createdAt: null, ageSeconds: null, ageHuman: 'unknown' };
  const tsMs = Number.parseInt(match[1], 36);
  if (!Number.isFinite(tsMs) || tsMs < 1_600_000_000_000 || tsMs > nowMs + 86_400_000) {
    return { createdAt: null, ageSeconds: null, ageHuman: 'unknown' };
  }
  const ageSeconds = Math.max(0, Math.round((nowMs - tsMs) / 1000));
  const hours = Math.floor(ageSeconds / 3600);
  const minutes = Math.floor((ageSeconds % 3600) / 60);
  const seconds = ageSeconds % 60;
  const ageHuman = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return {
    createdAt: new Date(tsMs).toISOString(),
    ageSeconds,
    ageHuman,
  };
}

async function main() {
  const allNonSystem = process.argv.includes('--all-non-system');
  const config = loadEnvConfig();
  const connection =
    process.env.DATABASE_MIGRATION_URL ||
    process.env.DATABASE_URL ||
    config.DATABASE_MIGRATION_URL ||
    config.DATABASE_URL;

  if (!connection) {
    console.error('Error: Neither DATABASE_MIGRATION_URL nor DATABASE_URL is configured.');
    process.exitCode = 1;
    return;
  }

  let sql;
  try {
    const target = new URL(connection);
    if (target.port === '6543') {
      throw new Error('Refusing port 6543 (transaction pooler): use a session connection on port 5432.');
    }

    sql = postgres(connection, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      onnotice: () => {},
      ssl: (process.env.DATABASE_SSL || config.DATABASE_SSL) === 'false' ? undefined : 'require',
      connection: {
        search_path: 'pg_catalog',
        default_transaction_read_only: 'on',
        statement_timeout: 20000,
        lock_timeout: 3000,
      },
    });

    const report = await sql.begin('read only', async (tx) => {
      const [state] = await tx`show transaction_read_only`;
      if (state.transaction_read_only !== 'on') throw new Error('Transaction is not read-only');

      const rows = await tx`
        select
          n.nspname as name,
          pg_catalog.obj_description(n.oid, 'pg_namespace') as description,
          count(c.oid)::int as object_count,
          coalesce(
            sum(pg_catalog.pg_total_relation_size(c.oid))
              filter (where c.relkind in ('r', 'p', 'm', 't')),
            0
          )::bigint as size_bytes,
          pg_catalog.pg_size_pretty(
            coalesce(
              sum(pg_catalog.pg_total_relation_size(c.oid))
                filter (where c.relkind in ('r', 'p', 'm', 't')),
              0
            )::bigint
          ) as size_pretty
        from pg_catalog.pg_namespace n
        left join pg_catalog.pg_class c on c.relnamespace = n.oid
        where not starts_with(n.nspname, 'pg_')
          and not starts_with(n.nspname, '_realtime')
          and not starts_with(n.nspname, '_analytics')
          and not starts_with(n.nspname, '_supavisor')
        group by n.oid, n.nspname
        order by n.nspname
      `;

      const nowMs = Date.now();
      const filtered = rows
        .filter((r) => {
          if (allNonSystem) {
            return !SUPABASE_SYSTEM_SCHEMAS.has(r.name);
          }
          return KNOWN_TEST_PREFIXES.some((prefix) => r.name.startsWith(prefix));
        })
        .map((r) => {
          const age = decodeBase36TimestampAge(r.name, nowMs);
          return {
            name: r.name,
            objectCount: Number(r.object_count),
            sizeBytes: Number(r.size_bytes),
            sizePretty: r.size_pretty,
            createdAt: age.createdAt,
            ageSeconds: age.ageSeconds,
            ageHuman: age.ageHuman,
          };
        });

      return {
        checkedAt: new Date(nowMs).toISOString(),
        mode: allNonSystem ? 'all-non-system' : 'test-prefixes',
        prefixes: KNOWN_TEST_PREFIXES,
        readOnly: true,
        schemaCount: filtered.length,
        schemas: filtered,
      };
    });

    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(
      `Read-only test schema listing failed (${err instanceof Error ? err.message : 'unknown error'}). Credentials withheld.`,
    );
    process.exitCode = 1;
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
