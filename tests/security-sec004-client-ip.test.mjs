import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';

const root = process.cwd();
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const {
  trustProxy,
  parseTrustProxyHops,
  normalizeClientIp,
  clientIpFromHeaders,
  clientIpFromRequest,
} = await jiti.import(path.join(root, 'src/lib/platform/client-ip.ts'));

test('SEC-004: TRUST_PROXY off ignores every forwarded and proxy header', () => {
  const h = new Headers({
    'x-forwarded-for': '203.0.113.10',
    'x-real-ip': '203.0.113.11',
    'x-vercel-forwarded-for': '203.0.113.12',
    'cf-connecting-ip': '203.0.113.13',
  });
  assert.equal(trustProxy({}), false);
  assert.equal(clientIpFromHeaders(h, {}), '');
  assert.equal(clientIpFromHeaders(h, { TRUST_PROXY: '0', TRUST_PROXY_CHAIN: 'cloudflare', CLOUDFLARE_ORIGIN_SECRET: 's' }), '');
  assert.equal(clientIpFromRequest(new Request('https://shop.example', { headers: h }), {}), '');
});

test('SEC-004: X-Forwarded-For spoofing on the left is ignored; rightmost trusted hop is selected', () => {
  // Attacker injects `1.2.3.4, 5.6.7.8` on left; Vercel appends true socket IP `203.0.113.42` on right.
  const spoofed = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.42' });
  assert.equal(clientIpFromHeaders(spoofed, { TRUST_PROXY: '1' }), '203.0.113.42');

  // Multi-hop proxy (TRUST_PROXY_HOPS=2) picks second-from-right and rejects chains shorter than hops
  assert.equal(
    clientIpFromHeaders(
      new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.1' }),
      { TRUST_PROXY: '1', TRUST_PROXY_HOPS: '2' },
    ),
    '203.0.113.9',
  );
  assert.equal(
    clientIpFromHeaders(
      new Headers({ 'x-forwarded-for': '203.0.113.9' }),
      { TRUST_PROXY: '1', TRUST_PROXY_HOPS: '2' },
    ),
    '',
  );
  assert.equal(parseTrustProxyHops({ TRUST_PROXY_HOPS: '99' }), 5);
  assert.equal(parseTrustProxyHops({ TRUST_PROXY_HOPS: '0' }), 1);
});

test('SEC-004: x-vercel-forwarded-for and x-real-ip take precedence over X-Forwarded-For', () => {
  const h = new Headers({
    'x-forwarded-for': '1.1.1.1, 198.51.100.99',
    'x-real-ip': '198.51.100.77',
    'x-vercel-forwarded-for': '203.0.113.88',
  });
  assert.equal(clientIpFromHeaders(h, { TRUST_PROXY: '1' }), '203.0.113.88');

  const hNoVercel = new Headers({
    'x-forwarded-for': '1.1.1.1, 198.51.100.99',
    'x-real-ip': '198.51.100.77',
  });
  assert.equal(clientIpFromHeaders(hNoVercel, { TRUST_PROXY: '1' }), '198.51.100.77');
});

test('SEC-004: CF-Connecting-IP is NEVER trusted without authenticated origin secret', () => {
  const forgedHeaders = new Headers({
    'cf-connecting-ip': '198.51.100.200',
    'x-vercel-forwarded-for': '203.0.113.55',
  });

  // Default Vercel mode: forged CF-Connecting-IP ignored, Vercel header used.
  assert.equal(clientIpFromHeaders(forgedHeaders, { TRUST_PROXY: '1' }), '203.0.113.55');

  // Cloudflare chain enabled without secret configured or wrong header: still ignored!
  assert.equal(
    clientIpFromHeaders(forgedHeaders, { TRUST_PROXY: '1', TRUST_PROXY_CHAIN: 'cloudflare' }),
    '203.0.113.55',
  );
  assert.equal(
    clientIpFromHeaders(
      new Headers({
        'cf-connecting-ip': '198.51.100.200',
        'x-vercel-forwarded-for': '203.0.113.55',
        'x-cf-origin-secret': 'wrong-secret',
      }),
      { TRUST_PROXY: '1', TRUST_PROXY_CHAIN: 'cloudflare', CLOUDFLARE_ORIGIN_SECRET: 'real-secret' },
    ),
    '203.0.113.55',
  );

  // Authenticated Cloudflare request -> CF-Connecting-IP is accepted.
  assert.equal(
    clientIpFromHeaders(
      new Headers({
        'cf-connecting-ip': '198.51.100.200',
        'x-vercel-forwarded-for': '172.70.0.1',
        'x-cf-origin-secret': 'real-secret',
      }),
      { TRUST_PROXY: '1', TRUST_PROXY_CHAIN: 'cloudflare-vercel', CLOUDFLARE_ORIGIN_SECRET: 'real-secret' },
    ),
    '198.51.100.200',
  );
});

test('SEC-004: malformed and non-IP header values are rejected; valid IPv4/IPv6 normalize cleanly', () => {
  assert.equal(normalizeClientIp('999.999.999.999'), '');
  assert.equal(normalizeClientIp("1.2.3.4' OR 1=1--"), '');
  assert.equal(normalizeClientIp('203.0.113.9:8443'), '203.0.113.9');
  assert.equal(normalizeClientIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeClientIp('[2001:DB8::1]:443'), '2001:db8::1');
  assert.equal(normalizeClientIp('2001:DB8::ABCD'), '2001:db8::abcd');
  assert.equal(normalizeClientIp('a'.repeat(65)), '');

  // If rightmost XFF entry is malformed, do NOT fall back to attacker-controlled leftmost IP!
  assert.equal(
    clientIpFromHeaders(
      new Headers({ 'x-forwarded-for': '203.0.113.5, not-an-ip' }),
      { TRUST_PROXY: '1' },
    ),
    '',
  );
});
