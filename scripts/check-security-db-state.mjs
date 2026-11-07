/**
 * READ-ONLY verification of the security migrations 0063-0067.
 *
 * Issues SELECT statements against the catalogue only. It never writes, never
 * runs DDL and never prints a connection string, a row body or a customer
 * value — only counts, booleans and file names.
 *
 * Usage:  node scripts/check-security-db-state.mjs
 * Exit:   0 when every expectation holds, 1 otherwise.
 *
 * The column list it expects is read out of migration 0064 rather than copied
 * here, so the migration stays the single source of truth.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

/** Minimal .env.local loader; the repo has no dotenv dependency. */
async function loadEnvLocal() {
  try {
    const env = await readFile(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // DATABASE_URL is expected from the real environment.
  }
}

/** The columns 0064 grants SELECT on, in the order the migration lists them. */
async function expectedProductColumns() {
  const source = await readFile(
    path.resolve(process.cwd(), 'migrations', '0064_products_column_grants.sql'),
    'utf8',
  );
  const grant = source.match(/grant select \(([\s\S]*?)\)\s+on public\.products/i);
  if (!grant) throw new Error('Could not read the column grant out of migration 0064.');
  return grant[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Columns that must never be readable with the publishable key. */
const WITHHELD = ['cost_paise', 'updated_by', 'catalog_revision'];

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
}

async function main() {
  await loadEnvLocal();
  const connectionUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
  if (!connectionUrl) {
    console.error('DATABASE_MIGRATION_URL or DATABASE_URL is not set; nothing was checked.');
    process.exitCode = 1;
    return;
  }
  if (new URL(connectionUrl).port === '6543') {
    console.error('Refusing port 6543 (transaction pooler): use a session connection on port 5432.');
    process.exitCode = 1;
    return;
  }

  // One short-lived client keeps well inside the 15-session pooler cap.
  const sql = postgres(connectionUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    onnotice: () => {},
  });

  try {
    /* ------------------------------------------------ 1. applied migrations */
    const migrations = await sql`
      select filename from schema_migrations order by filename
    `;
    const applied = migrations.map((row) => String(row.filename));
    const required = ['0063', '0064', '0065', '0066', '0067'];
    const missing = required.filter(
      (prefix) => !applied.some((file) => file.startsWith(`${prefix}_`)),
    );
    check(
      'MIG-1',
      missing.length === 0,
      missing.length === 0
        ? `0063-0067 all recorded (${applied.length} files total)`
        : `missing: ${missing.join(', ')}`,
    );

    /* ------------------------------------- 2. no table-level products grants */
    // 0067 revokes the table-level DML. Any row here means the grant survived.
    const tablePrivileges = await sql`
      select grantee, privilege_type
      from information_schema.table_privileges
      where table_schema = 'public'
        and table_name = 'products'
        and grantee in ('anon', 'authenticated')
      order by grantee, privilege_type
    `;
    check(
      'PRIV-1',
      tablePrivileges.length === 0,
      tablePrivileges.length === 0
        ? 'no table-level privileges for anon/authenticated'
        : `${tablePrivileges.length} row(s): ${tablePrivileges
            .map((row) => `${row.grantee}:${row.privilege_type}`)
            .join(', ')}`,
    );

    /* -------------------------------- 3. column SELECT grants are exact */
    const expected = await expectedProductColumns();
    const columnRows = await sql`
      select grantee, column_name, privilege_type
      from information_schema.column_privileges
      where table_schema = 'public'
        and table_name = 'products'
        and grantee in ('anon', 'authenticated')
    `;

    for (const role of ['anon', 'authenticated']) {
      const granted = new Set(
        columnRows
          .filter((row) => row.grantee === role && row.privilege_type === 'SELECT')
          .map((row) => String(row.column_name)),
      );

      const notGranted = expected.filter((name) => !granted.has(name));
      check(
        `COLS-${role}-allow`,
        notGranted.length === 0,
        notGranted.length === 0
          ? `${granted.size} display columns granted (expected ${expected.length}+)`
          : `not granted: ${notGranted.join(', ')}`,
      );

      const leaked = WITHHELD.filter((name) => granted.has(name));
      check(
        `COLS-${role}-deny`,
        leaked.length === 0,
        leaked.length === 0
          ? `${WITHHELD.join(', ')} all withheld`
          : `LEAKED: ${leaked.join(', ')}`,
      );
    }

    /* --------------------- 4. non-SELECT column privileges are all revoked */
    const nonSelect = columnRows.filter((row) => row.privilege_type !== 'SELECT');
    check(
      'PRIV-2',
      nonSelect.length === 0,
      nonSelect.length === 0
        ? 'no column-level INSERT/UPDATE/REFERENCES for anon/authenticated'
        : nonSelect
            .map((row) => `${row.grantee}:${row.column_name}:${row.privilege_type}`)
            .join(', '),
    );

    /* ------------------------------------------ 5. RLS on the tables in scope */
    const rls = await sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('products', 'schema_migrations', 'users', 'user_sessions', 'orders')
      order by c.relname
    `;
    const withoutRls = rls.filter((row) => row.relrowsecurity !== true);
    check(
      'RLS-1',
      rls.length >= 5 && withoutRls.length === 0,
      withoutRls.length === 0
        ? `${rls.length} table(s) have RLS enabled`
        : `RLS off: ${withoutRls.map((row) => row.relname).join(', ')}`,
    );

    /* --------------------------------- 6. order_sale_state runs as invoker */
    const view = await sql`
      select c.relkind, c.reloptions, pg_get_userbyid(c.relowner) as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'order_sale_state'
    `;
    const invoker =
      view.length === 1 &&
      Array.isArray(view[0].reloptions) &&
      view[0].reloptions.includes('security_invoker=true');
    check(
      'VIEW-1',
      invoker,
      invoker ? 'security_invoker=true' : `reloptions=${JSON.stringify(view[0]?.reloptions ?? null)}`,
    );

    /* ---------------------------- 7. statement guards exist on the ledgers */
    const guards = await sql`
      select c.relname, count(*)::int as guard_count
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and not t.tgisinternal
        and t.tgname like '%_statement_guard'
        and (t.tgtype & 1) = 0          -- ROW bit clear: FOR EACH STATEMENT
        and (t.tgtype & 2) = 2          -- BEFORE
      group by c.relname
    `;
    const guardedTables = new Set(guards.map((row) => String(row.relname)));
    const requiredGuards = [
      'store_admin_audit',
      'price_history',
      'order_status_history',
      'order_edit_logs',
      'refunds',
      'payment_events',
    ];
    const unguarded = requiredGuards.filter((table) => !guardedTables.has(table));
    check(
      'GUARD-1',
      unguarded.length === 0,
      unguarded.length === 0
        ? `${requiredGuards.length} ledger tables have a statement guard`
        : `missing: ${unguarded.join(', ')}`,
    );
  } finally {
    await sql.end();
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.map((f) => f.id).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} database checks passed.`);
  }
}

main().catch((error) => {
  // Never echo the error message: a driver error can carry the URL.
  console.error('Database check could not run:', error?.code ?? error?.name ?? 'unknown');
  process.exitCode = 1;
});
