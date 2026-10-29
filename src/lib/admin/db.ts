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
const globalForSql = globalThis as typeof globalThis & { __gadzioSql?: Sql | null };

let warned = false;

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
      max: 5,
      // Supabase and most hosted Postgres require TLS.
      ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
      prepare: !isPooler,
      onnotice: () => {},
    });
  }
  return globalForSql.__gadzioSql;
}
