import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createJiti } from 'jiti';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { checkProductionEnv, isVercelDeployment, shouldEnforceProductionEnv } =
  await jiti.import(path.join(root, 'src', 'lib', 'platform', 'production-env.ts'));

const { assertPayUConfigured, checkPayUConfiguration, getPayUConfig } =
  await jiti.import(path.join(root, 'src', 'lib', 'payu', 'config.ts'));

const { siteMetadataBase, siteOpenGraphUrl } = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'metadata.ts'),
);

function validProdEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    APP_ENV: 'production',
    VERCEL: '1',
    VERCEL_ENV: 'production',
    TRUST_PROXY: '1',
    PAYU_ENV: 'live',
    PAYU_BASE_URL: 'https://secure.payu.in/_payment',
    PAYU_KEY: 'synth_live_key_len_18',
    PAYU_SALT: 'S'.repeat(32),
    PAYU_RETURN_SECRET: 'R'.repeat(32),
    CRON_SECRET: 'C'.repeat(32),
    APP_BASE_URL: 'https://gadzio.co.in',
    MAIL_ALLOWED_HOSTS: 'smtp.resend.com',
    DATABASE_URL: 'postgresql://postgres.proj:pw@pooler.db.example:6543/postgres',
    ...overrides,
  };
}

function validStagingEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    TRUST_PROXY: '1',
    PAYU_ENV: 'test',
    PAYU_BASE_URL: 'https://test.payu.in/_payment',
    PAYU_KEY: 'synth_test_key',
    PAYU_SALT: 'T'.repeat(32),
    PAYU_RETURN_SECRET: 'Q'.repeat(32),
    CRON_SECRET: 'D'.repeat(32),
    APP_BASE_URL: 'https://staging.gadzio.co.in',
    MAIL_ALLOWED_HOSTS: 'smtp.resend.com',
    DATABASE_URL: 'postgresql://postgres.proj:pw@pooler.db.example:6543/postgres',
    ...overrides,
  };
}

test('valid production and staging configurations pass without DATABASE_MIGRATION_URL', () => {
  const prod = checkProductionEnv(validProdEnv(), { mailOn: true });
  assert.equal(prod.ok, true);
  assert.equal(prod.appEnv, 'production');
  assert.equal(prod.onVercel, true);
  assert.equal(prod.mailOn, true);
  assert.deepEqual(prod.issues, []);

  // Live origin without /_payment suffix is also accepted as the PayU live base URL.
  const prodOrigin = checkProductionEnv(
    validProdEnv({ PAYU_BASE_URL: 'https://secure.payu.in' }),
    { mailOn: true },
  );
  assert.equal(prodOrigin.ok, true);

  const staging = checkProductionEnv(validStagingEnv(), { mailOn: true });
  assert.equal(staging.ok, true);
  assert.equal(staging.appEnv, 'staging');
  assert.deepEqual(staging.issues, []);

  const stagingOrigin = checkProductionEnv(
    validStagingEnv({ PAYU_BASE_URL: 'https://test.payu.in' }),
    { mailOn: false },
  );
  assert.equal(stagingOrigin.ok, true);
});

test('APP_ENV must be production or staging', () => {
  const missing = checkProductionEnv(validProdEnv({ APP_ENV: undefined }), { mailOn: false });
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some((i) => i.code === 'invalid_app_env' && i.envVar === 'APP_ENV'));

  const unknown = checkProductionEnv(validProdEnv({ APP_ENV: 'development' }), { mailOn: false });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.issues.some((i) => i.code === 'invalid_app_env'));
  // Never echo the invalid value, only length.
  const msg = unknown.issues.find((i) => i.code === 'invalid_app_env').message;
  assert.ok(!msg.includes('development'));
  assert.ok(msg.includes('length 11'));
});

