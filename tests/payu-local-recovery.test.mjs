import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { resolveAppBaseUrl, getPayUCallbackUrls, assertPayUConfigured, getPayUConfig } = await jiti.import(path.join(root, 'src/lib/payu/config.ts'));
const { verifyPaymentWithPayU } = await jiti.import(path.join(root, 'src/lib/payu/verify.ts'));

test('explicit localhost development origin supplies all browser returns on the chosen port', () => {
  const base = resolveAppBaseUrl({ NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:3000/' });
  assert.equal(base.ok, true);
  assert.deepEqual(getPayUCallbackUrls(base.baseUrl), {
    surl: 'http://localhost:3000/api/payu/success',
    furl: 'http://localhost:3000/api/payu/failure',
    curl: 'http://localhost:3000/api/payu/cancel',
    webhook: 'http://localhost:3000/api/payu/webhook',
  });
});

for (const origin of ['http://localhost:3000', 'https://localhost:3000', 'http://shop.example.test']) {
  test(`production still rejects non-public-HTTPS origin ${origin}`, () => {
    assert.equal(resolveAppBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: origin }).ok, false);
  });
}

test('real verifier confirms capture without a return origin; new checkouts still fail closed', async () => {
  const keys = ['PAYU_KEY', 'PAYU_SALT', 'PAYU_ENV', 'APP_BASE_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const fetchBefore = globalThis.fetch;
  process.env.PAYU_KEY = 'fixture-key';
  process.env.PAYU_SALT = 'fixture-salt';
  process.env.PAYU_ENV = 'test';
  delete process.env.APP_BASE_URL;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, 'test.payu.in');
    assert.equal(options.method, 'POST');
    assert.equal(new URLSearchParams(options.body).get('var1'), 'RECOVERY');
    return Response.json({ status: 1, transaction_details: {
      RECOVERY: { status: 'success', unmappedstatus: 'captured', mihpayid: 'fixture-gateway', amt: '500.00' },
    } });
  };
  try {
    assert.throws(() => assertPayUConfigured(getPayUConfig()), /APP_BASE_URL/);
    const captured = await verifyPaymentWithPayU('RECOVERY', 500);
    assert.equal(captured.verified, true);
    assert.equal(captured.amountPaise, 50000);
    const mismatch = await verifyPaymentWithPayU('RECOVERY', 499.99);
    assert.equal(mismatch.verified, false);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
