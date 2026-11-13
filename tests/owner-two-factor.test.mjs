import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const root = process.cwd();
const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const {
  DEFAULT_SETTINGS,
  fieldsForSection,
  isOwnerOnlySetting,
} = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'settings-rules.ts'));

const { isOwnerTwoFactorRequired } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'auth.ts'),
);

test('require_owner_2fa defaults off and is an owner-only security setting', () => {
  assert.equal(DEFAULT_SETTINGS.require_owner_2fa, 'off');
  assert.equal(isOwnerOnlySetting('require_owner_2fa'), true);

  const securityFields = fieldsForSection('security');
  assert.equal(securityFields.length, 1);
  assert.equal(securityFields[0].key, 'require_owner_2fa');
  assert.equal(securityFields[0].kind, 'toggle');
  assert.equal(securityFields[0].default, 'off');
});

test('isOwnerTwoFactorRequired reads store_settings safely and fails open on errors', async () => {
  const onSql = async () => [{ value: 'on' }];
  assert.equal(await isOwnerTwoFactorRequired(onSql), true);

  const offSql = async () => [{ value: 'off' }];
  assert.equal(await isOwnerTwoFactorRequired(offSql), false);

  const emptySql = async () => [];
  assert.equal(await isOwnerTwoFactorRequired(emptySql), false);

  const throwingSql = async () => {
    throw new Error('connection refused');
  };
  assert.equal(await isOwnerTwoFactorRequired(throwingSql), false);

  assert.equal(await isOwnerTwoFactorRequired(null), false);
});

test('overview banner, optional owner enforcement, and lockout protections are wired cleanly', async () => {
  const overviewSource = await readFile(
    path.join(root, 'src', 'app', '(store-admin)', 'store-admin', '(protected)', 'page.tsx'),
    'utf8',
  );
  assert.match(overviewSource, /getTotpState\(session\.adminId\)/);
  assert.match(overviewSource, /isOwnerTwoFactorRequired\(\)/);
  assert.match(overviewSource, /href="\/store-admin\/profile#security"/);
  assert.match(overviewSource, /sa-twofactor-banner/);

  const settingsSource = await readFile(
    path.join(root, 'src', 'lib', 'store-admin', 'settings.ts'),
    'utf8',
  );
  assert.match(settingsSource, /item\.key === 'require_owner_2fa' && item\.value === 'on'/);
  assert.match(settingsSource, /ownerRows\[0\]\?\.totp_enabled !== true/);

  const settingsPageSource = await readFile(
    path.join(root, 'src', 'app', '(store-admin)', 'store-admin', '(protected)', 'settings', 'page.tsx'),
    'utf8',
  );
  assert.match(settingsPageSource, /fieldsForSection\('security'\)/);

  const profilePageSource = await readFile(
    path.join(root, 'src', 'app', '(store-admin)', 'store-admin', '(protected)', 'profile', 'page.tsx'),
    'utf8',
  );
  assert.match(profilePageSource, /require2fa/);
  assert.match(profilePageSource, /isOwnerTwoFactorRequired/);

  const totpPanelSource = await readFile(
    path.join(root, 'src', 'components', 'store-admin', 'TotpPanel.tsx'),
    'utf8',
  );
  assert.match(totpPanelSource, /id="security"/);

  const proxySource = await readFile(path.join(root, 'src', 'proxy.ts'), 'utf8');
  assert.match(proxySource, /session\.role === 'store_owner'/);
  assert.match(proxySource, /!session\.totpEnabled/);
  assert.match(proxySource, /pathname !== '\/store-admin\/profile'/);
  assert.match(proxySource, /\/store-admin\/profile\?require2fa=1#security/);

  const authSource = await readFile(path.join(root, 'src', 'lib', 'store-admin', 'auth.ts'), 'utf8');
  assert.match(authSource, /code: 'totp_setup_required'/);
  assert.match(authSource, /allowTotpSetup/);

  for (const rel of [
    'src/app/api/store-admin/profile/route.ts',
    'src/app/api/store-admin/profile/totp/setup/route.ts',
    'src/app/api/store-admin/profile/totp/enable/route.ts',
  ]) {
    const routeSource = await readFile(path.join(root, rel), 'utf8');
    assert.match(routeSource, /requireStoreRole\(\{\s*allowTotpSetup:\s*true\s*\}\)/, `${rel} must allow TOTP setup`);
  }

  const disableSource = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'profile', 'totp', 'disable', 'route.ts'),
    'utf8',
  );
  assert.match(disableSource, /isOwnerTwoFactorRequired/);
  assert.match(disableSource, /status: 409/);
});

