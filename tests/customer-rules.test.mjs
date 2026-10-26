import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  anonymisedEmail,
  blockReasonError,
  deviceLabel,
  parseCustomerFilters,
  parseIsoDay,
  parseSpend,
  validateCustomerSettingValue,
  validateSubscriberEmail,
  unsubscribeReasonError,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'customer-rules.ts'));

/* --------------------------------------------------------------- dates */

test('iso days are validated by round-trip, not by regex alone', () => {
  assert.equal(parseIsoDay('2026-10-24').toISOString(), '2026-10-24T00:00:00.000Z');
  assert.equal(parseIsoDay('2026-02-30'), null);
  assert.equal(parseIsoDay('2026-13-01'), null);
  assert.equal(parseIsoDay('24-10-2026'), null);
  assert.equal(parseIsoDay('1999-12-31'), null);
});

test('spend accepts rupees with at most two decimals', () => {
  assert.equal(parseSpend('0'), 0);
  assert.equal(parseSpend('1299'), 1299);
  assert.equal(parseSpend('1299.50'), 1299.5);
  assert.equal(parseSpend('1,299'), null);
  assert.equal(parseSpend('-5'), null);
  assert.equal(parseSpend('1.234'), null);
  assert.equal(parseSpend(''), null);
});

/* ------------------------------------------------------------- filters */

test('empty filters fall back to the defaults', () => {
  const parsed = parseCustomerFilters({});
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.filters, {
    query: '',
    type: 'all',
    status: 'all',
    orders: 'all',
    fromIso: null,
    toIso: null,
    minSpend: null,
    maxSpend: null,
    page: 1,
  });
});

test('known values pass through and unknown enum values fall back', () => {
  const parsed = parseCustomerFilters({
    q: '  ravi  ',
    type: 'guest',
    status: 'blocked',
    orders: 'no',
    page: '3',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.query, 'ravi');
  assert.equal(parsed.filters.type, 'guest');
  assert.equal(parsed.filters.status, 'blocked');
  assert.equal(parsed.filters.orders, 'no');
  assert.equal(parsed.filters.page, 3);

  const fallback = parseCustomerFilters({ type: 'aliens', status: 'x', orders: 'y', page: '-1' });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.filters.type, 'all');
  assert.equal(fallback.filters.status, 'all');
  assert.equal(fallback.filters.orders, 'all');
  assert.equal(fallback.filters.page, 1);
});

test('the end date becomes the exclusive start of the following day', () => {
  const parsed = parseCustomerFilters({ from: '2026-10-01', to: '2026-10-24' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.fromIso, '2026-10-01T00:00:00.000Z');
  assert.equal(parsed.filters.toIso, '2026-10-25T00:00:00.000Z');
});

test('bad dates and inverted ranges are reported', () => {
  assert.match(parseCustomerFilters({ from: '2026-02-30' }).error, /start date/);
  assert.match(parseCustomerFilters({ to: 'soon' }).error, /end date/);
  assert.match(
    parseCustomerFilters({ from: '2026-10-10', to: '2026-10-01' }).error,
    /before the start/,
  );
});

test('spend ranges are parsed and checked for order', () => {
  const parsed = parseCustomerFilters({ min: '500', max: '5000' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.filters.minSpend, 500);
  assert.equal(parsed.filters.maxSpend, 5000);

  assert.match(parseCustomerFilters({ min: 'lots' }).error, /minimum spend/);
  assert.match(parseCustomerFilters({ max: '-1' }).error, /maximum spend/);
  assert.match(parseCustomerFilters({ min: '900', max: '100' }).error, /below the minimum/);
});

/* --------------------------------------------------------- subscribers */

test('subscriber emails are normalised and validated', () => {
  assert.deepEqual(validateSubscriberEmail('  Ravi@Example.COM '), {
    ok: true,
    email: 'ravi@example.com',
  });
  assert.equal(validateSubscriberEmail('').ok, false);
  assert.equal(validateSubscriberEmail('not-an-email').ok, false);
  assert.equal(validateSubscriberEmail('a@b').ok, false);
  assert.equal(validateSubscriberEmail(`${'a'.repeat(250)}@example.com`).ok, false);
});

/* ------------------------------------------------------------ settings */

test('customer settings accept only their documented values', () => {
  assert.deepEqual(validateCustomerSettingValue('guest_checkout', 'ON'), {
    ok: true,
    value: 'on',
  });
  assert.equal(validateCustomerSettingValue('guest_checkout', 'maybe').ok, false);
  assert.deepEqual(validateCustomerSettingValue('default_customer_group', 'VIP'), {
    ok: true,
    value: 'vip',
  });
  assert.equal(
    validateCustomerSettingValue('default_customer_group', 'platinum').ok,
    false,
  );
  assert.equal(validateCustomerSettingValue('checkout_marketing_optin', '').ok, false);
});

/* -------------------------------------------------------------- reasons */

test('a block needs a reason of 5-200 characters', () => {
  assert.equal(blockReasonError('fraud'), null);
  assert.match(blockReasonError('bad'), /5-200/);
  assert.match(blockReasonError('x'.repeat(201)), /5-200/);
  assert.match(blockReasonError(''), /5-200/);
});

test('an unsubscribe reason is optional and capped at 300', () => {
  assert.equal(unsubscribeReasonError(''), null);
  assert.equal(unsubscribeReasonError('asked by email'), null);
  assert.match(unsubscribeReasonError('x'.repeat(301)), /300/);
});

/* ---------------------------------------------------------- device label */

test('a user agent becomes a short browser and OS label', () => {
  assert.equal(
    deviceLabel(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    ),
    'Chrome · Windows',
  );
  assert.equal(
    deviceLabel(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    ),
    'Safari · macOS',
  );
  assert.equal(
    deviceLabel(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    ),
    'Safari · iOS',
  );
  assert.equal(
    deviceLabel(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
    ),
    'Edge · Windows',
  );
  assert.equal(deviceLabel(''), 'Unknown device');
  assert.equal(deviceLabel('something odd'), 'Unknown device');
});

test('the anonymised address is unique per account and unroutable', () => {
  assert.equal(anonymisedEmail('abc123'), 'deleted-abc123@anonymised.invalid');
  assert.notEqual(anonymisedEmail('abc123'), anonymisedEmail('def456'));
});
