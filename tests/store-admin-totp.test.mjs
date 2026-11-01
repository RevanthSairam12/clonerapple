import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  compareRecoveryCode,
  generateTotp,
  hashRecoveryCode,
  newRecoveryCode,
  newTotpSecret,
  totpUrl,
  verifyTotp,
  verifyTotpStep,
} from '../src/lib/platform/totp.ts';
import { canEditWebsite, WEBSITE_EDIT_ROLES } from '../src/lib/website/permissions.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ------------------------------------------------------------- TOTP codes */

test('totp: a generated code verifies against its own secret', () => {
  const secret = newTotpSecret();
  assert.equal(verifyTotp(secret, generateTotp(secret)), true);
});

test('totp: a code from another secret is rejected', () => {
  const secret = newTotpSecret();
  const other = newTotpSecret();
  assert.equal(verifyTotp(secret, generateTotp(other)), false);
});

test('totp: malformed codes are rejected without throwing', () => {
  const secret = newTotpSecret();
  for (const code of ['', '12345', '1234567', 'abcdef', ' 123456 ']) {
    assert.equal(verifyTotpStep(secret, code), null, `code ${JSON.stringify(code)}`);
  }
});

test('totp: verification returns the matched absolute time step, usable for replay checks', () => {
  const secret = newTotpSecret();
  const step = verifyTotpStep(secret, generateTotp(secret));
  assert.ok(Number.isInteger(step) && step > 0);
  // The database guard is `totp_last_step < step`; the same step must not pass twice.
  assert.equal(step < step, false);
});

test('totp: the otpauth URL carries the issuer and account but not the raw code', () => {
  const secret = newTotpSecret();
  const url = totpUrl('owner@example.test', secret);
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.ok(url.includes('Gadzio%20Admin') || url.includes('Gadzio Admin'));
  assert.ok(url.includes(encodeURIComponent('owner@example.test')));
  assert.ok(url.includes(secret));
});

/* --------------------------------------------------------- backup codes */

test('backup: generated codes are unique, grouped and long enough', () => {
  const codes = new Set(Array.from({ length: 50 }, () => newRecoveryCode()));
  assert.equal(codes.size, 50);
  for (const code of codes) {
    assert.match(code, /^[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}$/);
  }
});

test('backup: a hashed code compares true once and false for any other value', async () => {
  const code = newRecoveryCode();
  const hash = await hashRecoveryCode(code);
  assert.equal(await compareRecoveryCode(hash, code), true);
  assert.equal(await compareRecoveryCode(hash, code.toLowerCase()), true);
  assert.equal(await compareRecoveryCode(hash, newRecoveryCode()), false);
});

/* ------------------------------------------------------------ migration */

test('migration 0045 is additive, adds RLS and never drops anything', async () => {
  const sql = await readFile(
    path.join(ROOT, 'migrations', '0045_store_admin_totp.sql'),
    'utf8',
  );
  const body = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

  assert.match(body, /create table if not exists store_admin_recovery_codes/i);
  assert.match(body, /references store_admins\(id\) on delete cascade/i);
  assert.match(body, /alter table store_admin_recovery_codes enable row level security/i);
  assert.match(body, /add column if not exists totp_last_step/i);
  assert.doesNotMatch(body, /\bdrop\s+(table|column|database)\b/i);
  assert.doesNotMatch(body, /\btruncate\b/i);
  assert.doesNotMatch(body, /\bdelete\s+from\b/i);
});

/* --------------------------------------------------- routes and audit rows */

const TOTP_ROUTES = [
  'src/app/api/store-admin/profile/totp/setup/route.ts',
  'src/app/api/store-admin/profile/totp/enable/route.ts',
  'src/app/api/store-admin/profile/totp/disable/route.ts',
  'src/app/api/store-admin/staff/[id]/totp/reset/route.ts',
];

test('totp routes: every one is guarded and same-origin', async () => {
  for (const rel of TOTP_ROUTES) {
    const source = await readFile(path.join(ROOT, rel), 'utf8');
    assert.match(source, /\brequireStoreRole\s*\(/, `${rel} must call requireStoreRole`);
    assert.match(source, /\bassertSameOrigin\s*\(/, `${rel} must call assertSameOrigin`);
    assert.match(source, /Cache-Control': 'no-store'|Cache-Control": "no-store/, `${rel} must not cache`);
  }
});

test('totp routes: the owner reset is the only one gated to store_owner', async () => {
  const reset = await readFile(
    path.join(ROOT, 'src/app/api/store-admin/staff/[id]/totp/reset/route.ts'),
    'utf8',
  );
  assert.match(reset, /requireStoreRole\s*\(\s*'store_owner'\s*\)/);

  const selfServe = [
    'src/app/api/store-admin/profile/totp/setup/route.ts',
    'src/app/api/store-admin/profile/totp/enable/route.ts',
  ];
  for (const rel of selfServe) {
    const source = await readFile(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(source, /requireStoreRole\s*\(\s*'store_owner'\s*\)/);
  }
});

test('totp routes: no audit row can carry a secret, code or backup code', async () => {
  const forbidden = /\b(secret|qr|otpauthUrl|backupCodes|password|code)\s*:/;
  for (const rel of TOTP_ROUTES) {
    const source = await readFile(path.join(ROOT, rel), 'utf8');
    const auditBlocks = source.match(/writeAudit\(\{[\s\S]*?\}\);/g) ?? [];
    assert.ok(auditBlocks.length > 0, `${rel} must write an audit row`);
    for (const block of auditBlocks) {
      assert.doesNotMatch(block, forbidden, `${rel} audit row must not contain secrets`);
    }
  }
});

/* ------------------------------------------------------------- permissions */

test('website edits are owner-only', () => {
  assert.deepEqual([...WEBSITE_EDIT_ROLES], ['store_owner']);
  assert.equal(canEditWebsite('store_owner'), true);
  assert.equal(canEditWebsite('store_admin'), false);
  assert.equal(canEditWebsite('store_viewer'), false);
  assert.equal(canEditWebsite(null), false);
});
