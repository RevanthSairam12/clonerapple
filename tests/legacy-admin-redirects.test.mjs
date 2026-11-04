import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server.js';

const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const { default: nextConfig } = await jiti.import(path.resolve('next.config.ts'));
const { COLLECTIONS, LEGACY_COLLECTION_KEYS = [] } = await jiti.import(path.resolve('src/lib/website/collections.ts'));

const mappings = [
  ['/admin', '/store-admin/website'],
  ['/admin/login', '/store-admin/login?next=/store-admin/website'],
  ['/admin/theme', '/store-admin/website/theme'],
  ['/admin/security', '/store-admin/profile#security'],
  ['/admin/unknown/nested', '/store-admin/website'],
  ['/admin/content', '/store-admin/website'],
  ...[...COLLECTIONS.map(({ key }) => key), ...LEGACY_COLLECTION_KEYS]
    .map(key => [`/admin/content/${key}`, `/store-admin/website/content/${key}`]),
];

for (const [source, destination] of mappings) {
  test(`308 bookmark mapping: ${source}`, async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://shop.example.test${source}`, nextConfig,
    });
    assert.equal(response.status, 308);
    const actual = new URL(response.headers.get('location'));
    const expected = new URL(destination, 'https://shop.example.test');
    assert.equal(actual.origin + actual.pathname + actual.hash, expected.origin + expected.pathname + expected.hash);
    assert.deepEqual([...actual.searchParams], [...expected.searchParams]);
  });
}

test('redirects do not consume legacy media or unrelated paths', async () => {
  for (const pathname of ['/api/admin/media/fixture-id', '/api/media/fixture-id', '/administrator']) {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://shop.example.test${pathname}`, nextConfig,
    });
    assert.equal(response.status, 200, pathname);
  }
});
