/**
 * Read-only monitor for PostgreSQL backends stranded in `state = 'active'` with
 * `wait_event = 'ClientRead'`.
 *
 * When a transaction-pooler client sends an Extended Query Protocol `Parse +
 * Describe + Flush` message without a trailing `Sync` (or pipelines it behind
 * an unparameterized `Sync` query), the PostgreSQL backend waits indefinitely
 * in `state = 'active', wait_event = 'ClientRead'` for the rest of the cycle.
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-db-clientread.mjs [--min-seconds 5]
 *
 * Read-only: never terminates backends or mutates database state. Never prints
 * connection strings, credentials, or query parameter values.
 * Exits with code 1 if any stuck `ClientRead` session is found.
 */
import postgres from 'postgres';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'min-seconds': {
      type: 'string',
      default: process.env.CLIENTREAD_MIN_SECONDS || '5',
    },
  },
});

const minSeconds = Math.max(1, Number.parseInt(values['min-seconds'] || '5', 10) || 5);
const rawUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();

if (!rawUrl) {
  console.error('Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set.');
  process.exit(2);
}

const sql = postgres(rawUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  prepare: false,
  onnotice: () => {},
});

try {
  const rows = await sql`
    select
      pid,
      state,
      wait_event_type,
      wait_event,
      extract(epoch from (now() - query_start))::int as query_age_seconds,
      extract(epoch from (now() - state_change))::int as state_age_seconds,
      application_name
    from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and state = 'active'
      and wait_event = 'ClientRead'
      and query_start < now() - make_interval(secs => ${minSeconds})
    order by query_start asc
  `;

  const report = {
    checkedAt: new Date().toISOString(),
    thresholdSeconds: minSeconds,
    stuckClientReadCount: rows.length,
    sessions: rows.map((r) => ({
      pid: Number(r.pid),
      state: String(r.state),
      waitEventType: String(r.wait_event_type ?? ''),
      waitEvent: String(r.wait_event ?? ''),
      queryAgeSeconds: Number(r.query_age_seconds ?? 0),
      stateAgeSeconds: Number(r.state_age_seconds ?? 0),
      applicationName: String(r.application_name ?? ''),
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  if (rows.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 2 });
}
