import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import bcrypt from 'bcryptjs';
import { createJiti } from 'jiti';

const root = new URL('../', import.meta.url);
const source = (name) => readFile(new URL(name, root), 'utf8');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': fileURLToPath(new URL('src', root)) } });
const rules = await jiti.import(fileURLToPath(new URL('src/lib/store-admin/staff-rules.ts', root)));
const passwordRules = await jiti.import(fileURLToPath(new URL('src/lib/store-admin/password-rules.ts', root)));
const { redactRemovedAuditRow } = await jiti.import(fileURLToPath(new URL('src/lib/store-admin/audit-log.ts', root)));
const base = {
  actorId: 'owner', targetId: 'staff', targetRole: 'store_admin', targetActive: true,
  activeOwners: 2, email: 'staff@example.test', typedEmail: 'staff@example.test',
};

test('removal requires exact typed email, forbids self and the last active owner', () => {
  assert.equal(rules.checkStaffRemoval(base).ok, true);
  for (const typedEmail of [undefined, null, '', 'STAFF@example.test', ' staff@example.test']) {
    assert.equal(rules.checkStaffRemoval({ ...base, typedEmail }).ok, false);
  }
  assert.equal(rules.checkStaffRemoval({ ...base, targetId: 'owner', targetActive: false }).ok, false);
  assert.equal(rules.checkStaffRemoval({ ...base, targetRole: 'store_owner', activeOwners: 1 }).ok, false);
  assert.equal(rules.checkStaffRemoval({ ...base, targetRole: 'store_owner', activeOwners: 1, targetActive: false }).ok, true);
});

async function removalHarness({ auditOk = true, typedEmail = base.typedEmail, passwordMode = false,
  currentPassword = 'old-password-123', hasSession = true, hasAccount = true } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  const tx = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ query, values });
    if (query.startsWith('select password_hash')) return hasAccount ? [{ password_hash: bcrypt.hashSync('old-password-123', 4) }] : [];
    if (query.startsWith('select 1 from store_admin_sessions')) return hasSession ? [{}] : [];
    if (query.startsWith('select id, email, role')) return [{ id: 'staff', email: base.email, role: 'store_admin', is_active: true }];
    if (query.startsWith('select count')) return [{ count: 2 }];
    if (query.startsWith('delete from store_admin_sessions')) return [{}, {}];
    return [];
  };
  const sql = {
    begin: async (callback) => {
      try { const result = await callback(tx); committed = true; return result; }
      catch (error) { rolledBack = true; throw error; }
    },
  };
  const module = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);
  const compiled = ts.transpileModule(await source('src/lib/store-admin/staff.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console: { warn() {} },
    require(name) {
      if (name === '@/lib/platform/db') return { getSql: () => sql };
      if (name === './staff-rules') return rules;
      if (name === './password-rules') return passwordRules;
      if (name === './audit') return { writeAudit: async (input, writer) => {
        assert.equal(writer, tx);
        calls.push({ audit: input });
        return auditOk;
      } };
      return nativeRequire(name);
    },
  });
  const audit = { actorId: 'owner', action: 'staff.remove', entity: 'store_admin' };
  const result = passwordMode
    ? await module.exports.changeOwnPassword({ adminId: 'staff', currentTokenHash: 'opaque-session',
      currentPassword, newPassword: 'replacement-password-456', confirmPassword: 'replacement-password-456',
      audit: { ...audit, action: 'profile.password_change' } })
    : await module.exports.removeStaff('staff', typedEmail, audit);
  return { result, calls, committed, rolledBack };
}

test('removal transaction erases identifying/account data, revokes sessions and writes a PII-free audit', async () => {
  const run = await removalHarness();
  assert.equal(run.result.ok, true);
  assert.equal(run.result.data.sessionsRevoked, 2);
  assert.equal(run.committed, true);
  const update = run.calls.find((call) => call.query?.startsWith('update store_admins'));
  assert.match(update.query, /phone = null/);
  assert.match(update.query, /totp_secret = null, totp_enabled = false, recovery_hash = null/);
  assert.match(update.query, /removed_at = clock_timestamp\(\)/);
  assert.equal(update.values[0], 'Removed staff member');
  assert.match(update.values[1], /^removed-[a-f0-9]{48}@removed\.invalid$/);
  assert.match(update.values[2], /^removed:[a-f0-9]{64}$/);
  assert.ok(run.calls.some((call) => call.query?.startsWith('delete from store_admin_preferences')));
  const audit = run.calls.find((call) => call.audit).audit;
  assert.equal(audit.entityId, 'staff');
  assert.equal(JSON.stringify(audit).includes(base.email), false);
  assert.equal(audit.after.name, 'Removed staff member');
});

