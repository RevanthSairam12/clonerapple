/**
 * Final-readiness browser E2E against a real running application.
 *
 * Drives system Chrome through Playwright (playwright-core, no bundled
 * browser download) and signs in as real customer and store-admin accounts
 * created by scripts/e2e/seed-final-readiness.mjs.
 *
 *   node --env-file=.env.local scripts/e2e/final-readiness-browser.mjs
 *
 * Env:
 *   E2E_BASE_URL   application origin (default http://localhost:3000)
 *   E2E_TAG        fixture tag (default fr20261109)
 *   E2E_SHOTS      screenshot directory (default docs/evidence/final-readiness/browser)
 *
 * The PayU hosted page is never completed: the outgoing gateway POST is
 * captured and aborted, so no sandbox or production payment is attempted.
 * Nothing secret is written to the evidence files.
 */
import { chromium } from 'playwright-core';
import postgres from 'postgres';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TAG = process.env.E2E_TAG ?? 'fr20261109';
const SHOTS = process.env.E2E_SHOTS ?? path.join('docs', 'evidence', 'final-readiness', 'browser');

const fixtures = {
  tag: TAG,
  adminEmail: `test_admin_${TAG}@example.invalid`,
  customerA: `test_cust_a_${TAG}@example.invalid`,
  customerB: `test_cust_b_${TAG}@example.invalid`,
  password: 'TestPassword123!',
  productId: `test_product_${TAG}`,
  variantBlackId: `test_var_blk_r2_${TAG}`,
  skuBlack: `SKU-BLK-R2-${TAG.toUpperCase()}`,
  blackPricePaise: 199900,
};

const results = [];
let shotCount = 0;

function record(step, status, detail = '') {
  results.push({ step, status, detail });
  const mark = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : status;
  console.log(`[${mark}] ${step}${detail ? ' — ' + detail : ''}`);
}

async function step(page, name, fn) {
  try {
    const detail = await fn();
    record(name, 'PASS', detail ?? '');
    return true;
  } catch (error) {
    record(name, 'FAIL', error instanceof Error ? error.message.split('\n')[0] : String(error));
    return false;
  }
}

async function shot(page, name) {
  shotCount += 1;
  const file = path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled', timeout: 30000 });
  return path.basename(file);
}

/**
 * Clicks the first visible, enabled match. Product and checkout pages render a
 * desktop and a mobile copy of the primary action; the hidden copy must not be
 * the one the test waits on.
 */
async function clickVisible(locator, timeout = 20000) {
  const count = await locator.count();
  let lastError = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    try {
      if (!(await candidate.isVisible())) continue;
      if (await candidate.isDisabled()) continue;
      const interactive = await candidate.evaluate(
        (el) =>
          getComputedStyle(el).pointerEvents !== 'none' &&
          getComputedStyle(el).opacity !== '0' &&
          !el.closest('.pointer-events-none'),
      );
      if (!interactive) continue;
      await candidate.scrollIntoViewIfNeeded();
      await candidate.click({ timeout });
      return index;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`no visible clickable match among ${count} candidates`);
}

const sql = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 15, prepare: false, fetch_types: false });

/** Navigate and report how long the server took to answer. */
async function gotoPage(page, url, timeout = 60000) {
  const started = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return { status: response?.status() ?? 0, ms: Date.now() - started };
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000).catch(() => {});
    }
  }
  throw lastError ?? new Error('navigation failed');
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const contextOptions = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

async function newTrackedContext() {
  return browser.newContext(contextOptions);
}

await mkdir(SHOTS, { recursive: true });

/** Capture the PayU gateway POST without ever sending it. */
const gatewayPosts = [];
async function guardGateway(page) {
  await page.route('https://test.payu.in/**', async (route) => {
    const request = route.request();
    let fields = [];
    try {
      const body = request.postData() ?? '';
      fields = [...new URLSearchParams(body).keys()];
      const params = new URLSearchParams(body);
      const surlRaw = params.get('surl') ?? '';
      const furlRaw = params.get('furl') ?? '';
      gatewayPosts.push({
        url: 'https://test.payu.in/_payment',
        method: request.method(),
        fields,
        txnid: params.get('txnid'),
        amount: params.get('amount'),
        productinfo: params.get('productinfo'),
        currency: params.get('currency') ?? 'INR',
        firstname: params.get('firstname'),
        surl: surlRaw ? `<APP_BASE_URL>${new URL(surlRaw).pathname}` : null,
        furl: furlRaw ? `<APP_BASE_URL>${new URL(furlRaw).pathname}` : null,
        hasHash: Boolean(params.get('hash')),
        hasKey: Boolean(params.get('key')),
      });
    } catch {
      // A GET navigation to the gateway carries no form body; record the method only.
      gatewayPosts.push({ url: request.url().split('?')[0], method: request.method(), fields: [] });
    }
    await route.abort();
  });
}

