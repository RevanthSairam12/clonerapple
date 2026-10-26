import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NOTIFICATION_ATTEMPTS,
  cleanPhone,
  dedupeKey,
  normalizeEmail,
  normalizePhone,
  retryDelaySeconds,
  uniqueRecipients,
} from '../src/lib/notifications/rules.ts';

test('email recipients are trimmed, lower-cased and validated', () => {
  assert.equal(normalizeEmail('  Ravi@Example.TEST '), 'ravi@example.test');
  assert.equal(normalizeEmail('not-an-email'), '');
  assert.equal(normalizeEmail('a@b'), '');
  assert.equal(normalizeEmail(null), '');
});

test('phone recipients keep a country-code plus but lose formatting', () => {
  assert.equal(cleanPhone('+91 98765 43210'), '+919876543210');
  assert.equal(cleanPhone('(987) 654-3210'), '9876543210');
  assert.equal(cleanPhone('123'), '123');
  assert.equal(cleanPhone(''), '');
  assert.equal(cleanPhone('1234567890123456'), '', 'longer than E.164 is not a phone');
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
});

test('recipient dedupe is case- and format-insensitive', () => {
  assert.deepEqual(
    uniqueRecipients(['A@example.test', 'a@example.test', ' b@example.test '], 'email'),
    ['a@example.test', 'b@example.test'],
  );
  assert.deepEqual(
    uniqueRecipients(['+91 98765 43210', '919876543210'], 'sms'),
    ['+919876543210'],
  );
});

test('the dedupe key is stable for duplicate callbacks', () => {
  const base = {
    event: 'payment_received',
    entityType: 'order',
    entityId: 'GDZ1001',
    channel: 'email',
    audience: 'customer',
    recipient: 'Ravi@Example.test',
  };
  assert.equal(dedupeKey(base), dedupeKey({ ...base, recipient: ' ravi@example.test ' }));
  assert.equal(
    dedupeKey(base),
    'payment_received:order:GDZ1001:email:customer:ravi@example.test:once',
  );
});

test('a token distinguishes legitimate repeats without breaking the key', () => {
  const base = {
    event: 'refund_requested',
    entityType: 'order',
    entityId: 'GDZ1001',
    channel: 'email',
    audience: 'customer',
    recipient: 'ravi@example.test',
  };
  assert.notEqual(dedupeKey({ ...base, token: 'req_1' }), dedupeKey({ ...base, token: 'req_2' }));
  assert.equal(dedupeKey({ ...base, token: 'req:1/2' }), dedupeKey({ ...base, token: 'req12' }));
});

test('in-app dedupe does not depend on a recipient address', () => {
  const base = {
    event: 'order_placed',
    entityType: 'order',
    entityId: 'GDZ1001',
    channel: 'inapp',
    audience: 'staff',
  };
  assert.equal(dedupeKey({ ...base, recipient: '' }), dedupeKey({ ...base, recipient: 'staff' }));
});

test('retry delay doubles and is capped', () => {
  assert.equal(retryDelaySeconds(1), 60);
  assert.equal(retryDelaySeconds(2), 120);
  assert.equal(retryDelaySeconds(3), 240);
  assert.equal(retryDelaySeconds(4), 480);
  assert.equal(retryDelaySeconds(5), 960);
  assert.equal(retryDelaySeconds(99), 3600);
  assert.equal(MAX_NOTIFICATION_ATTEMPTS, 5);
});
