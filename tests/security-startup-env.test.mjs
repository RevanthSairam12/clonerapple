/**
 * SECURITY close-out (Task 3): production environment warnings.
 *
 * The warning exists so a production deployment that forgets
 * `MAIL_ALLOWED_HOSTS` says so once at boot, and so a `TRUST_PROXY` value
 * nothing understands does not silently disable per-IP limiting. It is
 * advisory: no warning may change behaviour, and no message may contain a
 * value from the environment.
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
  alias: { '@': path.join(root, 'src') },
});

const { startupWarnings } = await jiti.import(
  path.join(root, 'src', 'lib', 'platform', 'startup-env.ts'),
);

const source = (relative) => readFile(path.join(root, relative), 'utf8');

const PRODUCTION = { NODE_ENV: 'production' };

test('a fully configured production environment is quiet', () => {
  assert.deepEqual(
    startupWarnings({ ...PRODUCTION, TRUST_PROXY: '1', MAIL_ALLOWED_HOSTS: 'smtp.example.test' }),
    [],
  );
});

test('development never warns', () => {
  for (const env of [
    { NODE_ENV: 'development' },
    { NODE_ENV: 'test' },
    {},
  ]) {
    assert.deepEqual(startupWarnings(env), [], JSON.stringify(env));
  }
});

test('production without MAIL_ALLOWED_HOSTS warns once, naming the variable only', () => {
  const warnings = startupWarnings({ ...PRODUCTION, MAIL_ALLOWED_HOSTS: '  ' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MAIL_ALLOWED_HOSTS is not set/);
  assert.match(warnings[0], /SMTP/);

  // A comma-separated list, a single host and a blank entry all count as set.
  for (const value of ['smtp.example.test', 'a.test, b.test', 'a.test,']) {
    assert.ok(
      !startupWarnings({ ...PRODUCTION, MAIL_ALLOWED_HOSTS: value }).some((w) =>
        w.includes('MAIL_ALLOWED_HOSTS is not set'),
      ),
      value,
    );
  }
});

test('TRUST_PROXY: recognised values are silent, unrecognised ones warn', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' on ']) {
    assert.deepEqual(
      startupWarnings({ ...PRODUCTION, TRUST_PROXY: value, MAIL_ALLOWED_HOSTS: 'a.test' }),
      [],
      value,
    );
  }
  for (const value of ['0', 'false', 'no', 'off', 'proxy', 'localhost']) {
    const warnings = startupWarnings({
      ...PRODUCTION,
      TRUST_PROXY: value,
      MAIL_ALLOWED_HOSTS: 'a.test',
    });
    assert.equal(warnings.length, 1, value);
    assert.match(warnings[0], /TRUST_PROXY/);
  }
});

test('an unset TRUST_PROXY is a valid choice and does not warn', () => {
  assert.deepEqual(startupWarnings({ ...PRODUCTION, MAIL_ALLOWED_HOSTS: 'a.test' }), []);
});

test('no warning ever echoes an environment value', () => {
  const secret = 'super-secret-smtp-password-9f8e7d';
  const warnings = startupWarnings({
    NODE_ENV: 'production',
    TRUST_PROXY: 'nonsense-value',
    MAIL_PASSWORD: secret,
    DATABASE_URL: `postgresql://u:${secret}@h/db`,
  });
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    assert.ok(!warning.includes(secret), 'a credential leaked into a warning');
    assert.ok(!/postgresql:\/\//.test(warning), 'a connection string leaked into a warning');
    assert.ok(!warning.includes('nonsense-value'), 'an environment value leaked into a warning');
  }
});

test('the Next instrumentation hook wraps the warning so boot cannot fail', async () => {
  const instrumentation = await source('src/instrumentation.ts');
  assert.match(instrumentation, /export function register\(\): void/);
  assert.match(instrumentation, /startupWarnings\(process\.env\)/);
  assert.match(instrumentation, /try \{[\s\S]*startupWarnings[\s\S]*\} catch \{/);
  // Boot-time code must not open a database connection or call a provider.
  assert.doesNotMatch(instrumentation, /getSql|postgres\(|nodemailer|fetch\(/);
});

test('the module is pure: no I/O imports', async () => {
  const module = await source('src/lib/platform/startup-env.ts');
  assert.doesNotMatch(module, /^import /m, 'startup-env must stay dependency-free');
});
