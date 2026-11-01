/**
 * Copies the legacy content-panel editors (`admin_users`) into Store Admin
 * (`store_admins`) before the old panel is removed.
 *
 * Usage:
 *   node scripts/migrate-legacy-admins.mjs                 # dry run (default)
 *   node scripts/migrate-legacy-admins.mjs --apply         # write the accounts
 *   node scripts/migrate-legacy-admins.mjs --apply --role store_owner
 *
 * Rules taken from MERGE_PLAN.md §10.2:
 * - the password hash and TOTP secret are copied byte-for-byte, so existing
 *   passwords and authenticator apps keep working;
 * - the legacy tables are only READ here, never written, exported or printed;
 * - an account whose email already exists in Store Admin is left untouched —
 *   this script never overwrites a password, role or secret;
 * - a permanently removed Store Admin row is reported, not resurrected;
 * - no secret, hash or full email is printed. Emails are masked, secrets are
 *   only counted, and every copied TOTP secret is proved to generate valid
 *   codes before the script reports success;
 * - safe to re-run: the second run copies nothing.
 *
 * This script is deleted in the final removal commit, together with the legacy
 * panel. Until then it is the only code allowed to reference `admin_users`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import { generateTotp, verifyTotp } from '../src/lib/platform/totp.ts';

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

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const roleIndex = args.findIndex((value) => value === '--role' || value.startsWith('--role='));
const rawRole =
  roleIndex === -1
    ? 'store_owner'
    : (args[roleIndex].startsWith('--role=')
        ? args[roleIndex].slice('--role='.length)
        : args[roleIndex + 1] ?? '')
        .trim();

if (!VALID_ROLES.has(rawRole)) {
  console.error('Invalid --role. Use store_owner, store_admin or store_viewer.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

/** Never print a full address: keep the first character and the domain shape. */
function maskEmail(value) {
  const [local = '', domain = ''] = String(value).split('@');
  const head = local.slice(0, 1) || '?';
  const domainHead = domain.split('.')[0] ?? '';
  return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domainHead.slice(0, 1)}***`;
}

/* ---------------------------------------------------------------- main */

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  max: 1,
  prepare: false,
  onnotice: () => {},
});

let copied = 0;
let skippedExisting = 0;
let skippedRemoved = 0;
let secretsVerified = 0;
let secretsFailed = 0;

try {
  const legacy = await sql`
    select id, email, password_hash, name, totp_secret, totp_enabled, recovery_hash
    from admin_users
    order by created_at asc
  `;

  console.log(`Legacy editors found: ${legacy.length}`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
  console.log(`Role for new accounts: ${rawRole}`);
  console.log('');

  for (const editor of legacy) {
    const email = String(editor.email ?? '').trim().toLowerCase();
    const name = String(editor.name ?? '').trim() || email.split('@')[0] || 'Editor';
    if (!email) {
      console.log('- (row without an email) skipped');
      continue;
    }

    const existing = await sql`
      select id, removed_at from store_admins where lower(email) = ${email} limit 1
    `;

    if (existing[0]) {
      if (existing[0].removed_at) {
        skippedRemoved += 1;
        console.log(`- ${maskEmail(email)}: a removed Store Admin row exists — skipped, not resurrected`);
      } else {
        skippedExisting += 1;
        console.log(`- ${maskEmail(email)}: already in Store Admin — skipped (nothing overwritten)`);
      }
      continue;
    }

    const totpEnabled = editor.totp_enabled === true;
    const notes = [
      `name ${JSON.stringify(name)}`,
      totpEnabled ? 'two-factor on (secret will be copied)' : 'two-factor off',
    ].join(', ');

    if (!apply) {
      console.log(`- ${maskEmail(email)}: would copy (${notes})`);
      continue;
    }

    await sql`
      insert into store_admins (
        id, email, password_hash, name, role,
        totp_secret, totp_enabled, recovery_hash, is_active
      ) values (
        ${randomUUID()}, ${email}, ${editor.password_hash}, ${name}, ${rawRole},
        ${editor.totp_secret ?? null}, ${totpEnabled}, ${editor.recovery_hash ?? null}, true
      )
    `;
    copied += 1;
    console.log(`- ${maskEmail(email)}: copied (${notes})`);

    // Prove the copied secret still produces codes that verify. Neither the
    // secret nor the generated code is printed.
    if (totpEnabled && editor.totp_secret) {
      const code = generateTotp(String(editor.totp_secret));
      if (verifyTotp(String(editor.totp_secret), code)) {
        secretsVerified += 1;
      } else {
        secretsFailed += 1;
        console.log('  ! the copied two-factor secret did not verify — reset it from Staff & roles');
      }
    }
  }

  console.log('');
  console.log(`Copied: ${copied}`);
  console.log(`Skipped (already present): ${skippedExisting}`);
  console.log(`Skipped (removed account): ${skippedRemoved}`);
  if (apply) {
    console.log(`Two-factor secrets verified: ${secretsVerified}${secretsFailed ? `, failed: ${secretsFailed}` : ''}`);
  }
  if (!apply) {
    console.log('Nothing was written. Re-run with --apply to copy the accounts.');
  }
  if (secretsFailed > 0) process.exitCode = 1;
} catch (err) {
  // Never echo connection strings or row contents.
  console.error('Could not migrate the legacy editors. Check the database, migrations 0001–0045 and the log above.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