test('APP_ENV=production requires PAYU_ENV=live and live PayU base URL', () => {
  for (const badPayuEnv of ['test', 'production', '']) {
    const res = checkProductionEnv(validProdEnv({ PAYU_ENV: badPayuEnv }));
    assert.equal(res.ok, false);
    assert.ok(
      res.issues.some((i) => i.code === 'payu_env_mismatch' && i.envVar === 'PAYU_ENV'),
      `expected payu_env_mismatch for PAYU_ENV=${badPayuEnv}`,
    );
  }

  for (const badUrl of ['https://test.payu.in/_payment', 'https://evil.example/_payment', 'http://secure.payu.in/_payment', '']) {
    const res = checkProductionEnv(validProdEnv({ PAYU_BASE_URL: badUrl }));
    assert.equal(res.ok, false);
    assert.ok(
      res.issues.some((i) => i.code === 'payu_base_url_mismatch' && i.envVar === 'PAYU_BASE_URL'),
      `expected payu_base_url_mismatch for ${badUrl}`,
    );
  }
});

test('APP_ENV=staging forbids live PayU and requires PAYU_ENV=test and test PayU base URL', () => {
  for (const badPayuEnv of ['live', 'production', '']) {
    const res = checkProductionEnv(validStagingEnv({ PAYU_ENV: badPayuEnv }));
    assert.equal(res.ok, false);
    assert.ok(res.issues.some((i) => i.code === 'payu_env_mismatch' && i.envVar === 'PAYU_ENV'));
  }

  for (const badUrl of ['https://secure.payu.in/_payment', 'https://other.payu.in/_payment', '']) {
    const res = checkProductionEnv(validStagingEnv({ PAYU_BASE_URL: badUrl }));
    assert.equal(res.ok, false);
    assert.ok(res.issues.some((i) => i.code === 'payu_base_url_mismatch'));
  }
});

test('PAYU_RETURN_SECRET and CRON_SECRET require at least 32 characters', () => {
  const shortReturn = checkProductionEnv(validProdEnv({ PAYU_RETURN_SECRET: 'x'.repeat(31) }));
  assert.equal(shortReturn.ok, false);
  assert.ok(shortReturn.issues.some((i) => i.code === 'payu_return_secret_invalid' && i.message.includes('length 31')));

  const missingCron = checkProductionEnv(validProdEnv({ CRON_SECRET: '' }));
  assert.equal(missingCron.ok, false);
  assert.ok(missingCron.issues.some((i) => i.code === 'cron_secret_invalid' && i.message.includes('length 0')));

  const shortCron = checkProductionEnv(validProdEnv({ CRON_SECRET: 'y'.repeat(31) }));
  assert.equal(shortCron.ok, false);
  assert.ok(shortCron.issues.some((i) => i.code === 'cron_secret_invalid' && i.message.includes('length 31')));
});

test('TRUST_PROXY=1 is required when deploying on Vercel', () => {
  assert.equal(isVercelDeployment({ VERCEL: '1' }), true);
  assert.equal(isVercelDeployment({ VERCEL_ENV: 'preview' }), true);
  assert.equal(isVercelDeployment({}), false);

  const missingTrustProxy = checkProductionEnv(validProdEnv({ TRUST_PROXY: undefined }));
  assert.equal(missingTrustProxy.ok, false);
  assert.ok(missingTrustProxy.issues.some((i) => i.code === 'trust_proxy_required'));

  const wrongTrustProxy = checkProductionEnv(validStagingEnv({ TRUST_PROXY: '0' }));
  assert.equal(wrongTrustProxy.ok, false);
  assert.ok(wrongTrustProxy.issues.some((i) => i.code === 'trust_proxy_required'));

  const nonVercel = checkProductionEnv(
    validStagingEnv({ VERCEL: undefined, VERCEL_ENV: undefined, TRUST_PROXY: undefined }),
  );
  assert.equal(nonVercel.ok, true);
});

