import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);
function loadAuth({ account = null, session = null, issuanceAllowed = true } = {}) {
  const calls = [];
  const tx = async (parts) => {
    const query = parts.join('?');
    calls.push(query);
    if (query.includes('select id from store_admins')) return issuanceAllowed ? [{ id: 'staff' }] : [];
    return [];
  };
  const sql = async (parts) => {
    const query = parts.join('?');
    calls.push(query);
    if (query.includes('select now()')) return [{ now: new Date('2026-10-31T00:00:00Z') }];
    if (query.includes('join store_admins')) return session ? [session] : [];
    if (query.includes('from store_admins')) return account ? [account] : [];
    return [];
  };
  sql.begin = (callback) => callback(tx);
  const module = { exports: {} };
  const source = readFileSync('src/lib/store-admin/auth.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, console, process,
    require(name) {
      if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'fixture-token' }) }) };
      if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
      if (name === 'next/navigation') return { redirect: (url) => { throw new Error(`redirect:${url}`); } };
      if (name === '@/lib/platform/client-ip') return { clientIp: async () => 'fixture-ip' };
      if (name === '@/lib/platform/db') return { getSql: () => sql };
      if (name === '@/lib/platform/totp') return { verifyTotp: () => false };
      if (name === '@/lib/store-admin/totp') return { verifySecondFactor: async () => false };
      return nativeRequire(name);
    },
  });
  return { auth: module.exports, calls };
}

const session = { id: 'staff', email: 'staff@example.test', name: 'Staff', role: 'store_viewer', must_change_password: true };
test('API guards reject revoked sessions, force password changes and deny non-owner removal', async () => {
  const revoked = await loadAuth().auth.requireStoreRole();
  assert.equal(revoked.response.status, 401);
  assert.equal(revoked.response.body.redirect, '/store-admin/login?reason=account-unavailable');
  const forced = loadAuth({ session }).auth;
  const denied = await forced.requireStoreRole();
  assert.equal(denied.response.status, 403);
  assert.equal(denied.response.body.code, 'password_change_required');
  assert.equal((await forced.requireStoreRole({ allowPasswordChange: true })).ok, true);
  await assert.rejects(forced.getStoreSession(), /redirect:\/store-admin\/change-password/);
  const viewer = loadAuth({ session: { ...session, must_change_password: false } }).auth;
  assert.equal((await viewer.requireStoreRole('store_owner')).response.status, 403);
});

test('login rejects removed accounts and cannot issue a session after concurrent removal or reset', async () => {
  const missing = loadAuth();
  assert.equal((await missing.auth.login('removed@example.test', 'temporary-123')).ok, false);
  assert.equal(missing.calls.some(query => query.includes('insert into store_admin_sessions')), false);
  const account = { ...session, is_active: true, password_hash: await bcrypt.hash('temporary-123', 4) };
  const raced = loadAuth({ account, issuanceAllowed: false });
  assert.equal((await raced.auth.login(session.email, 'temporary-123')).ok, false);
  assert.equal(raced.calls.some(query => query.includes('insert into store_admin_sessions')), false);
  const successful = loadAuth({ account });
  assert.equal((await successful.auth.login(session.email, 'temporary-123')).ok, true);
  assert.ok(successful.calls.some(query => /password_hash = .*for update/s.test(query)));
  assert.ok(successful.calls.some(query => query.includes("now() + interval '7 days'")));
});
