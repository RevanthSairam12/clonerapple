/**
 * Maintenance mode.
 *
 * The decision must be exact at the window boundaries, must use the database
 * clock, must block every customer page and purchase API, must never block a
 * callback or an admin route, and must fail open when the settings cannot be
 * read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});
const maintenance = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'maintenance.ts'),
);
const view = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'maintenance-view.ts'),
);
const settingsRules = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'settings-rules.ts'),
);

const {
  evaluateMaintenance,
  shouldBlockPath,
  isAlwaysAllowed,
  isStorefrontPath,
  isBlockedPurchaseApi,
  maintenanceStatus,
  maintenanceOff,
  stateFromRow,
  maintenanceMessage,
  formatEndsAt,
} = maintenance;

const ON = '2026-10-30T10:00:00.000Z';
const OFF = '2026-10-30T12:00:00.000Z';

/* ------------------------------------------------------------- window */

test('with no window, the toggle alone decides', () => {
  assert.equal(
    evaluateMaintenance({ enabled: true, startsAt: null, endsAt: null }, Date.parse(ON)),
    true,
  );
  assert.equal(
    evaluateMaintenance({ enabled: false, startsAt: null, endsAt: null }, Date.parse(ON)),
    false,
  );
});

test('the window is inclusive at the start and exclusive at the end', () => {
  const window = { enabled: true, startsAt: ON, endsAt: OFF };
  assert.equal(evaluateMaintenance(window, Date.parse(ON) - 1), false, 'before start');
  assert.equal(evaluateMaintenance(window, Date.parse(ON)), true, 'exactly at start');
  assert.equal(evaluateMaintenance(window, Date.parse(ON) + 1), true, 'inside');
  assert.equal(evaluateMaintenance(window, Date.parse(OFF) - 1), true, 'last millisecond');
  assert.equal(evaluateMaintenance(window, Date.parse(OFF)), false, 'exactly at end');
  assert.equal(evaluateMaintenance(window, Date.parse(OFF) + 1), false, 'after end');
});

test('a one-sided window works in both directions', () => {
  assert.equal(
    evaluateMaintenance({ enabled: true, startsAt: ON, endsAt: null }, Date.parse(ON) - 1),
    false,
  );
  assert.equal(
    evaluateMaintenance({ enabled: true, startsAt: null, endsAt: OFF }, Date.parse(OFF)),
    false,
  );
  assert.equal(
    evaluateMaintenance({ enabled: true, startsAt: null, endsAt: OFF }, Date.parse(ON)),
    true,
  );
});

test('an unparseable bound is ignored rather than pinning the shop closed', () => {
  assert.equal(
    evaluateMaintenance({ enabled: true, startsAt: 'not-a-date', endsAt: 'also-bad' }, Date.parse(ON)),
    true,
  );
});

/* -------------------------------------------------------------- paths */

const STOREFRONT = [
  '/',
  '/shop',
  '/shop/product/gdz-1',
  '/shop/buy/gdz-1',
  '/in/shop/iphone/accessories/mobile-cases',
  '/in/shop/iphone/accessories/cases-protection',
  '/search',
  '/support',
  '/android',
  '/cart',
  '/bag',
  '/checkout',
  '/auth',
  '/account',
  '/account/orders',
  '/account/profile',
];

const PURCHASE_APIS = [
  '/api/payu/initiate',
  '/api/coupons/validate',
  '/api/catalog/availability',
  '/api/account/profile',
  '/api/account/addresses',
  '/api/account/orders',
];

const ALLOWED = [
  '/store-admin',
  '/store-admin/settings',
  '/store-admin/settings/storefront',
  '/api/store-admin/settings',
  '/store-admin/website',
  '/store-admin/website/content',
  '/store-admin/website/theme',
  '/api/store-admin/website/content',
  '/api/store-admin/website/theme',
  '/api/admin/media/legacy-id',
  '/api/payu/success',
  '/api/payu/failure',
  '/api/payu/cancel',
  '/api/payu/webhook',
  '/api/payu/reconcile',
  '/order/success',
  '/order/failed',
  '/order/cancelled',
  '/order/processing',
  '/order/status',
  '/api/media/abc',
  '/maintenance',
  '/favicon.ico',
  '/_next/static/chunks/main.js',
  '/_next/image',
  '/robots.txt',
  '/images/hero.webp',
];

test('every customer storefront page is blocked while maintenance is on', () => {
  for (const pathname of STOREFRONT) {
    assert.equal(shouldBlockPath(pathname, true), true, pathname);
  }
});

test('every purchase API is blocked while maintenance is on', () => {
  for (const pathname of PURCHASE_APIS) {
    assert.equal(shouldBlockPath(pathname, true), true, pathname);
  }
});

test('admin, callbacks, result pages, media and assets always work', () => {
  for (const pathname of ALLOWED) {
    assert.equal(isAlwaysAllowed(pathname), true, `${pathname} should be always allowed`);
    assert.equal(
      shouldBlockPath(pathname, true),
      false,
      `${pathname} must not be blocked during maintenance`,
    );
  }
});

test('nothing is blocked when maintenance is off', () => {
  for (const pathname of [...STOREFRONT, ...PURCHASE_APIS]) {
    assert.equal(shouldBlockPath(pathname, false), false, pathname);
  }
});

test('the Education Store is outside this gate', () => {
  assert.equal(isStorefrontPath('/in-edu/store'), false);
  assert.equal(isAlwaysAllowed('/in-edu/store'), false);
  assert.equal(shouldBlockPath('/in-edu/store', true), false);
});