test('APP_BASE_URL requires HTTPS and rejects localhost and tunnel hosts in production and staging', () => {
  const badBaseUrls = [
    '',
    'http://gadzio.co.in',
    'https://localhost:3000',
    'https://127.0.0.1',
    'https://shop.localhost',
    'https://quick.trycloudflare.com',
    'https://test.ngrok-free.app',
    'https://test.ts.net',
    'https://gadzio.co.in/shop',
    'https://gadzio.co.in?foo=bar',
  ];

  for (const envFactory of [validProdEnv, validStagingEnv]) {
    for (const url of badBaseUrls) {
      const res = checkProductionEnv(envFactory({ APP_BASE_URL: url }));
      assert.equal(res.ok, false, `expected failure for APP_BASE_URL=${url}`);
      assert.ok(
        res.issues.some((i) => i.code === 'app_base_url_invalid' && i.envVar === 'APP_BASE_URL'),
        `expected app_base_url_invalid for ${url}`,
      );
    }
  }
});

test('MAIL_ALLOWED_HOSTS is required when mail is on and optional when mail is off', () => {
  const mailOnMissing = checkProductionEnv(
    validProdEnv({ MAIL_ALLOWED_HOSTS: undefined }),
    { mailOn: true },
  );
  assert.equal(mailOnMissing.ok, false);
  assert.ok(mailOnMissing.issues.some((i) => i.code === 'mail_allowed_hosts_missing'));

  const mailOnBlank = checkProductionEnv(
    validProdEnv({ MAIL_ALLOWED_HOSTS: ' , ' }),
    { mailOn: true },
  );
  assert.equal(mailOnBlank.ok, false);
  assert.ok(mailOnBlank.issues.some((i) => i.code === 'mail_allowed_hosts_missing'));

  const mailOffMissing = checkProductionEnv(
    validProdEnv({ MAIL_ALLOWED_HOSTS: undefined }),
    { mailOn: false },
  );
  assert.equal(mailOffMissing.ok, true);
});

test('DATABASE_URL must use pooler port 6543', () => {
  const missingDb = checkProductionEnv(validProdEnv({ DATABASE_URL: '' }));
  assert.equal(missingDb.ok, false);
  assert.ok(missingDb.issues.some((i) => i.code === 'database_url_invalid'));

  const sessionPortDb = checkProductionEnv(
    validProdEnv({
      DATABASE_URL: 'postgresql://postgres:secretpw@db.proj.example:5432/postgres',
    }),
  );
  assert.equal(sessionPortDb.ok, false);
  assert.ok(sessionPortDb.issues.some((i) => i.code === 'database_url_invalid'));

  const defaultPortDb = checkProductionEnv(
    validProdEnv({
      DATABASE_URL: 'postgresql://postgres:secretpw@db.proj.example/postgres',
    }),
  );
  assert.equal(defaultPortDb.ok, false);
  assert.ok(defaultPortDb.issues.some((i) => i.code === 'database_url_invalid'));
});

test('error messages never print secret values, URLs, or connection strings', () => {
  const secretSentinels = [
    'SENTINEL_PAYU_KEY_99',
    'SENTINEL_PAYU_SALT_99',
    'SENTINEL_RETURN_99',
    'SENTINEL_CRON_99',
    'SENTINEL_DB_PASS_99',
    'sentinel-db-host.example',
    'sentinel-bad-app-host.trycloudflare.com',
    'sentinel-bad-payu.example',
  ];

  const badEnv = {
    APP_ENV: 'invalid_sentinel_mode',
    VERCEL: '1',
    TRUST_PROXY: 'no',
    PAYU_ENV: 'weird',
    PAYU_BASE_URL: 'https://sentinel-bad-payu.example/_payment',
    PAYU_KEY: 'SENTINEL_PAYU_KEY_99',
    PAYU_SALT: 'SENTINEL_PAYU_SALT_99',
    PAYU_RETURN_SECRET: 'SENTINEL_RETURN_99',
    CRON_SECRET: 'SENTINEL_CRON_99',
    APP_BASE_URL: 'https://sentinel-bad-app-host.trycloudflare.com',
    MAIL_ALLOWED_HOSTS: '',
    DATABASE_URL: 'postgresql://postgres:SENTINEL_DB_PASS_99@sentinel-db-host.example:5432/postgres',
  };

  for (const appEnv of ['production', 'staging', 'invalid_sentinel_mode']) {
    const res = checkProductionEnv({ ...badEnv, APP_ENV: appEnv }, { mailOn: true });
    assert.equal(res.ok, false);
    const serialized = JSON.stringify(res.issues);
    for (const sentinel of secretSentinels) {
      assert.ok(
        !serialized.includes(sentinel),
        `issue output leaked ${sentinel}: ${serialized}`,
      );
    }
  }
});

