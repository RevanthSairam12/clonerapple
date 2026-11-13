/**
 * Tests for the site address health check, tunnel host detection, startup
 * warnings, and PAYU_ENV production refusal rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const {
  isTunnelHostname,
  isProductionPayUEnv,
  resolveAppBaseUrl,
  checkPayUConfiguration,
  checkSiteAddressHealth,
  getPayUConfig,
} = await jiti.import(path.join(root, 'src', 'lib', 'payu', 'config.ts'));

const { startupWarnings } = await jiti.import(
  path.join(root, 'src', 'lib', 'platform', 'startup-env.ts'),
);

test('isTunnelHostname identifies trycloudflare, ngrok, localtunnel, and tailscale funnel hosts', () => {
  for (const host of [
    'demo-store.trycloudflare.com',
    'abc123.ngrok-free.app',
    'abc123.ngrok-free.dev',
    'abc123.ngrok.io',
    'abc123.ngrok.app',
    'shop.loca.lt',
    'shop.localtunnel.me',
    'box.tailnet.ts.net',
  ]) {
    assert.equal(isTunnelHostname(host), true, `expected ${host} to be detected as tunnel`);
  }

  for (const host of [
    'gadzio.in',
    'shop.gadzio.in',
    'clonerapple.vercel.app',
    'localhost',
    '127.0.0.1',
  ]) {
    assert.equal(isTunnelHostname(host), false, `expected ${host} NOT to be detected as tunnel`);
  }
});

test('PAYU_ENV production or live refuses non-https and tunnel hosts in resolveAppBaseUrl and checkPayUConfiguration', () => {
  for (const payuEnv of ['production', 'live', 'PRODUCTION', 'LIVE']) {
    assert.equal(isProductionPayUEnv({ PAYU_ENV: payuEnv }), true);

    // 1. Refuse HTTP even if NODE_ENV is development
    const httpRes = resolveAppBaseUrl({
      NODE_ENV: 'development',
      PAYU_ENV: payuEnv,
      APP_BASE_URL: 'http://gadzio.in',
    });
    assert.equal(httpRes.ok, false);
    assert.equal(httpRes.code, 'insecure');

    // 2. Refuse tunnel host in PAYU_ENV=production/live
    for (const tunnelUrl of [
      'https://demo-tunnel.trycloudflare.com',
      'https://demo-tunnel.ngrok-free.app',
      'https://demo-tunnel.loca.lt',
    ]) {
      const tunnelRes = resolveAppBaseUrl({
        NODE_ENV: 'production',
        PAYU_ENV: payuEnv,
        APP_BASE_URL: tunnelUrl,
      });
      assert.equal(tunnelRes.ok, false, `${payuEnv} must reject tunnel ${tunnelUrl}`);
      assert.equal(tunnelRes.code, 'tunnel_in_production');

      const payuCheck = checkPayUConfiguration({
        NODE_ENV: 'production',
        PAYU_ENV: payuEnv,
        PAYU_KEY: 'k',
        PAYU_SALT: 's',
        APP_BASE_URL: tunnelUrl,
      });
      assert.equal(payuCheck.ok, false);
      assert.equal(payuCheck.problem.code, 'tunnel_in_production');
    }

    // 3. Accept permanent HTTPS domain in PAYU_ENV=production/live
    const validRes = resolveAppBaseUrl({
      NODE_ENV: 'production',
      PAYU_ENV: payuEnv,
      APP_BASE_URL: 'https://gadzio.co.in',
    });
    assert.equal(validRes.ok, true);
    assert.equal(validRes.baseUrl, 'https://gadzio.co.in');
    assert.equal(validRes.https, true);
    assert.equal(validRes.isTunnel, false);
    assert.equal(validRes.isLocalhost, false);

    const cfg = getPayUConfig({
      NODE_ENV: 'production',
      PAYU_ENV: payuEnv,
      PAYU_KEY: 'k',
      PAYU_SALT: 's',
      APP_BASE_URL: 'https://gadzio.co.in',
    });
    assert.equal(cfg.env, 'live');
    assert.equal(cfg.paymentUrl, 'https://secure.payu.in/_payment');
  }
});

test('PAYU_ENV=test still allows an HTTPS tunnel for sandbox callback testing', () => {
  const res = resolveAppBaseUrl({
    NODE_ENV: 'production',
    PAYU_ENV: 'test',
    APP_BASE_URL: 'https://sandbox-preview.trycloudflare.com',
  });
  assert.equal(res.ok, true);
  assert.equal(res.isTunnel, true);
  assert.equal(res.https, true);
});

test('checkSiteAddressHealth reports reachability, https, tunnel status, and production readiness', async () => {
  // 1. Missing APP_BASE_URL
  const missing = await checkSiteAddressHealth({});
  assert.equal(missing.ok, false);
  assert.equal(missing.configured, false);
  assert.equal(missing.code, 'missing');

  // 2. Reachable permanent HTTPS domain
  const healthy = await checkSiteAddressHealth(
    { NODE_ENV: 'production', PAYU_ENV: 'production', APP_BASE_URL: 'https://gadzio.co.in' },
    async () => new Response('ok', { status: 200 }),
  );
  assert.equal(healthy.ok, true);
  assert.equal(healthy.reachable, true);
  assert.equal(healthy.https, true);
  assert.equal(healthy.isTunnel, false);
  assert.equal(healthy.productionReady, true);
  assert.equal(healthy.code, 'ok');

  // 3. Reachable HTTPS tunnel in test mode -> tunnel_warning, productionReady=false
  const tunnel = await checkSiteAddressHealth(
    { NODE_ENV: 'production', PAYU_ENV: 'test', APP_BASE_URL: 'https://demo.trycloudflare.com' },
    async () => new Response('ok', { status: 200 }),
  );
  assert.equal(tunnel.ok, true);
  assert.equal(tunnel.reachable, true);
  assert.equal(tunnel.https, true);
  assert.equal(tunnel.isTunnel, true);
  assert.equal(tunnel.productionReady, false);
  assert.equal(tunnel.code, 'tunnel_warning');

  // 4. Tunnel in PAYU_ENV=production -> refused before fetch
  let fetched = false;
  const prodTunnel = await checkSiteAddressHealth(
    {
      NODE_ENV: 'production',
      PAYU_ENV: 'production',
      APP_BASE_URL: 'https://demo.trycloudflare.com',
    },
    async () => {
      fetched = true;
      return new Response('ok', { status: 200 });
    },
  );
  assert.equal(fetched, false);
  assert.equal(prodTunnel.ok, false);
  assert.equal(prodTunnel.isTunnel, true);
  assert.equal(prodTunnel.code, 'tunnel_in_production');

  // 5. Unreachable (401 Vercel Deployment Protection)
  const blocked401 = await checkSiteAddressHealth(
    { NODE_ENV: 'production', PAYU_ENV: 'test', APP_BASE_URL: 'https://staging.gadzio.in' },
    async () => new Response('Unauthorized', { status: 401 }),
  );
  assert.equal(blocked401.ok, false);
  assert.equal(blocked401.reachable, false);
  assert.equal(blocked401.statusCode, 401);
  assert.equal(blocked401.code, 'unreachable');
  assert.match(blocked401.message, /Deployment Protection/);
});

test('startupWarnings warns on tunnel or non-HTTPS APP_BASE_URL in production without echoing values', () => {
  const tunnelUrl = 'https://secret-tunnel-name-12345.trycloudflare.com';
  const warnings = startupWarnings({
    NODE_ENV: 'production',
    TRUST_PROXY: '1',
    MAIL_ALLOWED_HOSTS: 'smtp.example.test',
    APP_BASE_URL: tunnelUrl,
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /APP_BASE_URL points to a temporary tunnel host/);
  assert.ok(!warnings[0].includes('secret-tunnel-name-12345'), 'must never echo the URL value');

  const httpWarnings = startupWarnings({
    NODE_ENV: 'production',
    TRUST_PROXY: '1',
    MAIL_ALLOWED_HOSTS: 'smtp.example.test',
    APP_BASE_URL: 'http://insecure-host.example.test',
  });
  assert.equal(httpWarnings.length, 1);
  assert.match(httpWarnings[0], /APP_BASE_URL does not use HTTPS/);
  assert.ok(!httpWarnings[0].includes('insecure-host'));
});

test('owner-only site-address-check route is guarded, same-origin, rate-limited, and audited', () => {
  const routeSrc = readFileSync(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'site-address-check', 'route.ts'),
    'utf8',
  );
  assert.match(routeSrc, /assertSameOrigin\(request\)/);
  assert.match(routeSrc, /requireStoreRole\(['"]store_owner['"]\)/);
  assert.match(routeSrc, /checkRateLimit\(/);
  assert.match(routeSrc, /writeAudit\(/);
  assert.match(routeSrc, /payments\.check_site_address/);
});
