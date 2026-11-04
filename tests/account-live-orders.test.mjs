/**
 * Step 2 — live order data on the customer account.
 *
 * What must hold:
 *   - account reads are never cached, so an order status change is visible on
 *     the next request;
 *   - the poller runs only while the order is in flight and the tab is
 *     visible, and stops the moment the order reaches a final state;
 *   - a poll result only triggers a server re-render when something the
 *     customer sees actually changed;
 *   - Buy again is built from the live storefront read (archived and deleted
 *     products drop out), uses the shared price resolver, and follows the
 *     sale-mode rule that nothing shows as unavailable during a sale;
 *   - every mutation refreshes the cards through router.refresh();
 *   - the live and buy-again endpoints are owner-scoped, no-store, and cheap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const live = await jiti.import(path.join(root, 'src', 'lib', 'account', 'order-live.ts'));
const buyAgain = await jiti.import(path.join(root, 'src', 'lib', 'account', 'buy-again-rules.ts'));
const pricing = await jiti.import(path.join(root, 'src', 'lib', 'storefront', 'pricing.ts'));

const {
  ACCOUNT_ORDER_STATUSES,
  accountOrderStatusLabel,
  isInFlightAccountOrderStatus,
  isFinalAccountOrderStatus,
  liveSignature,
  shouldPollAccountOrder,
  toAccountOrderStatus,
  toDeliverySnapshot,
  toRefundSnapshots,
  toRequestSnapshots,
} = live;
const { BUY_AGAIN_LIMIT, isBuyAgainVisible, selectBuyAgainProductIds } = buyAgain;
const { resolveEffectivePrice } = pricing;

/* ------------------------------------------------------- freshness */

test('every account page is force-dynamic so nothing is shared between customers', () => {
  for (const file of [
    'src/app/account/page.tsx',
    'src/app/account/orders/page.tsx',
    'src/app/account/orders/[txnid]/page.tsx',
    'src/app/account/orders/[txnid]/receipt/page.tsx',
    'src/app/account/addresses/page.tsx',
    'src/app/account/profile/page.tsx',
  ]) {
    assert.match(read(file), /export const dynamic = 'force-dynamic'/, file);
  }
});

test('the live and buy-again endpoints are dynamic and explicitly no-store', () => {
  for (const file of [
    'src/app/api/account/orders/[txnid]/live/route.ts',
    'src/app/api/account/buy-again/[productId]/route.ts',
  ]) {
    const source = read(file);
    assert.match(source, /export const dynamic = 'force-dynamic'/, file);
    assert.match(source, /'Cache-Control': 'no-store'/, file);
  }
});

test('the order queries carry no cache layer of their own', () => {
  const source = read('src/lib/account/orders.ts');
  // A cached read here would serve one customer's order to the next request.
  assert.doesNotMatch(source, /unstable_cache/);
  assert.doesNotMatch(source, /revalidate\s*[:=]/);
});

test('a status change is what the next read returns', () => {
  // The list and the detail both map the view column through one function, so
  // a new sale_state in the database is the new chip on the next request.
  assert.equal(toAccountOrderStatus('PENDING'), 'PENDING');
  assert.equal(toAccountOrderStatus('ON_THE_WAY'), 'ON_THE_WAY');
  assert.equal(toAccountOrderStatus('DELIVERED'), 'DELIVERED');
  assert.equal(toAccountOrderStatus('SOMETHING_NEW'), 'PENDING');
  assert.equal(toAccountOrderStatus(null), 'PENDING');
  assert.match(read('src/lib/account/orders.ts'), /toAccountOrderStatus\(row\.sale_state\)/);
});

/* -------------------------------------------------------- polling */

test('only an in-flight order polls, and only while the tab is visible', () => {
  for (const status of ACCOUNT_ORDER_STATUSES) {
    const inFlight = isInFlightAccountOrderStatus(status);
    assert.equal(isFinalAccountOrderStatus(status), !inFlight, status);
    assert.equal(shouldPollAccountOrder(status, 'visible'), inFlight, `${status} visible`);
    assert.equal(shouldPollAccountOrder(status, 'hidden'), false, `${status} hidden`);
  }
});

