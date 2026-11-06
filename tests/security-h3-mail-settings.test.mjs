/**
 * SECURITY (H-3): SMTP settings were editable by a store admin, and
 * `smtpOptions` sent `MAIL_PASSWORD` to whatever host was configured. An admin
 * could point `mail_host` at a server they control and capture the password.
 *
 * The `mail_*` group is owner-only, plaintext encryption is development-only,
 * and the password is withheld from hosts outside `MAIL_ALLOWED_HOSTS`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  DEFAULT_SETTINGS,
  isOwnerOnlySetting,
  mailEncryptionAllowed,
  validateSettingValue,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'settings-rules.ts'));
const { mailConfigProblem, mailHostAllowed, smtpOptions } = await jiti.import(
  path.join(root, 'src', 'lib', 'notifications', 'providers.ts'),
);

const SMTP = {
  ...DEFAULT_SETTINGS,
  mail_driver: 'smtp',
  mail_status: 'on',
  mail_host: 'smtp.example.test',
  mail_port: '587',
  mail_username: 'mailer',
  mail_encryption: 'tls',
  mail_from_email: 'shop@example.test',
  mail_from_name: 'Test Store',
};

const ENV = { NODE_ENV: 'production', MAIL_PASSWORD: 'smtp-secret' };

test('every mail setting is owner-only', () => {
  for (const key of [
    'mail_driver',
    'mail_status',
    'mail_host',
    'mail_port',
    'mail_username',
    'mail_encryption',
    'mail_from_email',
    'mail_from_name',
  ]) {
    assert.equal(isOwnerOnlySetting(key), true, `${key} must be owner-only`);
  }
  assert.equal(isOwnerOnlySetting('maintenance_mode'), true);
  assert.equal(isOwnerOnlySetting('shipping_charge_paise'), false);
});

test('plaintext SMTP encryption is refused outside development', () => {
  assert.equal(mailEncryptionAllowed('none', { NODE_ENV: 'production' }), false);
  assert.equal(mailEncryptionAllowed('none', {}), false);
  assert.equal(mailEncryptionAllowed('none', { NODE_ENV: 'development' }), true);
  assert.equal(mailEncryptionAllowed('tls', { NODE_ENV: 'production' }), true);
  assert.equal(mailEncryptionAllowed('ssl', { NODE_ENV: 'production' }), true);

  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(validateSettingValue('mail_encryption', 'none').ok, false);
    process.env.NODE_ENV = 'development';
    assert.deepEqual(validateSettingValue('mail_encryption', 'none'), { ok: true, value: 'none' });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('the allow-list defaults to the configured host and matches exactly', () => {
  assert.equal(mailHostAllowed('smtp.example.test', ENV), true);
  assert.equal(
    mailHostAllowed('SMTP.Example.Test', { ...ENV, MAIL_ALLOWED_HOSTS: 'smtp.example.test, backup.example.test' }),
    true,
  );
  assert.equal(
    mailHostAllowed('attacker.test', { ...ENV, MAIL_ALLOWED_HOSTS: 'smtp.example.test' }),
    false,
  );
  assert.equal(mailHostAllowed('smtp.example.test.evil', { ...ENV, MAIL_ALLOWED_HOSTS: 'smtp.example.test' }), false);
});

test('the SMTP password never goes to a host outside the allow-list', () => {
  const allowed = smtpOptions(SMTP, { ...ENV, MAIL_ALLOWED_HOSTS: 'smtp.example.test' });
  assert.deepEqual(allowed.auth, { user: 'mailer', pass: 'smtp-secret' });

  const repointed = smtpOptions(
    { ...SMTP, mail_host: 'attacker.test' },
    { ...ENV, MAIL_ALLOWED_HOSTS: 'smtp.example.test' },
  );
  assert.equal(repointed.auth, undefined);
  // Refuse the send rather than deliver without a login.
  assert.match(
    mailConfigProblem({ ...SMTP, mail_host: 'attacker.test' }, { ...ENV, MAIL_ALLOWED_HOSTS: 'smtp.example.test' }),
    /MAIL_ALLOWED_HOSTS/,
  );

  // Unset allow-list: existing deployments keep working.
  assert.deepEqual(smtpOptions(SMTP, ENV).auth, { user: 'mailer', pass: 'smtp-secret' });
});

test('sensitive store-admin routes are owner-only', async () => {
  const settings = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'settings', 'route.ts'),
    'utf8',
  );
  assert.match(settings, /guard\.session\.role === 'store_owner'/);

  const notifications = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'settings', 'notifications', 'route.ts'),
    'utf8',
  );
  assert.match(notifications, /export async function POST[\s\S]*requireStoreRole\('store_owner'\)/);
  // Reads stay available to viewers.
  assert.match(notifications, /export async function GET[\s\S]*requireStoreRole\('store_viewer'\)/);

  const retry = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'settings', 'notifications', 'retry', 'route.ts'),
    'utf8',
  );
  assert.match(retry, /requireStoreRole\('store_owner'\)/);

  const lists = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'settings', 'lists', '[kind]', 'route.ts'),
    'utf8',
  );
  assert.match(lists, /OWNER_ONLY_LIST_KINDS\.has\(kind\) \? 'store_owner' : 'store_admin'/);
  assert.match(lists, /export async function GET[\s\S]*requireStoreRole\('store_viewer'\)/);
});
