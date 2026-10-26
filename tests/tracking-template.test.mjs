import test from 'node:test';
import assert from 'node:assert/strict';

import { TRACKING_TOKEN, buildTrackingUrl } from '../src/lib/store-admin/delivery.ts';

test('a tracking number is substituted into the template', () => {
  assert.equal(
    buildTrackingUrl('https://courier.example/track?awb={tracking}', 'AWB123'),
    'https://courier.example/track?awb=AWB123',
  );
});

test('every occurrence of the token is replaced', () => {
  assert.equal(
    buildTrackingUrl('https://c.example/{tracking}/status/{tracking}', 'Z9'),
    'https://c.example/Z9/status/Z9',
  );
});

test('the tracking number is percent-encoded so it cannot add parameters', () => {
  const url = buildTrackingUrl('https://c.example/track?awb={tracking}', 'A&B=1#frag');
  assert.ok(url);
  assert.ok(url.includes('A%26B%3D1%23frag'));
  assert.equal(new URL(url).searchParams.get('B'), null);
});

test('a template without the token is rejected', () => {
  assert.equal(buildTrackingUrl('https://c.example/track', 'AWB1'), null);
});

test('a non-HTTPS template is rejected', () => {
  assert.equal(buildTrackingUrl('http://c.example/{tracking}', 'AWB1'), null);
});

test('credentials in the template are rejected', () => {
  assert.equal(buildTrackingUrl('https://user:pass@c.example/{tracking}', 'AWB1'), null);
});

test('empty template or number produces no link', () => {
  assert.equal(buildTrackingUrl('', 'AWB1'), null);
  assert.equal(buildTrackingUrl('https://c.example/{tracking}', ''), null);
  assert.equal(buildTrackingUrl(null, 'AWB1'), null);
  assert.equal(buildTrackingUrl('https://c.example/{tracking}', 42), null);
});

test('the token constant is what the settings screen tells operators to type', () => {
  assert.equal(TRACKING_TOKEN, '{tracking}');
});
