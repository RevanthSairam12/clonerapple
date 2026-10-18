/**
 * READ-ONLY audit helper.
 *
 * Reports whether the CMS/settings rows that can override the de-Apple'd source
 * defaults actually exist in the database. Performs SELECTs only — it issues no
 * INSERT/UPDATE/DELETE and never touches row contents beyond listing keys and
 * flagging which ones still contain the word "Apple".
 *
 * Usage: node scripts/inspect-apple-keys.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

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

// Refuse to run if any sql`...` query in this file grows a write statement.
// Scan only the tagged-template bodies — scanning the whole file matched the
// WRITE regex source itself (the words appear inside the regex literal).
const WRITE = /\b(insert|update|delete|drop|truncate|alter|create)\b/i;
const self = await readFile(new URL(import.meta.url), 'utf8');
const queries = [...self.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]);
if (queries.some((q) => WRITE.test(q))) {
  console.error('Refusing to run: this script must stay read-only.');
  process.exit(1);
}

const containsApple = (v) => JSON.stringify(v ?? '').toLowerCase().includes('apple');

console.log('=== content_blocks ===');
const blocks = await sql`
  SELECT key, value, updated_at
  FROM content_blocks
  ORDER BY key
`;
if (blocks.length === 0) {
  console.log('(table empty — code defaults are live)');
}
for (const row of blocks) {
  const flag = containsApple(row.value) ? '  <-- CONTAINS "apple"' : '';
  console.log(`  ${row.key.padEnd(28)} updated ${row.updated_at.toISOString()}${flag}`);
}

console.log('\n=== site_settings ===');
const settings = await sql`
  SELECT key, value, updated_at
  FROM site_settings
  ORDER BY key
`;
if (settings.length === 0) {
  console.log('(table empty — code defaults are live)');
}
for (const row of settings) {
  const flag = containsApple(row.value) ? '  <-- CONTAINS "apple"' : '';
  const preview =
    row.key === 'appleCopyright' || row.key.includes('copyright') || row.value.length < 80
      ? ` = ${JSON.stringify(row.value)}`
      : '';
  console.log(`  ${row.key.padEnd(28)}${preview}${flag}`);
}

await sql.end();