test('the homepage and prefix matching are exact, not substring', () => {
  assert.equal(isStorefrontPath('/'), true);
  assert.equal(isStorefrontPath('/shopper'), false, 'not a /shop prefix');
  assert.equal(isBlockedPurchaseApi('/api/payu/initiate'), true);
  assert.equal(isBlockedPurchaseApi('/api/payu/success'), false);
});

/* --------------------------------------------------------- fail open */

test('a settings row that cannot be parsed fails open', () => {
  assert.equal(stateFromRow({ db_now: 'not-a-clock' }), null);
  const off = stateFromRow({ db_now: new Date(ON), enabled: 'off' });
  assert.equal(off.active, false);
});

test('a well-formed row is decided, with the database clock', () => {
  const state = stateFromRow({
    db_now: new Date('2026-10-30T10:30:00Z'),
    enabled: 'on',
    message: 'Back soon',
    trade_name: 'Gadzio',
    timezone: 'Asia/Kolkata',
    starts_at: new Date('2026-10-30T10:00:00Z'),
    ends_at: new Date('2026-10-30T11:00:00Z'),
  });
  assert.equal(state.active, true);
  assert.equal(state.message, 'Back soon');
  assert.equal(state.storeName, 'Gadzio');
  assert.equal(state.endsAt, '2026-10-30T11:00:00.000Z');
});

test('a storage outage leaves the store up', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const state = await maintenance.getMaintenanceState();
    assert.equal(state.active, false);
    assert.equal(state.enabled, false);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
    maintenance.clearMaintenanceCache();
  }
});

/* ------------------------------------------------------------- badge */

test('the badge distinguishes live, scheduled and off', () => {
  const base = { ...maintenanceOff(ON) };
  assert.equal(maintenanceStatus({ ...base, active: true, enabled: true }), 'LIVE');
  const later = new Date(Date.parse(ON) + 3_600_000).toISOString();
  const earlier = new Date(Date.parse(ON) - 3_600_000).toISOString();
  assert.equal(
    maintenanceStatus({ ...base, active: false, enabled: true, startsAt: later, endsAt: OFF }),
    'SCHEDULED',
    'start still in the future',
  );
  assert.equal(
    maintenanceStatus({ ...base, active: false, enabled: true, startsAt: earlier, endsAt: earlier }),
    'OFF',
    'a window that already ended is not scheduled',
  );
  assert.equal(maintenanceStatus({ ...base, active: false, enabled: false }), 'OFF');
});

test('a blank message still tells the customer what is happening', () => {
  assert.equal(maintenanceMessage({ ...maintenanceOff(ON), message: '   ' }).length > 0, true);
});

test('the end time is shown in the store timezone', () => {
  const label = formatEndsAt('2026-10-30T12:00:00.000Z', 'Asia/Kolkata');
  assert.match(label ?? '', /30 Oct 2026/);
  assert.match(label ?? '', /5:30|17:30/);
});

/* ------------------------------------------------------------- copy */

test('the real page and the 503 body share one view', () => {
  const state = {
    ...maintenanceOff(ON),
    active: true,
    enabled: true,
    message: 'Back at noon',
    storeName: 'Gadzio',
    endsAt: '2026-10-30T12:00:00.000Z',
    timeZone: 'Asia/Kolkata',
  };
  const model = view.maintenanceView(state);
  const html = view.renderMaintenanceDocument(model);
  assert.match(html, /Back at noon/);
  assert.match(html, /Gadzio/);
  assert.match(html, /30 Oct 2026/);
  assert.match(html, /noindex/);
  assert.equal(model.message, 'Back at noon');

  const page = read('src/app/maintenance/page.tsx');
  assert.match(page, /robots:\s*\{ index: false/);
  assert.match(page, /maintenanceView\(state\)/);
});

test('the 503 body escapes owner-authored text', () => {
  const model = view.maintenanceView({
    ...maintenanceOff(ON),
    message: '<script>alert(1)</script>',
    storeName: 'A & B',
  });
  const html = view.renderMaintenanceDocument(model);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
});

/* --------------------------------------------------------- settings */

test('only an owner may change maintenance settings', () => {
  for (const key of [
    'maintenance_enabled',
    'maintenance_message',
    'maintenance_starts_at',
    'maintenance_ends_at',
  ]) {
    assert.equal(settingsRules.isOwnerOnlySetting(key), true, key);
  }
  assert.equal(settingsRules.isOwnerOnlySetting('trade_name'), false);
});

test('the maintenance keys exist with the documented defaults', () => {
  assert.equal(settingsRules.DEFAULT_SETTINGS.maintenance_enabled, 'off');
  assert.ok(settingsRules.SETTING_FIELDS.some((field) => field.key === 'maintenance_ends_at'));
});

/* ------------------------------------------------------ wiring proof */

test('the purchase routes enforce the guard in the route as well as the proxy', () => {
  for (const file of [
    'src/app/api/payu/initiate/route.ts',
    'src/app/api/coupons/validate/route.ts',
    'src/app/api/catalog/availability/route.ts',
  ]) {
    assert.match(read(file), /requireStorefrontOpen/, file);
  }
  assert.match(read('src/lib/account/auth.ts'), /requireStorefrontOpen/);
});

test('PayU callbacks are never guarded, so an in-flight payment still settles', () => {
  for (const file of [
    'src/app/api/payu/success/route.ts',
    'src/app/api/payu/failure/route.ts',
    'src/app/api/payu/cancel/route.ts',
    'src/app/api/payu/webhook/route.ts',
  ]) {
    assert.doesNotMatch(read(file), /maintenance|requireStorefrontOpen/, file);
  }
});

test('the proxy reads maintenance before doing any other work', () => {
  const proxy = read('src/proxy.ts');
  assert.match(proxy, /shouldBlockPath/);
  assert.match(proxy, /Retry-After/);
  assert.match(proxy, /status: 503/);
});
