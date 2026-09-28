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

let sql: Sql | null = null;
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
  if (!sql) {
    // Supabase's Transaction pooler (…pooler.supabase.com:6543) runs PgBouncer
    // in transaction mode, which does not support prepared statements — the
    // postgres driver enables them by default, so turn them off for pooler
    // URLs. Direct and Session-pooler connections keep them.
    const url = new URL(process.env.DATABASE_URL);
    const isPooler = url.hostname.includes('pooler') && url.port === '6543';

    sql = postgres(process.env.DATABASE_URL, {
      max: 5,
      // Supabase and most hosted Postgres require TLS.
      ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
      prepare: !isPooler,
      onnotice: () => {},
    });
  }
  return sql;
}