test('runtime payment guard refuses unsafe production and staging setups', () => {
  assert.equal(shouldEnforceProductionEnv(validProdEnv()), true);
  assert.equal(shouldEnforceProductionEnv(validStagingEnv()), true);
  assert.equal(shouldEnforceProductionEnv({ NODE_ENV: 'test', PAYU_ENV: 'test' }), false);

  const goodCheck = checkPayUConfiguration(validProdEnv(), { mailOn: true });
  assert.equal(goodCheck.ok, true);

  // Refuses payment when DB port is 5432 in production
  const badPort = validProdEnv({
    DATABASE_URL: 'postgresql://postgres:pw@db.example:5432/postgres',
  });
  const portCheck = checkPayUConfiguration(badPort, { mailOn: true });
  assert.equal(portCheck.ok, false);
  assert.throws(() => {
    assertPayUConfigured(getPayUConfig(badPort), badPort, { mailOn: true });
  }, /DATABASE_URL/);

  // Refuses payment when staging uses live PayU
  const badStaging = validStagingEnv({ PAYU_ENV: 'live' });
  const stagingCheck = checkPayUConfiguration(badStaging, { mailOn: true });
  assert.equal(stagingCheck.ok, false);
  assert.throws(() => {
    assertPayUConfigured(getPayUConfig(badStaging), badStaging, { mailOn: true });
  }, /PAYU_ENV/);

  // Refuses payment when mail is on without MAIL_ALLOWED_HOSTS
  const badMail = validProdEnv({ MAIL_ALLOWED_HOSTS: undefined });
  assert.equal(checkPayUConfiguration(badMail, { mailOn: true }).ok, false);
  assert.equal(checkPayUConfiguration(badMail, { mailOn: false }).ok, true);

  // Refuses payment on Vercel without TRUST_PROXY=1
  const badProxy = validStagingEnv({ TRUST_PROXY: undefined });
  assert.equal(checkPayUConfiguration(badProxy, { mailOn: false }).ok, false);
});

