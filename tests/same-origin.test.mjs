/**
 * CSRF guard behind a tunnel.
 *
 * `assertSameOrigin` used to compare the Origin header with
 * `new URL(request.url).host` only. A dev tunnel (cloudflared, ngrok) or any
 * reverse proxy makes those disagree: the browser's Origin is the public
 * hostname, while Next builds `request.url` from the address it listens on.
 * Every same-origin request through the tunnel was therefore answered with
 * "Cross-origin request rejected." — including checkout and the coupon box.
 *
 * These tests pin that the Host the browser actually addressed is accepted,
 * while a genuine cross-site Origin is still refused.
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

function post(headers) {
  return new Request('http://localhost:3000/api/payu/initiate', {
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

test('a rewritten Host is recovered from X-Forwarded-Host', () => {
  const result = assertSameOrigin(
    post({
      origin: 'https://shop.example.test',
      host: '10.0.0.7:3000',
      'x-forwarded-host': 'shop.example.test',
    }),
  );
  assert.equal(result, null);
});

test('a cross-site Origin is still refused through the tunnel', async () => {
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

test('a malformed Origin is refused, not ignored', () => {
  assert.equal(assertSameOrigin(post({ origin: 'not a url', host: 'abc.trycloudflare.com' }))?.status, 403);
});

test('a plain request with neither header stays allowed', () => {
  assert.equal(assertSameOrigin(post({ host: 'localhost:3000' })), null);
});

test('an Origin matching the listen address keeps working', () => {
  assert.equal(assertSameOrigin(post({ origin: 'http://localhost:3000' })), null);
});
