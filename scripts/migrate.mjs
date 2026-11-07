/**
 * Applies every SQL file in ./migrations in filename order (additive only).
 * Usage: node scripts/migrate.mjs   (requires DATABASE_URL in .env.local)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

// minimal .env.local loader (the repo has no dotenv dependency)
const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // no .env.local — DATABASE_MIGRATION_URL or DATABASE_URL must come from the real environment
}

const connectionUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
if (!connectionUrl) {
  console.error('Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set. Add it to .env.local and retry.');
  process.exit(1);
}
if (new URL(connectionUrl).port === '6543') {
  console.error(
    'Refusing port 6543 (transaction pooler): migrations require a session connection on port 5432 (session pooler or direct connection). Set DATABASE_MIGRATION_URL to a port 5432 URL.',
  );
  process.exit(1);
}

const sql = postgres(connectionUrl, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 1800,
  prepare: false,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

const dir = path.resolve(process.cwd(), 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

// Guard against destructive statements — this project only allows additive migrations.
// ("drop policy if exists" in 0002 is allowed: it recreates the same policy
// on the next line and touches no data. Likewise "drop constraint": 0005
// swaps the admin_sessions primary key to token_hash — no data is touched.)
const FORBIDDEN =
  /\b(drop\s+(table|column|database)|truncate|alter\s+table\s+\w+\s+drop\s+(?!constraint\b|policy\b))\b/i;

// Track applied migrations so re-running is a no-op for old files.
// SECURITY (L-1): the table is internal. RLS with no policies plus no grants
// for the Supabase API roles keeps the migration ledger off PostgREST; the
// runner connects as the table owner and is unaffected. The role guards keep
// a plain local Postgres (no anon/authenticated) working.
await sql.unsafe(`
  create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );
  alter table schema_migrations enable row level security;
  do $$
  begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on schema_migrations from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on schema_migrations from authenticated';
    end if;
  end $$;
`);
const applied = new Set(
  (await sql`select filename from schema_migrations`).map((r) => r.filename),
);

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skipping ${file} (already applied)`);
    continue;
  }
  const raw = await readFile(path.join(dir, file), 'utf8');
  if (FORBIDDEN.test(raw)) {
    console.error(`Refusing to run ${file}: contains a destructive statement.`);
    process.exit(1);
  }
  console.log(`applying ${file} ...`);
  await sql.unsafe(raw);
  await sql`insert into schema_migrations (filename) values (${file})`;
  console.log(`  done`);
}

await sql.end();
console.log('migrations complete.');
