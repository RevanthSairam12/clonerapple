/**
 * CSRF / Same-Origin guard tests (tunnel compatibility + SEC-010 hardening).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});
const { assertSameOrigin } = await jiti.import(path.join(root, 'src', 'lib', 'platform', 'api-guard.ts'));

function post(headers, url = 'http://localhost:3000/api/payu/initiate') {
  return new Request(url, {
    method: 'POST',
    headers,
  });
}

test('a request proxied under its public host is same-origin', () => {
  const result = assertSameOrigin(
    post({
      origin: 'https://assist-energy-compaq-inclusion.trycloudflare.com',
      host: 'assist-energy-compaq-inclusion.trycloudflare.com',
    }),
  );
  assert.equal(result, null, 'the Host header the browser addressed must be accepted');
});

test('a rewritten Host is recovered from X-Forwarded-Host outside production or when TRUST_PROXY=1', () => {
  assert.equal(
    assertSameOrigin(
      post({
        origin: 'https://shop.example.test',
        host: '10.0.0.7:3000',
        'x-forwarded-host': 'shop.example.test',
      }),
      { NODE_ENV: 'development' },
    ),
    null,
  );
  assert.equal(
    assertSameOrigin(
      post({
        origin: 'https://shop.example.test',
        host: '10.0.0.7:3000',
        'x-forwarded-host': 'shop.example.test',
      }),
      { NODE_ENV: 'production', TRUST_PROXY: '1' },
    ),
    null,
  );
});

test('SEC-010: X-Forwarded-Host is NOT trusted in production when TRUST_PROXY is unset', () => {
  const res = assertSameOrigin(
    post({
      origin: 'https://evil.example',
      host: 'gadzio.co.in',
      'x-forwarded-host': 'evil.example',
    }),
    { NODE_ENV: 'production' },
  );
  assert.equal(res?.status, 403);
});

test('a cross-site Origin is refused through the tunnel', async () => {
  const result = assertSameOrigin(
    post({
      origin: 'https://evil.example',
      host: 'assist-energy-compaq-inclusion.trycloudflare.com',
    }),
  );
  assert.ok(result, 'a foreign Origin must be rejected');
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, 'Cross-origin request rejected.');
});

test('Referer stands in when the request has no Origin', () => {
  assert.equal(
    assertSameOrigin(
      post({
        referer: 'https://abc.trycloudflare.com/cart',
        host: 'abc.trycloudflare.com',
      }),
    ),
    null,
  );
  assert.equal(
    assertSameOrigin(post({ referer: 'https://evil.example/cart', host: 'abc.trycloudflare.com' }))
      ?.status,
    403,
  );
});

test('a malformed or null Origin is refused, not ignored', () => {
  assert.equal(assertSameOrigin(post({ origin: 'not a url', host: 'abc.trycloudflare.com' }))?.status, 403);
  assert.equal(assertSameOrigin(post({ origin: 'null', host: 'abc.trycloudflare.com' }))?.status, 403);
  assert.equal(assertSameOrigin(post({ origin: '', host: 'abc.trycloudflare.com' }))?.status, 403);
  assert.equal(assertSameOrigin(post({ referer: 'not a url', host: 'abc.trycloudflare.com' }))?.status, 403);
});

test('a plain non-cookie request with neither Origin nor Referer stays allowed', () => {
  assert.equal(assertSameOrigin(post({ host: 'localhost:3000' })), null);
});

test('an Origin matching the listen address keeps working case-insensitively', () => {
  assert.equal(assertSameOrigin(post({ origin: 'http://LOCALHOST:3000' })), null);
});

test('SEC-010: Sec-Fetch-Site blocks cross-site requests and non-same-origin mutations', () => {
  // Cross-site blocked even on GET
  assert.equal(
    assertSameOrigin(
      new Request('https://gadzio.co.in/api/catalog/summary?fresh=1', {
        method: 'GET',
        headers: { host: 'gadzio.co.in', 'sec-fetch-site': 'cross-site' },
      }),
    )?.status,
    403,
  );

  // same-site and none blocked on POST even if Origin/Referer missing
  for (const sfs of ['cross-site', 'same-site', 'none', 'weird']) {
    assert.equal(
      assertSameOrigin(
        post({ host: 'gadzio.co.in', 'sec-fetch-site': sfs }, 'https://gadzio.co.in/api/account/profile'),
      )?.status,
      403,
      `expected 403 for Sec-Fetch-Site: ${sfs}`,
    );
  }

  // same-origin passes
  assert.equal(
    assertSameOrigin(
      post(
        {
          host: 'gadzio.co.in',
          origin: 'https://gadzio.co.in',
          'sec-fetch-site': 'same-origin',
        },
        'https://gadzio.co.in/api/account/profile',
      ),
    ),
    null,
  );
});

test('SEC-010: cookie-authenticated mutating requests without Origin/Referer require Sec-Fetch-Site: same-origin', () => {
  assert.equal(
    assertSameOrigin(
      post(
        {
          host: 'gadzio.co.in',
          cookie: 'user_session=secret',
        },
        'https://gadzio.co.in/api/account/password',
      ),
    )?.status,
    403,
  );

  assert.equal(
    assertSameOrigin(
      post(
        {
          host: 'gadzio.co.in',
          cookie: 'store_admin_session=secret',
          'sec-fetch-site': 'same-origin',
        },
        'https://gadzio.co.in/api/store-admin/expenses',
      ),
    ),
    null,
  );
});

test('SEC-010: HTTPS request refuses HTTP scheme Origin or Referer downgrade', () => {
  assert.equal(
    assertSameOrigin(
      post(
        { host: 'gadzio.co.in', origin: 'http://gadzio.co.in' },
        'https://gadzio.co.in/api/payu/initiate',
      ),
    )?.status,
    403,
  );
  assert.equal(
    assertSameOrigin(
      post(
        { host: 'gadzio.co.in', 'x-forwarded-proto': 'https', referer: 'http://gadzio.co.in/checkout' },
        'http://10.0.0.1:3000/api/payu/initiate',
      ),
      { NODE_ENV: 'production', TRUST_PROXY: '1' },
    )?.status,
    403,
  );
});