test('the in-flight set is exactly the five open statuses', () => {
  const polling = ACCOUNT_ORDER_STATUSES.filter((status) => isInFlightAccountOrderStatus(status));
  assert.deepEqual([...polling], ['PENDING', 'ACCEPTED', 'PROCESSING', 'SCHEDULED', 'ON_THE_WAY']);
  // A delivered or refunded order is final: no further poll is scheduled.
  for (const status of ['DELIVERED', 'CANCELED', 'PAYMENT_FAILED', 'REFUNDED']) {
    assert.equal(shouldPollAccountOrder(status, 'visible'), false, status);
  }
});

test('the poller refuses to start once the rendered status is final', () => {
  const source = read('src/components/account/LiveOrderPoller.tsx');
  assert.match(source, /shouldPollAccountOrder\(statusRef\.current, document\.visibilityState\)/);
  assert.match(source, /LIVE_ORDER_POLL_MS = 30_000/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /'focus'/);
  assert.match(source, /cache: 'no-store'/);
  // Server components re-render; the page is not reloaded.
  assert.match(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /location\.reload/);
});

test('the poller is mounted only for an in-flight order', () => {
  const detail = read('src/app/account/orders/[txnid]/page.tsx');
  assert.match(detail, /isInFlightAccountOrderStatus\(order\.status\)/);
  assert.match(detail, /inFlight && <LiveOrderPoller/);

  const dashboard = read('src/app/account/page.tsx');
  assert.match(dashboard, /latestInFlight && \(/);
  assert.match(dashboard, /<LiveOrderPoller txnid=\{latest\.txnid\}/);
});

test('a poll result re-renders only when something the customer sees changed', () => {
  const base = {
    txnid: 'GDZ-1',
    status: 'PROCESSING',
    paymentStatus: 'PAID',
    fulfilmentStatus: 'PICKING',
    updatedAt: '2026-10-31T10:00:00.000Z',
    delivery: null,
    requests: [],
    refunds: [],
  };
  assert.equal(liveSignature(base), liveSignature({ ...base }), 'equal snapshots are quiet');

  assert.notEqual(liveSignature(base), liveSignature({ ...base, status: 'ON_THE_WAY' }));
  assert.notEqual(liveSignature(base), liveSignature({ ...base, paymentStatus: 'REFUNDED' }));
  assert.notEqual(
    liveSignature(base),
    liveSignature({ ...base, delivery: { status: 'OUT_FOR_DELIVERY', method: null, carrier: null, trackingNumber: 'AWB1', trackingUrl: null } }),
  );
  assert.notEqual(
    liveSignature(base),
    liveSignature({ ...base, requests: [{ id: 'r1', type: 'cancel', status: 'OPEN', createdAt: base.updatedAt, updatedAt: base.updatedAt }] }),
  );
  assert.notEqual(
    liveSignature(base),
    liveSignature({ ...base, refunds: [{ id: 'f1', amountPaise: 49900, currency: 'INR', method: 'upi', status: 'RECORDED', createdAt: base.updatedAt }] }),
  );
  // A repeat poll of the same state must not trigger a refresh loop.
  assert.equal(liveSignature(base), liveSignature({ ...base }));
});

test('the live payload never carries another customer row shape', () => {
  // Only these keys leave the endpoint: no address, no items, no cost.
  const source = read('src/app/api/account/orders/[txnid]/live/route.ts');
  assert.match(source, /getCustomerOrderLiveStatus\(auth\.session\.userId, txnid\)/);
  assert.doesNotMatch(source, /getCustomerOrderDetail/);

  const store = read('src/lib/account/orders.ts');
  const body = store.slice(
    store.indexOf('export async function getCustomerOrderLiveStatus'),
    store.indexOf('export async function getCustomerOrderDetail'),
  );
  assert.match(body, /s\.user_id = \$\{userId\}/);
  assert.doesNotMatch(body, /address/i);
  assert.doesNotMatch(body, /order_items/);
});

test('the live read is one aggregate query, not a fan-out per poll', () => {
  const store = read('src/lib/account/orders.ts');
  const body = store.slice(
    store.indexOf('export async function getCustomerOrderLiveStatus'),
    store.indexOf('export async function getCustomerOrderDetail'),
  );
  const queries = body.match(/await sql\b/g) ?? [];
  assert.equal(queries.length, 1, `expected one query in the live read, found ${queries.length}`);
});

test('the live endpoint answers 404 for a missing or foreign order and never leaks it', () => {
  const route = read('src/app/api/account/orders/[txnid]/live/route.ts');
  assert.match(route, /status: 404/);
  assert.match(route, /'Order not found\.'/);
  // No tenant-independent lookup: the owner id is always part of the query.
  assert.match(read('src/lib/account/orders.ts'), /where s\.txnid = \$\{txnid\} and s\.user_id = \$\{userId\}/);
});

/* ------------------------------------------------------ buy again */

test('buy again dedupes, trims blanks and stays bounded', () => {
  const ids = selectBuyAgainProductIds([
    { product_id: 'a' },
    { product_id: 'a' },
    { product_id: ' b ' },
    { product_id: '' },
    { product_id: 42 },
    { product_id: 'c' },
  ]);
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(selectBuyAgainProductIds(Array.from({ length: 30 }, (_, i) => ({ product_id: `p${i}` }))).length, BUY_AGAIN_LIMIT);
  assert.deepEqual(selectBuyAgainProductIds([{ product_id: 'a' }], 0), []);
  assert.deepEqual(selectBuyAgainProductIds([{ product_id: 'a' }], -3), []);
});

test('buy again follows the storefront stock rule, including sale mode', () => {
  assert.equal(isBuyAgainVisible({ inStock: true }, false), true);
  assert.equal(isBuyAgainVisible({ inStock: false }, false), false, 'normal mode hides sold out');
  assert.equal(isBuyAgainVisible({ inStock: true }, true), true);
  assert.equal(isBuyAgainVisible({ inStock: false }, true), true, 'a sale never shows "not available"');
});

test('buy again resolves prices through the shared resolver, sale only while live', () => {
  const product = { pricePaise: 129900, salePricePaise: 99900 };
  const off = resolveEffectivePrice(product, false);
  assert.equal(off.unitPaise, 129900);
  assert.equal(off.onSale, false);
  const on = resolveEffectivePrice(product, true);
  assert.equal(on.unitPaise, 99900);
  assert.equal(on.onSale, true);
  // A "sale" price that is not lower is never applied.
  assert.equal(resolveEffectivePrice({ pricePaise: 129900, salePricePaise: 149900 }, true).onSale, false);
});

test('buy again is read from the live catalogue, so archived and deleted rows drop out', () => {
  const store = read('src/lib/account/orders.ts');
  const body = store.slice(store.indexOf('export async function listBuyAgainProducts'));
  // Product names, images and prices come from the storefront read, never from
  // the order snapshot: an archived or deleted product simply is not returned.
  assert.match(body, /getStorefrontProducts\(ids\)/);
  assert.match(body, /readSaleState\(\)/);
  assert.match(body, /isBuyAgainVisible\(product, sale\.live\)/);
  assert.match(body, /o\.status = 'PAID'/, 'only paid history counts');
  assert.match(body, /group by oi\.product_id/);
  assert.doesNotMatch(body, /unstable_cache/);
});

test('the click-time re-check is gated on this customer’s own paid history', () => {
  const store = read('src/lib/account/orders.ts');
  const body = store.slice(store.indexOf('export async function getBuyAgainProduct'));
  assert.match(body, /o\.user_id = \$\{userId\}/);
  assert.match(body, /o\.status = 'PAID'/);
  assert.match(body, /oi\.product_id = \$\{productId\}/);
  const route = read('src/app/api/account/buy-again/[productId]/route.ts');
  assert.match(route, /requireAccountSessionApi\(\)/);
  assert.match(route, /getBuyAgainProduct\(auth\.session\.userId, productId\)/);
});

test('adding to the bag re-validates stock and price at click time', () => {
  const source = read('src/components/account/BuyAgainRow.tsx');
  assert.match(source, /\/api\/account\/buy-again\//, 're-reads the product before adding');
  assert.match(source, /stockBlocked\(/, 'applies the shared stock rule to the fresh read');
  assert.match(source, /addItem\(/);
  assert.match(source, /cache: 'no-store'/);
  // The card price is display only; the fresh price is what goes to the bag.
  assert.match(source, /price: current\.pricePaise \/ 100/);
});

/* ------------------------------------------------------ mutations */

test('every account mutation refreshes the server components', () => {
  for (const file of [
    'src/components/account/ProfileManager.tsx',
    'src/components/account/AddressesManager.tsx',
    'src/components/account/OrderRequestButtons.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /useRouter/, file);
    assert.match(source, /router\.refresh\(\)/, file);
  }
});

/* ------------------------------------------------- route boundary */

test('check-account-routes covers every account route, including the new ones', () => {
  const output = execFileSync(process.execPath, [path.join(root, 'scripts', 'check-account-routes.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(output, /api\/account\/orders\/\[txnid\]\/live\/route\.ts: OK/);
  assert.match(output, /api\/account\/buy-again\/\[productId\]\/route\.ts: OK/);
  assert.match(output, /account\/page\.tsx: OK/);
  assert.match(output, /account\/orders\/\[txnid\]\/page\.tsx: OK/);
});

/* ------------------------------------------------- the dashboard */

test('the dashboard summary keeps a bounded number of reads', () => {
  const page = read('src/app/account/page.tsx');
  // Latest order and Buy again are issued together, then the sale switch once.
  assert.match(page, /Promise\.all\(\[/);
  const stores = read('src/lib/account/orders.ts');
  const listBody = stores.slice(stores.indexOf('export async function listCustomerOrders'), stores.indexOf('export async function getLatestCustomerOrder'));
  assert.equal((listBody.match(/await sql\b/g) ?? []).length, 2, 'the orders page: one page of rows plus one count');
  assert.match(listBody, /limit \$\{limit\} offset \$\{offset\}/);
  assert.match(stores, /slice\(0, 8\)/, 'buy again is capped for the dashboard');
});

/* --------------------------------------------------------- labels */

test('statuses only ever render the customer vocabulary', () => {
  for (const status of ACCOUNT_ORDER_STATUSES) {
    const label = accountOrderStatusLabel(status);
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0);
    assert.doesNotMatch(label, /_/, `${status} label must not expose an internal token`);
  }
  assert.doesNotMatch(read('src/components/account/OrderStatusChip.tsx'), /sale_state|fulfilment_status/);
});

test('live payload parsing drops rows the customer vocabulary does not know', () => {
  assert.deepEqual(toRequestSnapshots([{ id: 'r1', type: 'vandalism', status: 'OPEN' }]), []);
  assert.deepEqual(toRequestSnapshots([{ id: 'r1', type: 'cancel', status: 'WEIRD' }]), []);
  assert.equal(toRequestSnapshots([{ id: 'r1', type: 'cancel', status: 'OPEN', created_at: '2026-10-31T10:00:00Z' }]).length, 1);
  assert.deepEqual(toRequestSnapshots('not json'), []);
  assert.equal(toDeliverySnapshot(null), null);
  assert.equal(toDeliverySnapshot({ method: 'STANDARD' }, true), null, 'a delivery row without a status is not a delivery');
  assert.deepEqual(toRefundSnapshots([{ id: 'f1', amount_paise: 'not-money' }]), []);
});

test('a live signature never exposes raw internal enum names to the UI', () => {
  // The signature is compared, not displayed, but it must be built from parsed
  // values so a junk row cannot smuggle an internal token into the payload.
  const snapshot = toDeliverySnapshot({ status: 'OUT_FOR_DELIVERY', tracking_number: 'AWB1' }, true);
  assert.equal(snapshot.trackingNumber, 'AWB1');
  assert.equal(live.accountDeliveryStatusLabel('OUT_FOR_DELIVERY'), 'Out for delivery');
  assert.equal(live.accountPaymentStatusLabel('PAYMENT_REVIEW'), 'Payment under review');
});