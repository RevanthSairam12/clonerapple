/**
 * SECURITY (L-5): the CSP had no `object-src` or `base-uri`, so a stored
 * injection that reached a page could load a plugin document or rewrite every
 * relative URL through `<base>`. `'unsafe-eval'` was also served in production.
 *
 * `object-src 'none'` and `base-uri 'self'` are now set, and `'unsafe-eval'`
 * is development only. A per-request nonce cannot cover the statically
 * prerendered pages in this app, so `'unsafe-inline'` stays — the limitation is
 * recorded here rather than silently dropped.
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

const { contentSecurityPolicy, applySecurityHeaders } = await jiti.import(
  path.join(root, 'src', 'lib', 'platform', 'security-headers.ts'),
);

const directive = (policy, name) => policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

test('object-src and base-uri are locked down in every environment', () => {
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development' }, {}]) {
    const policy = contentSecurityPolicy(env);
    assert.equal(directive(policy, 'object-src'), "object-src 'none'");
    assert.equal(directive(policy, 'base-uri'), "base-uri 'self'");
    assert.equal(directive(policy, 'frame-ancestors'), "frame-ancestors 'none'");
    assert.equal(directive(policy, 'default-src'), "default-src 'self'");
  }
});

test("production never allows 'unsafe-eval'", () => {
  const policy = contentSecurityPolicy({ NODE_ENV: 'production' });
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.equal(directive(policy, 'script-src'), "script-src 'self' 'unsafe-inline'");
});

test("development keeps 'unsafe-eval' for React refresh", () => {
  assert.match(contentSecurityPolicy({ NODE_ENV: 'development' }), /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
});

test('the PayU checkout hosts stay reachable', () => {
  const policy = contentSecurityPolicy({ NODE_ENV: 'production' });
  for (const name of ['connect-src', 'form-action']) {
    const value = directive(policy, name);
    assert.ok(value, name);
    assert.ok(value.includes('https://*.payu.in'), name);
    assert.ok(value.includes('https://*.payumoney.com'), name);
  }
});

test('the headers are applied to any response the proxy returns', () => {
  const response = { headers: new Headers() };
  const returned = applySecurityHeaders(response);
  assert.equal(returned, response);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
});
