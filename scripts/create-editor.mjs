/**
 * Creates or updates an editor account for the admin panel.
 * Usage: node scripts/create-editor.mjs <email> <password> [name]
 * Requires DATABASE_URL in .env.local and migrations applied first.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // no .env.local
}

const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-editor.mjs <email> <password> [name]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

const hash = await bcrypt.hash(password, 10);

const existing = await sql`select id from admin_users where email = ${email}`;
if (existing.length > 0) {
  await sql`update admin_users set password_hash = ${hash}, name = ${name || ''} where email = ${email}`;
  console.log(`Updated editor ${email}.`);
} else {
  await sql`insert into admin_users (id, email, password_hash, name) values (${randomUUID()}, ${email}, ${hash}, ${name || ''})`;
  console.log(`Created editor ${email}.`);
}

await sql.end();
