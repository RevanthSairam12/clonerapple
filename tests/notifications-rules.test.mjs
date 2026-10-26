import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NOTIFICATION_RETENTION_DAYS,
  MAX_NOTIFICATION_ATTEMPTS,
  cleanPhone,
  dedupeKey,
  normalizeEmail,
  normalizePhone,
  notificationRetentionDays,
  retentionCutoff,
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

test('retention is off unless switched on, and defaults to 90 days', () => {
  assert.equal(notificationRetentionDays({}), null);
  assert.equal(notificationRetentionDays({ NOTIFICATION_RETENTION_ENABLED: 'off' }), null);
  assert.equal(notificationRetentionDays({ NOTIFICATION_RETENTION_ENABLED: 'no' }), null);
  assert.equal(
    notificationRetentionDays({ NOTIFICATION_RETENTION_ENABLED: 'on' }),
    DEFAULT_NOTIFICATION_RETENTION_DAYS,
  );
  assert.equal(
    notificationRetentionDays({
      NOTIFICATION_RETENTION_ENABLED: 'true',
      NOTIFICATION_RETENTION_DAYS: '30',
    }),
    30,
  );
  // Junk or a zero does not make the job clear today's messages.
  assert.equal(
    notificationRetentionDays({
      NOTIFICATION_RETENTION_ENABLED: '1',
      NOTIFICATION_RETENTION_DAYS: 'abc',
    }),
    DEFAULT_NOTIFICATION_RETENTION_DAYS,
  );
  assert.equal(
    notificationRetentionDays({
      NOTIFICATION_RETENTION_ENABLED: '1',
      NOTIFICATION_RETENTION_DAYS: '0',
    }),
    DEFAULT_NOTIFICATION_RETENTION_DAYS,
  );
  // A huge value is clamped rather than trusted.
  assert.equal(
    notificationRetentionDays({
      NOTIFICATION_RETENTION_ENABLED: '1',
      NOTIFICATION_RETENTION_DAYS: '999999',
    }),
    3650,
  );
});

test('the retention cutoff is exactly N days back and never today', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');
  assert.equal(retentionCutoff(90, now).toISOString(), '2026-07-28T12:00:00.000Z');
  assert.equal(retentionCutoff(1, now).toISOString(), '2026-10-25T12:00:00.000Z');
  assert.equal(retentionCutoff(0, now).toISOString(), '2026-10-25T12:00:00.000Z');
});