test('audit failure rolls back removal; wrong confirmation performs no mutations', async () => {
  const failure = await removalHarness({ auditOk: false });
  assert.equal(failure.result.ok, false);
  assert.equal(failure.rolledBack, true);
  assert.equal(failure.committed, false);
  const mismatch = await removalHarness({ typedEmail: 'wrong@example.test' });
  assert.equal(mismatch.result.ok, false);
  assert.equal(mismatch.calls.some((call) => /^(update|delete)/.test(call.query ?? '')), false);
});

test('password change verifies bcrypt and current live session before any mutation', async () => {
  const wrong = await removalHarness({ passwordMode: true, currentPassword: 'wrong-password-123' });
  assert.equal(wrong.result.ok, false);
  assert.equal(wrong.result.error, 'Current password is incorrect');
  const expired = await removalHarness({ passwordMode: true, hasSession: false });
  assert.equal(expired.result.ok, false);
  const removed = await removalHarness({ passwordMode: true, hasAccount: false });
  assert.equal(removed.result.ok, false);
  for (const run of [wrong, expired, removed]) {
    assert.equal(run.calls.some((call) => /^(update|delete)/.test(call.query ?? '')), false);
  }
  const lockedSessionQuery = expired.calls.find((call) => call.query?.startsWith('select 1 from store_admin_sessions'));
  assert.match(lockedSessionQuery.query, /expires_at > now\(\).*for update/);
});

test('password change audits in its transaction and audit failure rolls back', async () => {
  const success = await removalHarness({ passwordMode: true });
  assert.equal(success.result.ok, true);
  assert.equal(success.committed, true);
  const update = success.calls.find((call) => call.query?.startsWith('update store_admins'));
  assert.match(update.query, /must_change_password = false/);
  assert.equal(await bcrypt.compare('replacement-password-456', update.values[0]), true);
  const revoke = success.calls.find((call) => call.query?.startsWith('delete from store_admin_sessions'));
  assert.match(revoke.query, /token_hash <>/);
  assert.equal(revoke.values.includes('opaque-session'), true);
  const failure = await removalHarness({ passwordMode: true, auditOk: false });
  assert.equal(failure.result.ok, false);
  assert.equal(failure.committed, false);
  assert.equal(failure.rolledBack, true);
});

test('audit screen and CSV projection redact removed actor and removed staff entity snapshots', () => {
  const original = {
    actorEmail: 's***@example.test', actorId: 'staff', before: { name: 'Private name' },
    after: { phone: 'private' }, reason: 'private', action: 'staff.update', entityId: 'staff',
  };
  const actor = redactRemovedAuditRow(original, true, false);
  assert.equal(actor.actorEmail, 'Removed staff member');
  assert.equal(JSON.stringify(actor).includes('Private name'), false);
  const entity = redactRemovedAuditRow(original, false, true);
  assert.equal(entity.before.name, 'Removed staff member');
  assert.equal(entity.after.name, 'Removed staff member');
  assert.equal(original.before.name, 'Private name');
  assert.equal(redactRemovedAuditRow(original, false, false), original);
});

test('route, confirmations, migration and read models enforce permanent removal boundaries', async () => {
  const route = await source('src/app/api/store-admin/staff/[id]/route.ts');
  const deletion = route.slice(route.indexOf('export async function DELETE'));
  assert.match(deletion, /assertSameOrigin\(request\)/);
  assert.match(deletion, /requireStoreRole\('store_owner'\)/);
  assert.match(deletion, /removeStaff\(id, body.email/);
  const ui = await source('src/components/store-admin/StaffManager.tsx');
  assert.match(ui, /Are you sure you want to remove \$\{member.name\}\?/);
  assert.match(ui, /This cannot be undone\. Are you absolutely sure\?/);
  assert.match(ui, /disabled=\{busy !== null \|\| removalEmail !== removal.email\}/);
  const staff = await source('src/lib/store-admin/staff.ts');
  assert.match(staff, /where a.removed_at is null/);
  assert.match(staff, /where a.id = \$\{id.trim\(\)\} and a.removed_at is null/);
  assert.match(staff, /select id from store_admins where id = \$\{id.trim\(\)\} and removed_at is null for update/);
  const audit = await source('src/lib/store-admin/audit-log.ts');
  assert.equal((audit.match(/as removed_actor/g) ?? []).length, 2);
  assert.equal((audit.match(/as removed_entity/g) ?? []).length, 2);
  const migration = await source('migrations/0043_staff_removal.sql');
  const forbidden = /\b(drop\s+(table|column|database)|truncate|alter\s+table\s+\w+\s+drop\s+(?!constraint\b|policy\b))\b/i;
  assert.equal(forbidden.test(migration), false);
  assert.match(migration, /removed_at timestamptz/);
  assert.doesNotMatch(migration, /store_admin_audit_immutable|disable trigger/i);
});
