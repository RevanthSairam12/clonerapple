import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const source = (name) => readFileSync(path.resolve(name), 'utf8');

test('live token checks use active, nonremoved accounts and database expiry', async () => {
  const { getStoreSessionForToken } = await jiti.import('../src/lib/store-admin/auth.ts');
  const oldUrl = process.env.DATABASE_URL;
  const oldSql = globalThis.__gadzioSql;
  process.env.DATABASE_URL ||= 'postgres://fixture.invalid/test';
  try {
    let query = '';
    let rows = [{ id: 'staff1', email: 'staff@example.test', name: 'Staff', role: 'store_viewer', must_change_password: true }];
    globalThis.__gadzioSql = async (parts) => { query = parts.join('?'); return rows; };
    const session = await getStoreSessionForToken('opaque-token');
    assert.equal(session.adminId, 'staff1');
    assert.equal(session.mustChangePassword, true);
    assert.match(query, /expires_at > now\(\)/);
    assert.match(query, /a\.is_active and a\.removed_at is null/);
    rows = [];
    assert.equal(await getStoreSessionForToken('revoked-token'), null);
  } finally {
    globalThis.__gadzioSql = oldSql;
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
  }
});

test('password exceptions are limited to password change, session check and logout APIs', () => {
  const root = 'src/app/api/store-admin/';
  for (const file of ['profile/password/route.ts', 'auth/session/route.ts', 'auth/logout/route.ts']) {
    assert.match(source(root + file), /requireStoreRole\(\{ allowPasswordChange: true \}\)/);
  }
  const auth = source('src/lib/store-admin/auth.ts');
  assert.match(auth, /session\.mustChangePassword && !allowPasswordChange/);
  assert.match(auth, /password_change_required/);
  assert.doesNotMatch(auth, /Date\.now\(/);
  assert.match(source('src/proxy.ts'), /session\.mustChangePassword && pathname !== '\/store-admin\/change-password'/);
});

test('open pages check immediately, every thirty seconds and on focus or visibility', () => {
  const monitor = source('src/components/store-admin/StoreSessionMonitor.tsx');
  assert.match(monitor, /setInterval\(check, 30_000\)/);
  assert.match(monitor, /addEventListener\('focus', check\)/);
  assert.match(monitor, /visibilitychange/);
  assert.match(monitor, /cache: 'no-store'/);
  assert.match(monitor, /response\.status === 401/);
  assert.match(monitor, /session\.role !== role/);
  assert.match(monitor, /void check\(\)/);
  assert.match(source('src/app/(store-admin)/store-admin/login/page.tsx'), /Your account was removed or deactivated\. Contact the store owner\./);
});
