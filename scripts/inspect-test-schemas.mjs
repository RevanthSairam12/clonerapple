// Read-only fixture census. Never adopts or drops existing namespaces.
import fs from 'node:fs';
import postgres from 'postgres';
let sql;
try {
  const config = {};
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(DATABASE_MIGRATION_URL|DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
    if (m) config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const connection = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || config.DATABASE_MIGRATION_URL || config.DATABASE_URL;
  const target = new URL(connection);
  if (target.port === '6543') throw new Error('Refusing port 6543 (transaction pooler): use a session connection on port 5432.');
  if (target.hostname !== 'aws-0-ap-northeast-1.pooler.supabase.com' || target.pathname !== '/postgres' || (target.port && target.port !== '5432')) throw new Error('target');
  sql = postgres(connection, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {},
    ssl: (process.env.DATABASE_SSL || config.DATABASE_SSL) === 'false' ? undefined : 'require',
    connection: { search_path: 'pg_catalog', default_transaction_read_only: 'on', statement_timeout: 20000, lock_timeout: 3000 },
  });
  const report = await sql.begin('read only', async tx => {
    const [state] = await tx`show transaction_read_only`;
    if (state.transaction_read_only !== 'on') throw new Error('readonly');
    const schemas = await tx`
      select n.nspname as name, pg_get_userbyid(n.nspowner) = current_user as owned_by_connection_role,
        count(c.oid)::int as objects
      from pg_namespace n left join pg_class c on c.relnamespace = n.oid
      where starts_with(n.nspname, 'itest_') or starts_with(n.nspname, 'fs_')
      group by n.oid, n.nspname, n.nspowner order by n.nspname
    `;
    const [activity] = await tx`select count(*)::int as other_sessions,
      count(*) filter(where state = 'active')::int as active_sessions
      from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`;
    return { checkedAt: new Date().toISOString(), host: target.hostname, readOnly: true, schemas, activity,
      decision: 'Existing schemas are unverified leftovers, never adopted or dropped by this inspector.' };
  });
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('Read-only fixture census failed; connection/error details withheld. No writes attempted.');
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
