/**
 * SECURITY (L-6): every rate limiter and the audit trail derived the client
 * address from `X-Forwarded-For` unconditionally. That header is caller-authored
 * unless a proxy overwrites it, so a caller could put a fresh address in each
 * request and never hit a per-IP bucket — the limit was decorative.
 *
 * `TRUST_PROXY` now gates the header: without it the address is unknown ('')
 * and callers skip the per-IP bucket only. A shared 'unknown' bucket would flip
 * the bug around and let one caller lock everyone out, so the tests below also
 * pin "skip, never share".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { trustProxy, clientIpFromHeaders, clientIpFromRequest } = await jiti.import(
  path.join(root, 'src', 'lib', 'platform', 'client-ip.ts'),
);

const source = (relative) => readFile(path.join(root, relative), 'utf8');

test('TRUST_PROXY is off unless explicitly enabled', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
    assert.equal(trustProxy({ TRUST_PROXY: value }), true, value);
  }
  for (const value of ['', '0', 'false', 'no', 'off', 'proxy']) {
    assert.equal(trustProxy({ TRUST_PROXY: value }), false, value);
  }
  assert.equal(trustProxy({}), false);
});

test('forwarded headers are ignored without a trusted proxy', () => {
  const headers = new Headers({
    'x-forwarded-for': '203.0.113.9, 10.0.0.1',
    'x-real-ip': '203.0.113.9',
  });

  assert.equal(clientIpFromHeaders(headers, {}), '');
  assert.equal(
    clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.9' }), {}),
    '',
  );
  assert.equal(
    clientIpFromRequest(new Request('https://shop.example/api/x', { headers }), {}),
    '',
  );
});

test('a trusted proxy yields the leftmost forwarded address', () => {
  const headers = new Headers({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' });
  assert.equal(clientIpFromHeaders(headers, { TRUST_PROXY: '1' }), '203.0.113.9');
  assert.equal(
    clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.7' }), { TRUST_PROXY: '1' }),
    '203.0.113.7',
  );
  assert.equal(clientIpFromHeaders(new Headers(), { TRUST_PROXY: '1' }), '');
});

test('no route parses X-Forwarded-For itself', async () => {
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      if (/x-forwarded-for|x-real-ip/i.test(text)) {
        offenders.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  await walk(path.join(root, 'src'));
  assert.deepEqual(offenders, ['src/lib/platform/client-ip.ts']);
});

test('per-IP buckets are skipped, never shared, when the address is unknown', async () => {
  const availability = await source('src/app/api/catalog/availability/route.ts');
  assert.match(availability, /const ip = clientIpFromRequest\(request\);/);
  assert.match(availability, /ip \? checkRateLimit\(/);

  const coupons = await source('src/app/api/coupons/validate/route.ts');
  assert.match(coupons, /const ip = clientIpFromRequest\(req\);/);
  assert.match(coupons, /ip \? checkRateLimit\(/);

  const initiate = await source('src/app/api/payu/initiate/route.ts');
  assert.match(initiate, /const ip = clientIpFromRequest\(req\);/);
  assert.match(initiate, /ip\s*\n?\s*\? checkRateLimit\(/);

  const webhook = await source('src/app/api/payu/webhook/route.ts');
  assert.match(webhook, /const ip = clientIpFromRequest\(req\);/);
  assert.match(webhook, /ip\s*\n?\s*\? checkRateLimit\(/);

  const reveal = await source('src/app/api/store-admin/customers/[id]/reveal/route.ts');
  assert.match(reveal, /const ip = clientIpFromRequest\(request\);/);
  assert.match(reveal, /const ipLimit = ip\s*\n?\s*\? checkRateLimit\(/);
  assert.match(reveal, /`store-reveal:actor:/);
});

test('user sign-in/up limits skip the IP key when the address is unknown', async () => {
  const auth = await source('src/lib/user-auth.ts');

  assert.match(auth, /const ip = clientIpFromHeaders\(h\);/);
  assert.doesNotMatch(auth, /ip: ip \|\| 'unknown'/);
  assert.match(auth, /return ip \? \[`user-email:\$\{email\}`, `user-ip:\$\{ip\}`\] : \[`user-email:\$\{email\}`\];/);
  assert.match(auth, /if \(ip\) \{\s*const ipResult = checkRateLimit\(`user-\$\{scope\}-ip:\$\{ip\}`/);
});

test('the audit trail hashes only a trusted address', async () => {
  const audit = await source('src/lib/store-admin/audit.ts');
  assert.match(audit, /const ip = clientIpFromHeaders\(headers\);/);
  assert.match(audit, /ipHash: hashIdentifier\(ip\)/);
});

test('the in-memory limiter states its limits and exposes a shared-store seam', async () => {
  const limiter = await source('src/lib/payu/rate-limit.ts');
  assert.match(limiter, /export interface RateLimitStore/);
  assert.match(limiter, /TODO\(security\): before running more than one instance/);
});
