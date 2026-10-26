import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  CAPABILITY_MATRIX,
  checkStaffChange,
  hasCapability,
  validateNewPassword,
  validateNewStaff,
  validateStaffProfile,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'staff-rules.ts'),
);

test('a new staff member needs a name, a valid email and a role', () => {
  const ok = validateNewStaff({
    name: 'Asha',
    email: 'ASHA@Example.test',
    phone: '+91 90000 00000',
    role: 'store_admin',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.email, 'asha@example.test');
  assert.equal(ok.value.password, '');
});

test('an empty password means the server generates one', () => {
  const result = validateNewStaff({
    name: 'Asha',
    email: 'asha@example.test',
    role: 'store_viewer',
    password: '',
  });
  assert.equal(result.ok, true);
});

test('a supplied password must pass the shared policy', () => {
  const short = validateNewStaff({
    name: 'Asha',
    email: 'asha@example.test',
    role: 'store_viewer',
    password: 'short',
  });
  assert.equal(short.ok, false);

  const good = validateNewStaff({
    name: 'Asha',
    email: 'asha@example.test',
    role: 'store_viewer',
    password: 'long-enough-1',
  });
  assert.equal(good.ok, true);
});

test('invalid roles, emails and phones are refused', () => {
  assert.equal(validateNewStaff({ name: 'A', email: 'a@b.co', role: 'root' }).ok, false);
  assert.equal(validateNewStaff({ name: 'A', email: 'nope', role: 'store_admin' }).ok, false);
  assert.equal(
    validateNewStaff({ name: 'A', email: 'a@b.co', role: 'store_admin', phone: 'call me' }).ok,
    false,
  );
  assert.equal(validateNewStaff({ name: '', email: 'a@b.co', role: 'store_admin' }).ok, false);
});

test('a profile update keeps the same phone rules', () => {
  assert.equal(validateStaffProfile({ name: 'Asha', phone: '9000000000' }).ok, true);
  assert.equal(validateStaffProfile({ name: 'Asha', phone: 'bad!' }).ok, false);
  assert.equal(validateStaffProfile({ name: '', phone: '' }).ok, false);
});

test('a new password is checked by the shared policy', () => {
  assert.equal(validateNewPassword('short').ok, false);
  assert.equal(validateNewPassword('this-is-long-enough').ok, true);
});

test('nobody may change their own role or deactivate themselves', () => {
  const base = {
    actorId: 'a1',
    targetId: 'a1',
    targetRole: 'store_owner',
    targetActive: true,
    activeOwners: 2,
  };
  assert.equal(checkStaffChange({ ...base, nextRole: 'store_admin' }).ok, false);
  assert.equal(checkStaffChange({ ...base, nextActive: false }).ok, false);
  assert.equal(checkStaffChange({ ...base, nextActive: true }).ok, true);
});

test('the last active owner cannot be demoted or removed', () => {
  const base = {
    actorId: 'a2',
    targetId: 'a1',
    targetRole: 'store_owner',
    targetActive: true,
    activeOwners: 1,
  };
  assert.equal(checkStaffChange({ ...base, nextRole: 'store_admin' }).ok, false);
  assert.equal(checkStaffChange({ ...base, nextActive: false }).ok, false);
  // Renaming or touching nothing is fine.
  assert.equal(checkStaffChange({ ...base }).ok, true);
});

test('an owner can be demoted while another active owner remains', () => {
  assert.equal(
    checkStaffChange({
      actorId: 'a2',
      targetId: 'a1',
      targetRole: 'store_owner',
      targetActive: true,
      activeOwners: 2,
      nextRole: 'store_admin',
    }).ok,
    true,
  );
});

test('the capability matrix is ordered owner ⊇ admin ⊇ viewer', () => {
  for (const row of CAPABILITY_MATRIX) {
    // A capability a viewer has must also belong to admin and owner.
    if (row.viewer) {
      assert.equal(row.admin, true, row.capability);
      assert.equal(row.owner, true, row.capability);
    }
    // Admin capabilities are always included in owner.
    if (row.admin) assert.equal(row.owner, true, row.capability);
  }
  assert.equal(hasCapability('store_viewer', 'overview.view'), true);
  assert.equal(hasCapability('store_viewer', 'settings.edit'), false);
  assert.equal(hasCapability('store_admin', 'settings.edit'), true);
  assert.equal(hasCapability('store_admin', 'staff.edit'), false);
  assert.equal(hasCapability('store_owner', 'staff.edit'), true);
  assert.equal(hasCapability('store_owner', 'not.a.capability'), false);
});
