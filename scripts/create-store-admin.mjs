/**
 * Creates or updates a store admin account.
 *
 * Usage:
 *   node scripts/create-store-admin.mjs --email <email> [--role store_admin] [--name "Name"]
 *
 * The password is NEVER taken from argv (argv leaks into shell history and the
 * process list). It is read from STORE_ADMIN_PASSWORD, or prompted for with
 * echo disabled. It is never printed, logged, or written anywhere except as a
 * bcrypt hash in store_admins.
 *
 * Roles: store_owner | store_admin | store_viewer (default store_admin).
 * Requires DATABASE_URL in .env.local and migration 0010 applied first.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const VALID_ROLES = new Set(['store_owner', 'store_admin', 'store_viewer']);

/* ------------------------------------------------------------- env load */

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

/* ---------------------------------------------------------------- args */

function readFlag(name) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}`) return args[i + 1];
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return undefined;
}

const email = (readFlag('email') ?? process.env.STORE_ADMIN_EMAIL ?? '').trim().toLowerCase();
const role = (readFlag('role') ?? process.env.STORE_ADMIN_ROLE ?? 'store_admin').trim();
const name = (readFlag('name') ?? process.env.STORE_ADMIN_NAME ?? '').trim();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Missing or invalid --email.');
  console.error('Usage: node scripts/create-store-admin.mjs --email <email> [--role store_admin] [--name "Name"]');
  process.exit(1);
}
if (!VALID_ROLES.has(role)) {
  console.error('Invalid --role. Use store_owner, store_admin or store_viewer.');
  process.exit(1);
}
if (process.argv.slice(2).some((a) => a === '--password' || a.startsWith('--password='))) {
  console.error('Do not pass the password on the command line. Use STORE_ADMIN_PASSWORD or the prompt.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

/* -------------------------------------------------------------- prompt */

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      reject(new Error('No TTY for a password prompt. Set STORE_ADMIN_PASSWORD instead.'));
      return;
    }

    stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let value = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        // Characters are deliberately not echoed.
        value += ch;
      }
    };

    stdin.on('data', onData);
  });
}

async function readPassword() {
  if (process.env.STORE_ADMIN_PASSWORD !== undefined) {
    return process.env.STORE_ADMIN_PASSWORD;
  }

  const first = await promptHidden('Password: ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) throw new Error('Passwords do not match.');
  return first;
}

/* --------------------------------------------------------------- write */

let password;
try {
  password = await readPassword();
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Could not read the password.');
  process.exit(1);
}

if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

try {
  const hash = await bcrypt.hash(password, 10);

  const existing = await sql`select id from store_admins where email = ${email}`;
  if (existing.length > 0) {
    if (name) {
      await sql`
        update store_admins
        set password_hash = ${hash}, role = ${role}, name = ${name}, is_active = true
        where email = ${email}
      `;
    } else {
      await sql`
        update store_admins
        set password_hash = ${hash}, role = ${role}, is_active = true
        where email = ${email}
      `;
    }
    console.log(`Updated store admin (${role}).`);
  } else {
    await sql`
      insert into store_admins (id, email, password_hash, name, role)
      values (${randomUUID()}, ${email}, ${hash}, ${name}, ${role})
    `;
    console.log(`Created store admin (${role}).`);
  }
} catch (err) {
  // Never echo connection strings, emails or hashes.
  console.error('Could not write the store admin account. Check the database and migration 0010.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