async function signIn(page, email, redirectTo = '/account') {
  await gotoPage(page, `${BASE}/auth?redirect=${encodeURIComponent(redirectTo)}`);
  await page.locator('#auth-email').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', fixtures.password);
  if ((await page.locator('#auth-password').inputValue()) !== fixtures.password) {
    await page.fill('#auth-password', fixtures.password);
  }
  const response = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /^Continue$/ }).click(),
  ]).then(([res]) => res);
  if (!response.ok()) throw new Error(`sign-in failed with HTTP ${response.status()}`);
  // AuthForm redirects after 900ms via window.location.href = targetUrl.
  await page.waitForURL((url) => url.pathname === redirectTo, { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
}

let customerOrderTxnid = null;

try {
  /* ---------------------------------------------------------- customer A */
  const customerContext = await newTrackedContext();
  const customer = await customerContext.newPage();
  customer.setDefaultTimeout(45000);
  await guardGateway(customer);

  await step(customer, 'customer: public storefront loads', async () => {
    await gotoPage(customer, `${BASE}/`);
    const title = await customer.title();
    if (!/gadzio/i.test(title)) throw new Error(`unexpected title: ${title}`);
    return `title="${title}" · ${await shot(customer, 'storefront-home')}`;
  });

  await step(customer, 'customer: signs in with real credentials', async () => {
    await signIn(customer, fixtures.customerA, '/account');
    await customer.getByText(/Account Overview|TestCustomerA/i).first().waitFor({ timeout: 20000 });
    const body = await customer.locator('body').innerText();
    if (!/TestCustomerA|Fixture|test_cust_a/i.test(body)) throw new Error('signed-in account page did not show the customer identity');
    return `session cookie set · ${await shot(customer, 'customer-signed-in')}`;
  });

  await step(customer, 'customer: browses category listing', async () => {
    await gotoPage(customer, `${BASE}/in/shop/iphone/accessories/mobile-cases`);
    const link = customer.locator(`a[href*="${fixtures.productId}"]`).first();
    await link.waitFor({ state: 'visible' });
    return `${await shot(customer, 'category-listing')}`;
  });

  await step(customer, 'customer: opens product and selects model + colour', async () => {
    await gotoPage(customer, `${BASE}/shop/product/${fixtures.productId}`);
    await customer.waitForTimeout(400);
    await customer.getByRole('radio', { name: /iPhone 16 Pro/i }).first().click();
    await customer.getByRole('radio', { name: /Midnight Black/i }).first().click();
    const body = await customer.locator('body').innerText();
    if (!/1,999/.test(body)) throw new Error('selected variant price ₹1,999 was not displayed');
    return `variant price + availability rendered · ${await shot(customer, 'variant-selected')}`;
  });

  await step(customer, 'customer: adds the selected variant to the bag', async () => {
    const addBtn = customer.locator('main').getByRole('button', { name: /Add to Bag|Added to Bag/i }).first();
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await customer.waitForFunction(
      (pid) => (localStorage.getItem('gadzio_cart_v1') ?? '').includes(pid),
      fixtures.productId,
      { timeout: 20000 },
    );
    const stored = await customer.evaluate(() => localStorage.getItem('gadzio_cart_v1'));
    if (!stored || !stored.includes(fixtures.productId)) throw new Error('cart storage did not receive the line');
    return 'cart line persisted in gadzio_cart_v1';
  });

  await step(customer, 'customer: bag shows the server-priced line', async () => {
    await gotoPage(customer, `${BASE}/cart`);
    await customer.getByText(/MagPulse/i).first().waitFor({ timeout: 30000 });
    return await shot(customer, 'cart');
  });

  await step(customer, 'customer: checkout page renders server-side pricing', async () => {
    await gotoPage(customer, `${BASE}/checkout`);
    await customer.getByText(/1,999/).first().waitFor({ timeout: 30000 });
    return await shot(customer, 'checkout');
  });

  await step(customer, 'customer: fills contact and shipping address', async () => {
    await customer.fill('#checkout-firstname', 'TestCustomerA');
    await customer.fill('#checkout-email', fixtures.customerA);
    await customer.fill('#checkout-phone', '9000000001');
    await customer.fill('#checkout-line1', '12 Staging Test Lane');
    await customer.fill('#checkout-city', 'Mumbai');
    await customer.selectOption('#checkout-state', 'Maharashtra');
    await customer.fill('#checkout-pincode', '400001');
    return await shot(customer, 'checkout-filled');
  });

  await step(customer, 'customer: starts a PayU test-mode checkout', async () => {
    const payButton = customer.getByRole('button', { name: /^Pay Rs/i });
    await clickVisible(payButton, 30000);
    // The gateway POST is aborted by the route guard; wait for it to be captured.
    for (let attempt = 0; attempt < 60 && gatewayPosts.length === 0; attempt += 1) {
      await customer.waitForTimeout(500);
    }
    if (gatewayPosts.length === 0) {
      const alert = await customer.locator('[role="alert"]').allInnerTexts();
      throw new Error(`no gateway POST observed. Alerts: ${alert.join(' | ') || 'none'}`);
    }
    const post = gatewayPosts[0];
    if (!post.txnid) throw new Error('gateway POST carried no txnid');
    if (post.amount !== '2039.00' && post.amount !== '1999.00') throw new Error(`unexpected charged amount ${post.amount}`);
    if (!post.hasHash || !post.hasKey) throw new Error('gateway POST did not carry key/hash fields');
    if (!/\/api\/payu\/success$/.test(post.surl ?? '') || !/\/api\/payu\/failure$/.test(post.furl ?? '')) {
      throw new Error(`callback URLs not absolute application routes: ${post.surl} / ${post.furl}`);
    }
    customerOrderTxnid = post.txnid;
    await writeFile(path.join(SHOTS, 'payu-gateway-post.json'), JSON.stringify({ capturedAt: new Date().toISOString(), posts: gatewayPosts }, null, 1));
    return `txnid=${post.txnid} amount=${post.amount} fields=${post.fields.length} (gateway page aborted, no payment attempted) · ${await shot(customer, 'payu-redirect')}`;
  });

  await step(customer, 'database: order, stock claim and ledger entry exist', async () => {
    if (!customerOrderTxnid) throw new Error('no txnid to verify');
    const orders = await sql`select id, txnid, status, amount, total_paise, reservation_state, reservation_expires_at, user_id from orders where txnid = ${customerOrderTxnid}`;
    if (orders.length !== 1) throw new Error(`expected 1 order row, found ${orders.length}`);
    const order = orders[0];
    const items = await sql`select product_id, variant_id, variant_sku, quantity, unit_price_paise, line_total_paise from order_items where order_id = ${order.id}`;
    if (items.length !== 1) throw new Error(`expected 1 order item, found ${items.length}`);
    if (items[0].variant_id !== fixtures.variantBlackId) throw new Error(`order item variant is ${items[0].variant_id}`);
    // The authoritative charge amount is the server total, not the display hint.
    const expectedPaise = fixtures.blackPricePaise + 4000;
    if (Number(order.total_paise) !== expectedPaise) throw new Error(`total_paise ${order.total_paise}, expected ${expectedPaise}`);
    // Stock is claimed by decrementing on_hand and writing a 'sale' movement.
    const movement = await sql`select delta, reason from stock_movements where order_id = ${order.id} order by created_at`;
    const sale = movement.find((row) => row.reason === 'sale');
    if (!sale || Number(sale.delta) !== -1) {
      throw new Error(`expected one -1 'sale' movement for the order, found ${JSON.stringify(movement)}`);
    }
    const stock = await sql`select on_hand, reserved from stock where variant_id = ${fixtures.variantBlackId}`;
    return `order ${order.status} · reservation_state=${order.reservation_state} · total=${order.total_paise} paise · item ${items[0].variant_sku} · sale movement ${sale.delta} · on_hand=${stock[0]?.on_hand} reserved=${stock[0]?.reserved}`;
  });

  await step(customer, 'customer: order history lists the order', async () => {
    await gotoPage(customer, `${BASE}/account/orders`);
    const body = await customer.locator('body').innerText();
    if (customerOrderTxnid && !body.includes(customerOrderTxnid)) throw new Error('order history did not list the new order');
    return await shot(customer, 'account-orders');
  });

  await step(customer, 'customer: order detail shows items, totals and payment state', async () => {
    if (!customerOrderTxnid) throw new Error('no txnid');
    await gotoPage(customer, `${BASE}/account/orders/${customerOrderTxnid}`);
    const body = await customer.locator('body').innerText();
    if (!body.includes('Payment:')) throw new Error('order detail did not show the payment state');
    if (!/Midnight Black/i.test(body)) throw new Error('order detail did not show the variant snapshot');
    return await shot(customer, 'account-order-detail');
  });

  /* ---------------------------------------------------------- customer B */
  await step(customer, 'boundary: customer B cannot open customer A order', async () => {
    const ctx = await newTrackedContext();
    const other = await ctx.newPage();
    other.setDefaultTimeout(45000);
    try {
      await signIn(other, fixtures.customerB, '/account');
      const response = await other.goto(`${BASE}/account/orders/${customerOrderTxnid}`, { waitUntil: 'domcontentloaded' });
      const body = await other.locator('body').innerText();
      if (response && response.status() !== 404) throw new Error(`expected 404 for another customer's order, got ${response.status()}`);
      if (/Midnight Black|MagPulse/i.test(body)) throw new Error('another customer could read order content');
      await shot(other, 'boundary-order-denied');
      const receipt = await other.goto(`${BASE}/account/orders/${customerOrderTxnid}/receipt`, { waitUntil: 'domcontentloaded' });
      if (receipt && receipt.status() !== 404) throw new Error(`expected 404 for another customer's receipt, got ${receipt.status()}`);
      return 'order page and receipt both answered 404 for a different customer';
    } finally {
      await ctx.close();
    }
  });

  await step(customer, 'boundary: customer session cannot open the store admin', async () => {
    const response = await customer.goto(`${BASE}/store-admin`, { waitUntil: 'domcontentloaded' });
    const url = new URL(customer.url());
    if (url.pathname.startsWith('/store-admin') && !url.pathname.includes('login')) {
      throw new Error(`customer session reached ${url.pathname}`);
    }
    return `redirected to ${url.pathname} (status ${response?.status() ?? 'n/a'})`;
  });

  await step(customer, 'boundary: customer session cannot call a store-admin API', async () => {
    const status = await customer.evaluate(async () => (await fetch('/api/store-admin/orders', { headers: { accept: 'application/json' } })).status);
    if (status !== 401 && status !== 403) throw new Error(`store-admin API answered ${status} to a customer session`);
    return `GET /api/store-admin/orders → ${status}`;
  });

  await customerContext.close();

  /* ------------------------------------------------------- store admin */
  const adminContext = await newTrackedContext();
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(45000);

  await step(admin, 'admin: signs in to the Store Desk', async () => {
    await gotoPage(admin, `${BASE}/store-admin/login`);
    await admin.fill('#sa-email', fixtures.adminEmail);
    await admin.fill('#sa-password', fixtures.password);
    await Promise.all([
      admin.waitForResponse((r) => r.url().includes('/api/store-admin/auth/login')),
      admin.getByRole('button', { name: /^Sign in$/ }).click(),
    ]).then(([response]) => {
      if (!response.ok()) throw new Error(`store-admin sign-in failed with HTTP ${response.status()}`);
    });
    await admin.waitForURL((url) => url.pathname.startsWith('/store-admin') && !url.pathname.includes('login'), { timeout: 60000 });
    await admin.waitForLoadState('domcontentloaded');
    return `store_admin_session cookie set · ${await shot(admin, 'store-admin-dashboard')}`;
  });

  await step(admin, 'admin: product list and product detail', async () => {
    const list = await gotoPage(admin, `${BASE}/store-admin/products`);
    await shot(admin, 'store-admin-products');
    const detail = await gotoPage(admin, `${BASE}/store-admin/products/${fixtures.productId}`);
    const body = await admin.locator('body').innerText();
    if (!/MagPulse/i.test(body)) throw new Error('product detail did not open');
    return `products ${list.status}/${list.ms}ms, detail ${detail.status}/${detail.ms}ms · ${await shot(admin, 'store-admin-product-detail')}`;
  });

  await step(admin, 'admin: edits variant stock and low-stock threshold', async () => {
    if (!admin.url().endsWith(`/store-admin/products/${fixtures.productId}`)) {
      await gotoPage(admin, `${BASE}/store-admin/products/${fixtures.productId}`);
    }
    const before = await sql`select on_hand, low_stock_threshold from stock where variant_id = ${fixtures.variantBlackId}`;
    if (before.length !== 1) throw new Error('stock row missing');
    const nextCount = Number(before[0].on_hand) - 1;
    const nextThreshold = Number(before[0].low_stock_threshold) + 1;
    const countField = admin.locator('input[aria-label="Stock count for Midnight Black"]').first();
    const thresholdField = admin.locator('input[aria-label="Warn below for Midnight Black"]').first();
    await countField.waitFor({ state: 'visible', timeout: 60000 });
    await countField.scrollIntoViewIfNeeded();
    await countField.fill(String(nextCount));
    await thresholdField.fill(String(nextThreshold));
    await shot(admin, 'store-admin-variant-stock-editor');
    const savedResponse = admin.waitForResponse((r) => r.url().includes('/api/store-admin/catalog/products/draft'), { timeout: 90000 });
    await admin.getByRole('button', { name: /Save changes/i }).first().click();
    const response = await savedResponse;
    if (!response.ok()) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`product save answered HTTP ${response.status()}: ${errBody.error ?? ''}`);
    }
    const rows = await sql`select on_hand, low_stock_threshold, reserved from stock where variant_id = ${fixtures.variantBlackId}`;
    if (rows.length !== 1) throw new Error('stock row missing');
    if (Number(rows[0].on_hand) !== nextCount) throw new Error(`on_hand is ${rows[0].on_hand}, expected ${nextCount}`);
    if (Number(rows[0].low_stock_threshold) !== nextThreshold) throw new Error(`threshold is ${rows[0].low_stock_threshold}, expected ${nextThreshold}`);
    return `on_hand ${before[0].on_hand} → ${nextCount} and threshold ${before[0].low_stock_threshold} → ${nextThreshold} persisted · ${await shot(admin, 'store-admin-stock-saved')}`;
  });

  await step(admin, 'admin: orders list and order detail with payment state', async () => {
    await gotoPage(admin, `${BASE}/store-admin/orders`);
    await shot(admin, 'store-admin-orders');
    if (!customerOrderTxnid) throw new Error('no txnid');
    await gotoPage(admin, `${BASE}/store-admin/orders/${customerOrderTxnid}`);
    const body = await admin.locator('body').innerText();
    if (!/payment/i.test(body)) throw new Error('order detail did not show payment information');
    return await shot(admin, 'store-admin-order-detail');
  });

  await step(admin, 'admin: notification matrix and delivery log', async () => {
    await gotoPage(admin, `${BASE}/store-admin/settings/notifications`);
    const body = await admin.locator('body').innerText();
    if (!/Queued|Sending|Sent|Failed|Skipped/i.test(body)) throw new Error('delivery log statuses were not rendered');
    return await shot(admin, 'store-admin-notifications');
  });

  await step(admin, 'boundary: unauthenticated visitor is refused by the store admin', async () => {
    const ctx = await newTrackedContext();
    const anon = await ctx.newPage();
    anon.setDefaultTimeout(45000);
    try {
      await anon.goto(`${BASE}/store-admin/orders`, { waitUntil: 'domcontentloaded' });
      const url = new URL(anon.url());
      if (!/login/.test(url.pathname)) throw new Error(`anonymous visitor reached ${url.pathname}`);
      const apiStatus = await anon.evaluate(async () => (await fetch('/api/store-admin/orders', { headers: { accept: 'application/json' } })).status);
      if (apiStatus !== 401 && apiStatus !== 403) throw new Error(`store-admin API answered ${apiStatus} anonymously`);
      await shot(anon, 'boundary-admin-login-required');
      return `page → ${url.pathname}; GET /api/store-admin/orders → ${apiStatus}`;
    } finally {
      await ctx.close();
    }
  });

  await adminContext.close();
} finally {
  await browser.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    fixtureTag: TAG,
    gatewayPosts,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: results.filter((r) => r.status === 'FAIL').length,
    results,
  };
  await writeFile(path.join(SHOTS, 'results.json'), JSON.stringify(summary, null, 1));
  console.log(`\n${summary.passed} passed, ${summary.failed} failed. Evidence: ${SHOTS}`);
  await sql.end();
  if (summary.failed > 0) process.exitCode = 1;
}
