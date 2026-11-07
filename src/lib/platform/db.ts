import postgres from 'postgres';

/**
 * Shared PostgreSQL client for the admin panel.
 *
 * Reads DATABASE_URL from the environment (Supabase/Postgres connection
 * string). When the variable is unset (e.g. a build without a database),
 * `getSql()` returns null so callers fall back to hardcoded defaults and
 * the build never fails for a missing database.
 */

type Sql = ReturnType<typeof postgres>;

/**
 * One pool per process, not one per evaluated module.
 *
 * `next dev` compiles server code into more than one graph (pages, route
 * handlers, instrumentation) and re-evaluates modules on edits. A module-local
 * singleton therefore opens an extra pool per graph and per edit, and none of
 * the old ones is ever closed. The session pooler allows 15 clients in total,
 * so a few of those pools surface as `EMAXCONNSESSION: max clients reached`
 * on ordinary page loads. A `globalThis` slot survives re-evaluation and is
 * shared by every graph in the process; in production it is simply the one
 * process-wide pool.
 */
const globalForSql = globalThis as typeof globalThis & {
  __gadzioSql?: Sql | null;
  __gadzioMigrationSql?: Sql | null;
};

let warned = false;

export function resolvePoolMax(
  envMax = process.env.DATABASE_POOL_MAX,
  nodeEnv = process.env.NODE_ENV,
): number {
  const parsed = Number.parseInt(envMax || '', 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) return parsed;
  return nodeEnv === 'production' ? 10 : 5;
}

export const TRANSACTION_POOLER_REFUSAL_MESSAGE =
  'Refusing port 6543 (transaction pooler): migrations, scripts, and test fixtures require a session connection on port 5432 (session pooler or direct connection). Set DATABASE_MIGRATION_URL to a port 5432 URL.';

/**
 * Resolve the connection string for migrations, scripts, and test fixtures.
 *
 * Prefers `DATABASE_MIGRATION_URL` and falls back to `DATABASE_URL`. Refuses a
 * port-6543 transaction-pooler URL with a clear error message because DDL,
 * migrations, and schema-pinned test fixtures depend on session-level state.
 */
export function resolveMigrationDatabaseUrl(
  env: { DATABASE_MIGRATION_URL?: string; DATABASE_URL?: string } = process.env,
): string {
  const raw = (env.DATABASE_MIGRATION_URL || env.DATABASE_URL || '').trim();
  if (!raw) {
    throw new Error(
      'Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set. Add it to .env.local or the environment.',
    );
  }
  const url = new URL(raw);
  if (url.port === '6543') {
    throw new Error(TRANSACTION_POOLER_REFUSAL_MESSAGE);
  }
  return raw;
}

export function getMigrationSql(): Sql {
  if (!globalForSql.__gadzioMigrationSql) {
    const connectionUrl = resolveMigrationDatabaseUrl();
    globalForSql.__gadzioMigrationSql = postgres(connectionUrl, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 1800,
      ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForSql.__gadzioMigrationSql;
}

export function getSql(): Sql | null {
  if (!process.env.DATABASE_URL) {
    if (!warned && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[admin/db] DATABASE_URL is not set — admin content layer is disabled; the site renders its hardcoded defaults.',
      );
      warned = true;
    }
    return null;
  }
  if (!globalForSql.__gadzioSql) {
    // Supabase's Transaction pooler (…pooler.supabase.com:6543) runs PgBouncer
    // in transaction mode, which does not support prepared statements — the
    // postgres driver enables them by default, so turn them off for pooler
    // URLs. Direct and Session-pooler connections keep them.
    const url = new URL(process.env.DATABASE_URL);
    const isPooler = url.hostname.includes('pooler') && url.port === '6543';

    globalForSql.__gadzioSql = postgres(process.env.DATABASE_URL, {
      max: resolvePoolMax(),
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 1800,
      // Supabase and most hosted Postgres require TLS.
      ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
      prepare: !isPooler,
      onnotice: () => {},
    });
  }
  return globalForSql.__gadzioSql;
}
