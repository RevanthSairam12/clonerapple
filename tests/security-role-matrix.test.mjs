/**
 * Role matrix for the sensitive store-admin routes: which of viewer, admin and
 * owner may call each one.
 *
 * `check-store-admin-routes.mjs` proves a route calls `requireStoreRole(...)`,
 * not which role it asks for. This test pins the role for the routes that carry
 * customer data, money, mail settings and staff management, using the same
 * `roleSatisfies()` decision the guard makes at runtime.
 *
 * The source-level half asserts the literal passed in the route; the semantic
 * half asserts what that literal means for each role.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const API = path.join(root, 'src', 'app', 'api', 'store-admin');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { roleSatisfies } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'auth.ts'),
);

const ROLES = ['store_viewer', 'store_admin', 'store_owner'];

/**
 * Route file -> the role its guard must name. `null` means the handler chooses
 * between two roles from the request (the shared-list settings kind).
 */
const SENSITIVE_ROUTES = {
  // Who may see or change a customer, and whose addresses are revealed.
  'customers/[id]/route.ts': 'store_admin',
  'customers/[id]/reveal/route.ts': 'store_owner',
  'customers/[id]/anonymise/route.ts': 'store_owner',
  'customers/[id]/status/route.ts': 'store_admin',
  'customers/export/route.ts': 'store_viewer',
  // Where the server's SMTP password is sent.
  'settings/notifications/route.ts': 'store_owner',
  'settings/notifications/retry/route.ts': 'store_owner',
  'settings/lists/[kind]/route.ts': null,
  // The general settings write admits an admin; `mail_*` stays owner-only
  // inside `updateStoreSettings` (asserted by the mail_* test below).
  'settings/route.ts': 'store_admin',
  // Money.
  'orders/[txnid]/reveal/route.ts': 'store_owner',
  'orders/[txnid]/void/route.ts': 'store_owner',
  'orders/[txnid]/refund/route.ts': 'store_admin',
  'expenses/route.ts': 'store_admin',
  'media/route.ts': 'store_admin',
  'media/[id]/route.ts': 'store_admin',
  // Staff identity and the audit trail.
  'staff/[id]/route.ts': 'store_owner',
  'staff/[id]/sessions/route.ts': 'store_owner',
  'staff/[id]/password/route.ts': 'store_owner',
  'audit/route.ts': 'store_admin',
  'subscribers/export/route.ts': 'store_owner',
  'website/theme/route.ts': 'store_owner',
};

const sourceOf = (route) => readFile(path.join(API, route), 'utf8');

