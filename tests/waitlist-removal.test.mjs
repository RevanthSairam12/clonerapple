/**
 * The waiting list is gone from the product, not merely switched off.
 *
 * Files, routes, settings, notification topics and the reconcile tick must all
 * stop referring to it; the database tables stay behind untouched (migrations
 * are additive). The one deliberate exception is the cleanup routine that
 * returns any held units: it is named after what it removes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { SETTING_KEYS, DEFAULT_SETTINGS } = await jiti.import(
  '../src/lib/store-admin/settings-rules.ts',
);
const { NOTIFICATION_EVENTS } = await jiti.import('../src/lib/notifications/types.ts');
const { NOTIFICATION_TOPICS } = await jiti.import(
  '../src/lib/store-admin/notification-settings.ts',
);
const { DEFAULT_RESERVATION_POLICY, parseReservationPolicy } = await jiti.import(
  '../src/lib/checkout/reservation-rules.ts',
);

const REMOVED_FILES = [
  'src/lib/waitlist/store.ts',
  'src/lib/waitlist/rules.ts',
  'src/app/api/waitlist/route.ts',
  'src/app/waitlist/claim/page.tsx',
  'src/components/waitlist/WaitlistPanel.tsx',
];

test('waiting-list files, route and panel no longer exist', async () => {
  for (const relative of REMOVED_FILES) {
    await assert.rejects(
      () => access(path.join(root, relative)),
      `${relative} must be deleted`,
    );
  }
});

test('no storefront page or checkout component renders or posts a waitlist', async () => {
  const sources = [
    'src/app/shop/product/[productId]/page.tsx',
    'src/components/shop/ProductDetailPage.tsx',
    'src/components/sites/accessories/AccessoryDetailPage.tsx',
    'src/app/checkout/page.tsx',
    'src/components/checkout/CheckoutForm.tsx',
    'src/app/api/payu/initiate/route.ts',
  ];
  for (const relative of sources) {
    const text = await readFile(path.join(root, relative), 'utf8');
    assert.equal(/waitlist|waiting[- ]list|reservationToken/i.test(text), false, relative);
  }
});

test('the reconcile tick only reconciles orders', async () => {
  const text = await readFile(path.join(root, 'src/lib/payu/reconcile.ts'), 'utf8');
  assert.equal(/waitlist|waiting[- ]list|invitation/i.test(text), false);
  assert.equal(/"waitingList"/.test(text), false);
});

test('waiting-list settings are no longer offered or read', () => {
  for (const key of ['waitlist_enabled', 'waitlist_claim_minutes', 'waitlist_retry_minutes']) {
    assert.equal(SETTING_KEYS.includes(key), false, `${key} must leave the settings catalogue`);
    assert.equal(key in DEFAULT_SETTINGS, false);
  }

  assert.deepEqual(Object.keys(DEFAULT_RESERVATION_POLICY).sort(), [
    'failureGraceSeconds',
    'reservationSeconds',
    'unresolvedMinutes',
  ]);
  assert.deepEqual(parseReservationPolicy({ waitlist_enabled: 'on' }), DEFAULT_RESERVATION_POLICY);
});

test('waiting-list notification topics are gone from the matrix and templates', () => {
  assert.equal(NOTIFICATION_EVENTS.includes('waitlist_joined'), false);
  assert.equal(NOTIFICATION_EVENTS.includes('waitlist_invite'), false);
  assert.equal(
    NOTIFICATION_TOPICS.some((topic) => topic.value.startsWith('waitlist_')),
    false,
  );

  return readFile(path.join(root, 'src/lib/notifications/templates.ts'), 'utf8').then((text) => {
    assert.equal(/waitlist_joined|waitlist_invite/.test(text), false);
  });
});

test('the cleanup routine is the only code that still knows about holds', async () => {
  const text = await readFile(path.join(root, 'src/lib/payu/waitlist-cleanup.ts'), 'utf8');
  assert.match(text, /status = 'HELD'/);
  assert.match(text, /set reserved = greatest\(0, reserved - /);
});