test('initiate route enforces runtime mailOn check and storefront metadata fails closed without hardcoded fallbacks', async () => {
  const initiateSource = await readFile(
    path.join(root, 'src', 'app', 'api', 'payu', 'initiate', 'route.ts'),
    'utf8',
  );
  assert.match(initiateSource, /checkPayUConfiguration\s*\(\s*process\.env\s*,\s*\{\s*mailOn:\s*settings\.mail_status\s*===\s*'on'/);

  const prevAppBase = process.env.APP_BASE_URL;
  const prevPayuEnv = process.env.PAYU_ENV;
  try {
    delete process.env.APP_BASE_URL;
    assert.equal(siteMetadataBase(), undefined);
    assert.equal(siteOpenGraphUrl('/android'), undefined);

    process.env.APP_BASE_URL = 'not-a-valid-origin';
    assert.equal(siteMetadataBase(), undefined);
    assert.equal(siteOpenGraphUrl('/sale'), undefined);

    process.env.PAYU_ENV = 'live';
    process.env.APP_BASE_URL = 'https://bad.trycloudflare.com';
    assert.equal(siteMetadataBase(), undefined);
    assert.equal(siteOpenGraphUrl('/sale'), undefined);

    process.env.APP_BASE_URL = 'https://gadzio.co.in';
    assert.equal(siteMetadataBase()?.origin, 'https://gadzio.co.in');
    assert.equal(siteOpenGraphUrl('/android'), 'https://gadzio.co.in/android');
  } finally {
    if (prevAppBase === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = prevAppBase;
    }
    if (prevPayuEnv === undefined) {
      delete process.env.PAYU_ENV;
    } else {
      process.env.PAYU_ENV = prevPayuEnv;
    }
  }

  const enqueueSource = await readFile(
    path.join(root, 'src', 'lib', 'notifications', 'enqueue.ts'),
    'utf8',
  );
  assert.ok(!enqueueSource.includes('https://gadzio.'));
  assert.ok(!enqueueSource.includes('localhost:3000'));
  assert.match(enqueueSource, /getAppBaseUrl\(\)/);

  const metadataFiles = [
    'src/app/page.tsx',
    'src/app/android/page.tsx',
    'src/app/sale/page.tsx',
    'src/app/shop/product/[productId]/page.tsx',
    'src/app/shop/iphone/accessories/cases-protection/page.tsx',
    'src/app/in/shop/iphone/accessories/[slug]/page.tsx',
    'src/app/in/shop/iphone/accessories/airpods-case/page.tsx',
    'src/app/in/shop/iphone/accessories/cable-plug-case/page.tsx',
    'src/app/in/shop/iphone/accessories/cases-protection/page.tsx',
    'src/app/in/shop/iphone/accessories/mobile-cases/page.tsx',
    'src/app/in/shop/iphone/accessories/power-adapter-cable/page.tsx',
    'src/app/in/shop/iphone/accessories/wired-earphones/page.tsx',
  ];
  for (const rel of metadataFiles) {
    const content = await readFile(path.join(root, rel), 'utf8');
    assert.ok(!content.includes('https://gadzio.'), `${rel} must not hardcode gadzio domain`);
    assert.ok(!content.includes('http://localhost:3000'), `${rel} must not hardcode localhost fallback`);
  }
});

test('CLI check:production-env exits 0 on valid env and exits 1 with lengths only on invalid env', async () => {
  const cliPath = path.join(root, 'scripts', 'check-production-env.mjs');
  const passRun = await execFileAsync(
    process.execPath,
    [cliPath, '--no-dotenv', '--offline', '--mail-on'],
    { env: { ...process.env, ...validProdEnv() } },
  );
  const parsedPass = JSON.parse(passRun.stdout);
  assert.equal(parsedPass.ok, true);
  assert.equal(parsedPass.issueCount, 0);

  let failedErr = null;
  try {
    await execFileAsync(
      process.execPath,
      [cliPath, '--no-dotenv', '--offline', '--mail-on'],
      {
        env: {
          ...process.env,
          ...validProdEnv({
            PAYU_RETURN_SECRET: 'TOO_SHORT_SENTINEL_SECRET',
            DATABASE_URL: 'postgresql://u:DB_PW_SENTINEL@db.example:5432/postgres',
          }),
        },
      },
    );
  } catch (err) {
    failedErr = err;
  }
  assert.ok(failedErr, 'CLI must exit non-zero on invalid env');
  assert.equal(failedErr.code, 1);
  assert.ok(!String(failedErr.stdout).includes('TOO_SHORT_SENTINEL_SECRET'));
  assert.ok(!String(failedErr.stdout).includes('DB_PW_SENTINEL'));
  const parsedFail = JSON.parse(failedErr.stdout);
  assert.equal(parsedFail.ok, false);
  assert.equal(parsedFail.issueCount, 2);
});