const literals = (source) =>
  [...source.matchAll(/requireStoreRole\s*\(\s*'([^']+)'/g)].map((match) => match[1]);

/** Each exported handler with its body, so a GET may stay open while a write does not. */
function handlers(source) {
  const starts = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)];
  return starts.map((match, index) => ({
    method: match[1],
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

test('owner ⊇ admin ⊇ viewer, and no requirement admits an outsider', () => {
  assert.equal(roleSatisfies('store_owner', ['store_owner']), true);
  assert.equal(roleSatisfies('store_owner', ['store_admin']), true);
  assert.equal(roleSatisfies('store_owner', ['store_viewer']), true);

  assert.equal(roleSatisfies('store_admin', ['store_owner']), false);
  assert.equal(roleSatisfies('store_admin', ['store_admin']), true);
  assert.equal(roleSatisfies('store_admin', ['store_viewer']), true);

  assert.equal(roleSatisfies('store_viewer', ['store_owner']), false);
  assert.equal(roleSatisfies('store_viewer', ['store_admin']), false);
  assert.equal(roleSatisfies('store_viewer', ['store_viewer']), true);
});

test('every sensitive route names the expected role', async () => {
  for (const [route, expected] of Object.entries(SENSITIVE_ROUTES)) {
    const source = await sourceOf(route);
    const found = literals(source);

    if (expected === null) {
      // settings/lists/[kind]: writes are owner-only for template kinds and
      // admin otherwise; the GET stays viewer-readable.
      assert.ok(found.includes('store_viewer'), `${route}: the GET stays readable`);
      assert.match(source, /OWNER_ONLY_LIST_KINDS\.has\(kind\) \? 'store_owner' : 'store_admin'/, route);
      continue;
    }

    assert.ok(found.includes(expected), `${route} must require ${expected}, found ${found.join(', ') || 'none'}`);
  }
});

test('the meaning of each requirement for each role', () => {
  const matrix = {
    'customers/[id]/route.ts': { store_viewer: false, store_admin: true, store_owner: true },
    'customers/[id]/reveal/route.ts': { store_viewer: false, store_admin: false, store_owner: true },
    'settings/notifications/route.ts': { store_viewer: false, store_admin: false, store_owner: true },
    'orders/[txnid]/void/route.ts': { store_viewer: false, store_admin: false, store_owner: true },
    'expenses/route.ts': { store_viewer: false, store_admin: true, store_owner: true },
    'media/route.ts': { store_viewer: false, store_admin: true, store_owner: true },
    'staff/[id]/route.ts': { store_viewer: false, store_admin: false, store_owner: true },
    'settings/route.ts': { store_viewer: false, store_admin: true, store_owner: true },
  };

  for (const [route, expected] of Object.entries(matrix)) {
    const required = SENSITIVE_ROUTES[route];
    assert.ok(required, `${route} must be declared above`);
    for (const role of ROLES) {
      assert.equal(
        roleSatisfies(role, [required]),
        expected[role],
        `${route}: ${role}`,
      );
    }
  }
});

test('mail_* settings are owner-only through the settings write', async () => {
  const source = await sourceOf('settings/route.ts');

  // The route admits an admin, then hands the write the owner flag.
  assert.match(source, /requireStoreRole\('store_admin'\)/);
  assert.match(source, /guard\.session\.role === 'store_owner'/);
  assert.match(
    source,
    /updateStoreSettings\(\s*values,\s*guard\.session\.adminId,\s*guard\.session\.role === 'store_owner'/,
    'the owner flag must reach the write as its third argument',
  );
  assert.match(source, /result\.reason === 'forbidden' \? 403/);

  const { isOwnerOnlySetting } = await jiti.import(
    path.join(root, 'src', 'lib', 'store-admin', 'settings-rules.ts'),
  );

  for (const key of [
    'mail_host',
    'mail_port',
    'mail_username',
    'mail_encryption',
    'mail_from_email',
    'mail_from_name',
  ]) {
    assert.equal(isOwnerOnlySetting(key), true, `${key} must be owner-only`);
  }
  assert.equal(
    isOwnerOnlySetting('shipping_charge_paise'),
    false,
    'operational settings stay admin-editable',
  );

  // A viewer never reaches the write; an admin reaches it but does not satisfy
  // the owner-only requirement; an owner satisfies both.
  assert.equal(roleSatisfies('store_viewer', ['store_admin']), false);
  assert.equal(roleSatisfies('store_admin', ['store_admin']), true);
  assert.equal(roleSatisfies('store_admin', ['store_owner']), false);
  assert.equal(roleSatisfies('store_owner', ['store_owner']), true);

  const settingsSource = await readFile(
    path.join(root, 'src', 'lib', 'store-admin', 'settings.ts'),
    'utf8',
  );
  assert.match(settingsSource, /if \(isOwnerOnlySetting\(item\.key\) && !canEditOwnerOnly\)/);
  assert.match(settingsSource, /reason: 'forbidden'/);
});

test('no mutating sensitive handler is left open to any signed-in staff member', async () => {
  for (const route of Object.keys(SENSITIVE_ROUTES)) {
    const source = await sourceOf(route);
    // Read-only routes (the customer detail and export, the audit list) have
    // no write handler; their GET guard is asserted by the previous test.
    const writes = handlers(source).filter((handler) => handler.method !== 'GET');

    for (const handler of writes) {
      // A bare `requireStoreRole()` admits every role, including a viewer.
      const call = handler.body.match(/requireStoreRole\s*\(\s*([^)]*)/);
      assert.ok(call, `${route} ${handler.method} must call requireStoreRole`);
      assert.notEqual(call[1].trim(), '', `${route} ${handler.method}: a bare requireStoreRole() admits every staff role`);
      assert.ok(
        call[1].includes("'store_") || call[1].includes('OWNER_ONLY_LIST_KINDS'),
        `${route} ${handler.method}: unexpected requirement ${call[1]}`,
      );
    }
  }
});
