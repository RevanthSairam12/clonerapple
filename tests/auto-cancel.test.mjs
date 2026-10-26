import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ABANDONED_HOURS,
  autoCancelCutoffHours,
  autoCancelReason,
  isAutoCancelDue,
  parseAutoCancelHours,
} from '../src/lib/orders/auto-cancel-rules.ts';

test('the setting is a whole number of hours; zero or junk means unset', () => {
  assert.equal(parseAutoCancelHours(''), 0);
  assert.equal(parseAutoCancelHours('0'), 0);
  assert.equal(parseAutoCancelHours('abc'), 0);
  assert.equal(parseAutoCancelHours('-4'), 0);
  assert.equal(parseAutoCancelHours('24'), 24);
  assert.equal(parseAutoCancelHours('24.9'), 24);
});

test('zero keeps the two-hour abandoned-checkout fallback', () => {
  assert.equal(DEFAULT_ABANDONED_HOURS, 2);
  assert.equal(autoCancelCutoffHours(0), 2);
  assert.equal(autoCancelCutoffHours(24), 24);
  assert.equal(autoCancelCutoffHours(1), 1);
});

test('the cutoff is inclusive and ignores malformed dates', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  assert.equal(isAutoCancelDue('2026-10-26T09:59:00Z', now, 0), true);
  assert.equal(isAutoCancelDue('2026-10-26T10:01:00Z', now, 0), false);
  assert.equal(isAutoCancelDue('2026-10-26T11:00:00Z', now, 1), true);
  assert.equal(isAutoCancelDue('2026-10-25T12:01:00Z', now, 24), false);
  assert.equal(isAutoCancelDue('2026-10-25T11:59:00Z', now, 24), true);
  assert.equal(isAutoCancelDue('not-a-date', now, 24), false);
});

test('the cancellation reason names the configured window', () => {
  assert.equal(autoCancelReason(0), 'Abandoned checkout expired after 2 hours');
  assert.equal(autoCancelReason(24), 'Unpaid order cancelled after 24 hours');
  assert.equal(autoCancelReason(1), 'Unpaid order cancelled after 1 hour');
});
