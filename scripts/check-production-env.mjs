/**
 * Production & staging environment safety verification CLI.
 *
 * Reads environment variables (and optionally .env.local unless --no-dotenv is
 * passed) plus read-only `store_settings.mail_status` when DATABASE_URL is
 * available, and verifies every safety rule in `checkProductionEnv()`.
 *
 * Usage:
 *   npm run check:production-env
 *   node scripts/check-production-env.mjs [--no-dotenv] [--offline] [--mail-on | --mail-off]
 *
 * Never prints secret values, URLs, or connection strings — names, counts, and
 * lengths only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const noDotenv = args.has('--no-dotenv');
const offline = args.has('--offline');

if (!noDotenv) {
  try {
    const content = readFileSync(path.join(root, '.env.local'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env.local present; use process environment only.
  }
}

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { checkProductionEnv } = await jiti.import(
  path.join(root, 'src', 'lib', 'platform', 'production-env.ts'),
);

let mailOn = false;
let mailStatusSource = 'default(off)';

if (args.has('--mail-on')) {
  mailOn = true;
  mailStatusSource = 'flag(--mail-on)';
} else if (args.has('--mail-off')) {
  mailOn = false;
  mailStatusSource = 'flag(--mail-off)';
} else if (!offline && (process.env.DATABASE_URL ?? '').trim().length > 0) {
  const dbUrl = (process.env.DATABASE_URL ?? '').trim();
  const sql = postgres(dbUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 2,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: { default_transaction_read_only: 'on' },
    onnotice: () => {},
  });
  try {
    const rows = await sql`
      select value from store_settings where key = 'mail_status' limit 1
    `;
    mailOn = String(rows[0]?.value ?? '') === 'on';
    mailStatusSource = 'database(store_settings.mail_status)';
  } catch {
    // Fall back safely if store_settings is not readable; if MAIL_PASSWORD is
    // configured, conservatively enforce MAIL_ALLOWED_HOSTS too.
    mailOn = (process.env.MAIL_PASSWORD ?? '').trim().length > 0;
    mailStatusSource = 'fallback(MAIL_PASSWORD presence)';
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

const result = checkProductionEnv(process.env, { mailOn });

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      appEnv: result.appEnv,
      onVercel: result.onVercel,
      mailOn: result.mailOn,
      mailStatusSource,
      issueCount: result.issues.length,
      issues: result.issues,
    },
    null,
    2,
  ),
);

if (!result.ok) {
  process.exitCode = 1;
}

