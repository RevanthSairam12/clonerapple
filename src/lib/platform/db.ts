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
  env: Readonly<Record<string, string | undefined>> = process.env,
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

export const PINNED_POSTGRES_VERSION = '3.4.9';

/**
 * Environment switch to disable the port-6543 transaction-pooler pipelining
 * workaround (`DATABASE_DISABLE_POOLER_NO_PIPELINE=1|true|on`).
 */
export function isPoolerPipeliningWorkaroundDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = (env.DATABASE_DISABLE_POOLER_NO_PIPELINE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/**
 * Verify that the postgres.js Query prototype exposes the exact `.handle()` and
 * `.options` shape required by `disablePoolerPipelining`. Throws if a driver
 * upgrade alters those internals.
 */
export function assertPostgresPoolerInternals(client: Sql): {
  handle: (this: { options?: { onexecute?: () => boolean } }) => Promise<unknown>;
  __gadzioNoPipeline?: boolean;
} {
  const probe = client`select 1` as unknown as {
    options?: Record<string, unknown>;
  };
  const proto = Object.getPrototypeOf(probe) as {
    handle?: (this: { options?: { onexecute?: () => boolean } }) => Promise<unknown>;
    __gadzioNoPipeline?: boolean;
  } | null;
  if (
    !proto ||
    typeof proto.handle !== 'function' ||
    !probe ||
    typeof probe.options !== 'object' ||
    probe.options === null
  ) {
    throw new Error(
      'postgres.js Query internals changed: disablePoolerPipelining requires Query.prototype.handle and query.options.',
    );
  }
  return proto as {
    handle: (this: { options?: { onexecute?: () => boolean } }) => Promise<unknown>;
    __gadzioNoPipeline?: boolean;
  };
}

/**
 * Prevent postgres.js from pipelining a second query onto an in-flight
 * transaction-pooler connection. When an unparameterized query (`Sync`) is
 * pipelined with a parameterized `prepare: false` query (`Parse + Describe +
 * Flush`), Supavisor on port 6543 detaches the backend after the first query's
 * `ReadyForQuery`, stranding the second query in `ClientRead`. Returning
 * `false` from `onexecute` moves the connection to `full` until `ReadyForQuery`
 * arrives, while leaving `sql.begin`'s own `onexecute` hook untouched.
 *
 * Set `DATABASE_DISABLE_POOLER_NO_PIPELINE=1` to bypass this workaround.
 */
export function disablePoolerPipelining(
  client: Sql,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (isPoolerPipeliningWorkaroundDisabled(env)) return false;
  const proto = assertPostgresPoolerInternals(client);
  if (!proto.__gadzioNoPipeline) {
    const origHandle = proto.handle;
    proto.handle = function handleWithoutPipelining() {
      if (
        !isPoolerPipeliningWorkaroundDisabled(process.env) &&
        this.options &&
        !this.options.onexecute
      ) {
        this.options.onexecute = () => false;
      }
      return origHandle.call(this);
    };
    proto.__gadzioNoPipeline = true;
  }
  return true;
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

    const client = postgres(process.env.DATABASE_URL, {
      max: resolvePoolMax(),
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 1800,
      // Supabase and most hosted Postgres require TLS.
      ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
      prepare: !isPooler,
      onnotice: () => {},
    });
    if (isPooler && !isPoolerPipeliningWorkaroundDisabled(process.env)) {
      disablePoolerPipelining(client, process.env);
    }
    globalForSql.__gadzioSql = client;
  }
  return globalForSql.__gadzioSql;
}
