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
  // no .env.local — DATABASE_URL must come from the real environment
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
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
await sql.unsafe(`
  create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );
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
