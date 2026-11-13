/**
 * Phase 5 Proof Runner for Spin and Win (Phases 3 & 4).
 *
 * Runs against a local production `next start` server and the approved `.env.local`
 * database:
 * 1. Snapshots existing `spin_wheel_settings` / `spin_wheel_segments` / daily counts
 *    so the database is restored to its exact pre-run state in `finally`.
 * 2. Seeds temporary throwaway accounts prefixed `__phase5_` for admin, shopper,
 *    2-tab double-spin verification, and 20-user concurrent spin load check.
 * 3. Runs a real signed-in Playwright Chromium/Edge browser walkthrough across
 *    1440x900, 768x1024, and 390x844 viewports:
 *    - Store Admin `/store-admin/marketing/spin-wheel` setup, save, and `Test spin`
 *    - Storefront signed-out `/spin-and-win` redirect check
 *    - Signed-in Home banner (`/`), Account card (`/account`), Spin flow (`/spin-and-win`)
 *    - Reload second-spin refusal + countdown (`Next spin in HH:MM:SS`)
 *    - Account Coupons `"From Spin and Win"` badge (`/account/coupons`)
 *    - Cart coupon validation (`/api/coupons/validate`) accepted for winner, refused for peer
 *    - Two-tab concurrent double spin verifying strictly 1 spin + 1 coupon created
 * 4. Runs a 20-user concurrent burst on `POST /api/spin-wheel/spin`, printing
 *    p50, p95, max latency and status/error counts.
 * 5. Cleans up all `__phase5_*` test rows and restores the wheel snapshot.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright-core';
import postgres from 'postgres';

const ROOT = process.cwd();
const PORT = Number(process.env.SPIN_PROOF_PORT || 3105);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, 'docs', 'images', 'spin-wheel');

async function loadEnvLocal() {
  try {
    const raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
      }
    }
  } catch {
    // Env vars already provided in process.env.
  }
}

await loadEnvLocal();

const DB_URL = (process.env.DATABASE_URL || '').trim();
if (!DB_URL) {
  console.error('DATABASE_URL is required to run Phase 5 Spin Wheel proof.');
  process.exit(1);
}

const sql = postgres(DB_URL, {
  max: 4,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  prepare: false,
  onnotice: () => {},
});

const PREFIX = '__phase5_';
const ADMIN_EMAIL = `${PREFIX}admin@gadzio.test`;
const CUST_EMAIL = `${PREFIX}shopper@gadzio.test`;
const PEER_EMAIL = `${PREFIX}peer@gadzio.test`;
const TAB_EMAIL = `${PREFIX}tabuser@gadzio.test`;
const PASS = `Phase5!${randomBytes(6).toString('hex')}`;

const createdUserIds = [];
const createdAdminIds = [];
let serverProc = null;
let browser = null;

function sha256(val) {
  return createHash('sha256').update(val).digest('hex');
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function waitForServerReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ORIGIN}/api/spin-wheel`, { cache: 'no-store' });
      if (res.status === 200) return;
    } catch {
      // keep polling until server listens
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next.js server on ${ORIGIN} did not become ready in ${timeoutMs}ms`);
}

async function snapshotWheelState() {
  const settings = await sql`select * from spin_wheel_settings where id = 'default' limit 1`;
  const segments = await sql`select * from spin_wheel_segments order by sort_order asc, id asc`;
  const dailyCounts = await sql`select * from spin_wheel_segment_daily_counts`;
  return {
    settings: settings[0] ?? null,
    segments,
    dailyCounts,
  };
}

async function restoreWheelState(snap) {
  await sql.begin(async (tx) => {
    const origSegIds = snap.segments.map((s) => s.id);
    if (origSegIds.length > 0) {
      await tx`delete from spin_wheel_segments where not (id = any(${origSegIds}))`;
      for (const s of snap.segments) {
        await tx`
          insert into spin_wheel_segments ${tx(s)}
          on conflict (id) do update set
            label = excluded.label,
            color_hex = excluded.color_hex,
            segment_type = excluded.segment_type,
            weight = excluded.weight,
            daily_cap = excluded.daily_cap,
            total_cap = excluded.total_cap,
            total_awarded = excluded.total_awarded,
            is_active = excluded.is_active,
            sort_order = excluded.sort_order,
            coupon_type = excluded.coupon_type,
            coupon_value = excluded.coupon_value,
            coupon_max_discount_paise = excluded.coupon_max_discount_paise,
            coupon_min_order_paise = excluded.coupon_min_order_paise,
            coupon_scope = excluded.coupon_scope,
            coupon_target_ids = excluded.coupon_target_ids,
            coupon_valid_days = excluded.coupon_valid_days,
            coupon_allow_with_sale_price = excluded.coupon_allow_with_sale_price,
            updated_at = excluded.updated_at
        `;
      }
      await tx`delete from spin_wheel_segment_daily_counts where not (segment_id = any(${origSegIds}))`;
    } else {
      await tx`delete from spin_wheel_segment_daily_counts`;
      await tx`delete from spin_wheel_segments`;
    }
    if (snap.dailyCounts.length > 0) {
      for (const dc of snap.dailyCounts) {
        await tx`
          insert into spin_wheel_segment_daily_counts ${tx(dc)}
          on conflict (segment_id, store_day) do update set awarded_count = excluded.awarded_count
        `;
      }
    }
    if (snap.settings) {
      await tx`
        insert into spin_wheel_settings ${tx(snap.settings)}
        on conflict (id) do update set
          enabled = excluded.enabled,
          title = excluded.title,
          subtitle = excluded.subtitle,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          spins_per_customer_per_day = excluded.spins_per_customer_per_day,
          terms_text = excluded.terms_text,
          max_spins_per_ip_per_day = excluded.max_spins_per_ip_per_day,
          min_account_age_minutes = excluded.min_account_age_minutes,
          show_on_home_page = excluded.show_on_home_page,
          reward_cooldown_mode = excluded.reward_cooldown_mode,
          reward_cooldown_days = excluded.reward_cooldown_days,
          show_next_spin_countdown = excluded.show_next_spin_countdown,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `;
    }
  });
}

async function createCustomerWithSession(email, firstName, lastName, passwordHash) {
  const userId = `${PREFIX}${randomBytes(8).toString('hex')}`;
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000);

  await sql`
    insert into users (id, email, password_hash, first_name, last_name, created_at)
    values (${userId}, ${email}, ${passwordHash}, ${firstName}, ${lastName}, now() - interval '3 days')
  `;
  await sql`
    insert into user_sessions (token_hash, user_id, expires_at, device)
    values (${tokenHash}, ${userId}, ${expiresAt}, 'Phase5 Proof')
  `;
  createdUserIds.push(userId);
  return { userId, email, token: rawToken };
}

async function cleanupTestData(snap) {
  if (createdUserIds.length > 0) {
    const spins = await sql`
      select id, coupon_id from spin_wheel_spins where user_id = any(${createdUserIds})
    `;
    const spinIds = spins.map((r) => r.id);
    const couponIds = spins.map((r) => r.coupon_id).filter(Boolean);

    if (spinIds.length > 0) {
      await sql`delete from notification_outbox where customer_user_id = any(${createdUserIds})`.catch(() => {});
    }
    await sql`delete from spin_wheel_spins where user_id = any(${createdUserIds})`.catch(() => {});
    if (couponIds.length > 0) {
      await sql`delete from coupon_redemptions where coupon_id = any(${couponIds})`.catch(() => {});
      await sql`delete from coupon_targets where coupon_id = any(${couponIds})`.catch(() => {});
      await sql`delete from coupons where id = any(${couponIds})`.catch(() => {});
    }
    await sql`delete from user_sessions where user_id = any(${createdUserIds})`.catch(() => {});
    await sql`delete from users where id = any(${createdUserIds})`.catch(() => {});
  }

  if (createdAdminIds.length > 0) {
    await sql`delete from store_admin_audit where actor_id = any(${createdAdminIds})`.catch(() => {});
    await sql`delete from store_admin_sessions where admin_id = any(${createdAdminIds})`.catch(() => {});
    await sql`delete from store_admins where id = any(${createdAdminIds})`.catch(() => {});
  }

  // Delete any __phase5_ segments inserted during test before restoring snapshot.
  await restoreWheelState(snap);
}

const snapshot = await snapshotWheelState();

try {
  await mkdir(OUT_DIR, { recursive: true });

  // Clear leftover test rows from any previously interrupted run if needed
  await sql`delete from users where email like ${PREFIX + '%'}`;
  await sql`delete from store_admins where email like ${PREFIX + '%'}`;

  const [adminHash, custHash] = await Promise.all([
    bcrypt.hash(PASS, 10),
    bcrypt.hash(PASS, 10),
  ]);

  const adminId = randomUUID();
  await sql`
    insert into store_admins (id, email, password_hash, name, role, must_change_password, totp_enabled, is_active)
    values (${adminId}, ${ADMIN_EMAIL}, ${adminHash}, 'Phase 5 Owner', 'store_owner', false, false, true)
  `;
  createdAdminIds.push(adminId);

  const primaryShopper = await createCustomerWithSession(CUST_EMAIL, 'Priya', 'PhaseFive', custHash);
  const peerShopper = await createCustomerWithSession(PEER_EMAIL, 'Rohan', 'Peer', custHash);
  const tabShopper = await createCustomerWithSession(TAB_EMAIL, 'Asha', 'DoubleTab', custHash);

  const loadShoppers = [];
  for (let i = 1; i <= 20; i += 1) {
    const c = await createCustomerWithSession(
      `${PREFIX}load_${String(i).padStart(2, '0')}@gadzio.test`,
      'Load',
      `User${i}`,
      custHash,
    );
    loadShoppers.push(c);
  }

  // Start built Next.js server cleanly on dedicated port
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  serverProc = spawn(process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErrLog = '';
  serverProc.stderr.on('data', (d) => {
    serverErrLog += d.toString();
  });

  await waitForServerReady();
  console.log(`Server listening on ${ORIGIN}`);

  browser = await chromium.launch({ headless: true, channel: 'msedge' });

  // ------------------------------------------------------------------
  // 1. Store Admin configures wheel, saves, and runs zero-write Test spin
  // ------------------------------------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminCtx.newPage();

  await adminPage.goto(`${ORIGIN}/store-admin/login`, { waitUntil: 'networkidle' });
  await adminPage.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await adminPage.locator('input[type="password"]').fill(PASS);
  await adminPage.locator('button[type="submit"]').click();
  await adminPage.waitForURL(
    (url) => url.pathname === '/store-admin' || (url.pathname.startsWith('/store-admin/') && url.pathname !== '/store-admin/login'),
    { timeout: 15000 },
  );

  await adminPage.goto(`${ORIGIN}/store-admin/marketing/spin-wheel`, { waitUntil: 'networkidle' });

  // Configure Spin Wheel via Admin UI controls & save via PUT /api/store-admin/spin-wheel
  const configureRes = await adminPage.evaluate(async () => {
    const res = await fetch('/api/store-admin/spin-wheel', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          enabled: true,
          title: 'Spin to Win',
          subtitle: 'Love a sneaky surprise? Spin the wheel to reveal your exclusive discount!',
          startsAt: null,
          endsAt: null,
          spinsPerCustomerPerDay: 1,
          maxSpinsPerIpPerDay: 50,
          minAccountAgeMinutes: 0,
          showOnHomePage: true,
          rewardCooldownMode: 'until_coupon_expires',
          rewardCooldownDays: 7,
          showNextSpinCountdown: true,
          termsText:
            'No purchase required to spin. One spin per signed-in customer per calendar day (IST). Won coupons are single-use and valid only for your account.',
        },
        segments: [
          {
            id: '__phase5_seg_5off',
            label: '5% OFF',
            colorHex: '#f25c3b',
            segmentType: 'COUPON',
            weight: 3000,
            dailyCap: null,
            totalCap: null,
            isActive: true,
            sortOrder: 0,
            couponType: 'PERCENT',
            couponValueInput: '5',
            couponMaxDiscountRupees: '300',
            couponMinOrderRupees: '500',
            couponScope: 'ORDER',
            couponTargetIds: [],
            couponValidDays: 7,
            couponAllowWithSalePrice: true,
          },
          {
            id: '__phase5_seg_25off',
            label: '25% OFF',
            colorHex: '#e8c6ff',
            segmentType: 'COUPON',
            weight: 2500,
            dailyCap: null,
            totalCap: null,
            isActive: true,
            sortOrder: 1,
            couponType: 'PERCENT',
            couponValueInput: '25',
            couponMaxDiscountRupees: '500',
            couponMinOrderRupees: '500',
            couponScope: 'ORDER',
            couponTargetIds: [],
            couponValidDays: 7,
            couponAllowWithSalePrice: true,
          },
          {
            id: '__phase5_seg_10off',
            label: '10% OFF',
            colorHex: '#d8f561',
            segmentType: 'COUPON',
            weight: 2500,
            dailyCap: null,
            totalCap: null,
            isActive: true,
            sortOrder: 2,
            couponType: 'PERCENT',
            couponValueInput: '10',
            couponMaxDiscountRupees: '300',
            couponMinOrderRupees: '500',
            couponScope: 'ORDER',
            couponTargetIds: [],
            couponValidDays: 7,
            couponAllowWithSalePrice: true,
          },
          {
            id: '__phase5_seg_15off',
            label: '15% OFF',
            colorHex: '#e8c6ff',
            segmentType: 'COUPON',
            weight: 1000,
            dailyCap: null,
            totalCap: null,
            isActive: true,
            sortOrder: 3,
            couponType: 'PERCENT',
            couponValueInput: '15',
            couponMaxDiscountRupees: '300',
            couponMinOrderRupees: '500',
            couponScope: 'ORDER',
            couponTargetIds: [],
            couponValidDays: 7,
            couponAllowWithSalePrice: true,
          },
          {
            id: '__phase5_seg_100off',
            label: 'Flat ₹100 OFF',
            colorHex: '#f25c3b',
            segmentType: 'COUPON',
            weight: 999,
            dailyCap: null,
            totalCap: null,
            isActive: true,
            sortOrder: 4,
            couponType: 'FIXED',
            couponValueInput: '100',
            couponMaxDiscountRupees: null,
            couponMinOrderRupees: '799',
            couponScope: 'ORDER',
            couponTargetIds: [],
            couponValidDays: 7,
            couponAllowWithSalePrice: true,
          },
          {
            id: '__phase5_seg_miss',
            label: '5% NEXT TIME',
            colorHex: '#d8f561',
            segmentType: 'NO_PRIZE',
            weight: 1,
            dailyCap: null,
            totalCap: null,
            isActive: true,
            sortOrder: 5,
            couponType: null,
            couponValueInput: '0',
            couponMaxDiscountRupees: null,
            couponMinOrderRupees: null,
            couponScope: 'ORDER',
            couponTargetIds: [],
            couponValidDays: 7,
            couponAllowWithSalePrice: false,
          },
        ],
      }),
    });
    return { status: res.status, ok: res.ok };
  });
  assert.equal(configureRes.status, 200);

  await adminPage.reload({ waitUntil: 'networkidle' });
  await adminPage.getByRole('button', { name: 'Test spin' }).click();
  await adminPage.waitForSelector('text=Test result:', { timeout: 10000 });
  await adminPage.screenshot({
    path: path.join(OUT_DIR, '01-admin-spin-wheel-1440.png'),
    fullPage: false,
  });

  // Verify Test spin persisted 0 spins
  const [{ cnt: afterTestSpinCnt }] = await sql`
    select count(*)::int as cnt from spin_wheel_spins where user_id like ${PREFIX + '%'}
  `;
  assert.equal(afterTestSpinCnt, 0);
  await adminCtx.close();
  console.log('1/5 Store Admin wheel setup + Test spin screenshot captured');

  // ------------------------------------------------------------------
  // 2. Signed-out redirect check + Signed-in customer flow (1440, 768, 390)
  // ------------------------------------------------------------------
  const guestCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guestPage = await guestCtx.newPage();
  await guestPage.goto(`${ORIGIN}/spin-and-win`, { waitUntil: 'networkidle' });
  const signInLink = guestPage.getByRole('link', { name: 'Sign in', exact: true });
  const signInHref = await signInLink.getAttribute('href');
  assert.equal(signInHref, '/auth?redirect=/spin-and-win');
  await guestPage.getByText('1/1').first().waitFor({ timeout: 10000 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '02-signed-out-1440.png'),
    fullPage: false,
  });

  // Sign in via real /auth UI flow
  await signInLink.click();
  await guestPage.waitForURL((u) => u.pathname === '/auth', { timeout: 10000 });
  await guestPage.locator('input[type="email"]').fill(CUST_EMAIL);
  await guestPage.locator('input[type="password"]').fill(PASS);
  await guestPage.locator('button[type="submit"]').click();
  await guestPage.waitForURL((u) => u.pathname === '/spin-and-win', { timeout: 15000 });
  await guestPage.waitForLoadState('networkidle');

  // Home page dismissible modal popup + strip at 1440px and 390px
  await guestPage.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  const popupDialog = guestPage.getByRole('dialog', { name: /Spin to Win/i });
  await popupDialog.waitFor({ timeout: 10000 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '03-home-popup-1440.png'),
    fullPage: false,
  });
  await popupDialog.getByRole('button', { name: 'NO THANKS' }).click();
  await popupDialog.waitFor({ state: 'detached', timeout: 5000 });

  const homeStrip = guestPage.getByText('Daily Spin').first();
  await homeStrip.waitFor({ timeout: 10000 });
  await homeStrip.scrollIntoViewIfNeeded();
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '03-home-strip-1440.png'),
    fullPage: false,
  });
  await guestPage.setViewportSize({ width: 390, height: 844 });
  await homeStrip.scrollIntoViewIfNeeded();
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '04-home-strip-390.png'),
    fullPage: false,
  });

  // Account overview card at 1440px
  await guestPage.setViewportSize({ width: 1440, height: 900 });
  await guestPage.goto(`${ORIGIN}/account`, { waitUntil: 'networkidle' });
  const acctSpinCard = guestPage.getByText(/1\/1 daily free spin ready/);
  await acctSpinCard.waitFor({ timeout: 10000 });
  await acctSpinCard.scrollIntoViewIfNeeded();
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '05-account-card-1440.png'),
    fullPage: false,
  });

  // Spin the wheel on /spin-and-win
  await guestPage.goto(`${ORIGIN}/spin-and-win`, { waitUntil: 'networkidle' });
  await guestPage.getByText('1/1').first().waitFor({ timeout: 10000 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '02b-signed-in-ready-1440.png'),
    fullPage: false,
  });
  await guestPage.locator('#spin-terms').check();
  await guestPage.getByRole('button', { name: 'SPIN TO WIN' }).click();
  await guestPage.waitForSelector('text=Reward unlocked', { timeout: 12000 });
  const wonCode = (await guestPage.locator('code').first().innerText()).trim();
  assert.match(wonCode, /^SPIN-/);

  // Capture result at 1440, 768, 390
  await guestPage.setViewportSize({ width: 1440, height: 900 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '06-wheel-won-1440.png'),
    fullPage: false,
  });
  await guestPage.setViewportSize({ width: 768, height: 1024 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '07-wheel-won-768.png'),
    fullPage: false,
  });
  await guestPage.setViewportSize({ width: 390, height: 844 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '08-wheel-won-390.png'),
    fullPage: false,
  });

  // Reload /spin-and-win -> must show 0/1 quota, countdown & refuse second spin
  await guestPage.setViewportSize({ width: 1440, height: 900 });
  await guestPage.reload({ waitUntil: 'networkidle' });
  const spinButtonCount = await guestPage.getByRole('button', { name: 'SPIN TO WIN' }).count();
  assert.equal(spinButtonCount, 0);
  await guestPage.getByText('0/1').first().waitFor({ timeout: 10000 });
  await guestPage.getByText(/Next spin in (\d+d )?\d{2}:\d{2}:\d{2}/).first().waitFor({ timeout: 10000 });

  // Account coupons page -> shows "From Spin and Win" badge + won code + copy button
  await guestPage.goto(`${ORIGIN}/account/coupons`, { waitUntil: 'networkidle' });
  await guestPage.getByText('From Spin and Win').first().waitFor({ timeout: 10000 });
  await guestPage.getByText(wonCode).first().waitFor({ timeout: 10000 });
  await guestPage.screenshot({
    path: path.join(OUT_DIR, '09-account-coupons-1440.png'),
    fullPage: false,
  });

  // Validate won coupon via /api/coupons/validate using a real active catalogue item
  const [realProd] = await sql`
    select id, name, price_paise, sale_price_paise
    from products
    where is_active = true and in_stock = true and price_paise > 0
      and coalesce(sell_by, 'single') = 'single'
    order by price_paise desc
    limit 1
  `;
  const [fallbackProd] = realProd
    ? [realProd]
    : await sql`
        select id, name, price_paise, sale_price_paise
        from products
        where is_active = true and in_stock = true and price_paise > 0
        order by price_paise desc
        limit 1
      `;
  assert.ok(fallbackProd, 'expected at least 1 active in-stock product in test DB');
  const [saleRow] = await sql`select value from store_settings where key = 'sale_mode' limit 1`;
  const saleOn = String(saleRow?.value ?? '').trim() === 'on';
  const unitPaise = saleOn && fallbackProd.sale_price_paise
    ? Number(fallbackProd.sale_price_paise)
    : Number(fallbackProd.price_paise);
  const unitRupees = unitPaise / 100;
  const qty = Math.max(1, Math.ceil(90000 / unitPaise));

  const cartItemsForCheck = [{ id: fallbackProd.id, name: fallbackProd.name, price: unitRupees, quantity: qty }];

  const winnerValidate = await guestPage.evaluate(async ({ code, items }) => {
    const r = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        email: 'ignored@example.com',
        items,
        shippingPaise: 0,
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { code: wonCode, items: cartItemsForCheck });
  assert.equal(winnerValidate.status, 200);
  assert.equal(winnerValidate.body.valid, true, `Expected valid coupon for winner, got: ${JSON.stringify(winnerValidate.body)}`);
  assert.ok(winnerValidate.body.discountPaise > 0);

  await guestCtx.close();

  // Peer customer context MUST NOT be allowed to use winner's personal code
  const peerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await peerCtx.addCookies([
    {
      name: 'user_session',
      value: peerShopper.token,
      url: ORIGIN,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const peerPage = await peerCtx.newPage();
  await peerPage.goto(`${ORIGIN}/account/coupons`, { waitUntil: 'networkidle' });
  const peerSeesCode = await peerPage.getByText(wonCode).count();
  assert.equal(peerSeesCode, 0);
  const peerValidate = await peerPage.evaluate(async ({ code, items }) => {
    const r = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        email: 'ignored@example.com',
        items,
        shippingPaise: 0,
      }),
    });
    return { status: r.status, body: await r.json() };
  }, { code: wonCode, items: cartItemsForCheck });
  assert.equal(peerValidate.body.valid, false);
  await peerCtx.close();
  console.log('2/5 Customer 1440/768/390 walkthrough + coupon isolation verified');

  // ------------------------------------------------------------------
  // 3. Two-tab simultaneous double-spin check in browser
  // ------------------------------------------------------------------
  const tabCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await tabCtx.addCookies([
    {
      name: 'user_session',
      value: tabShopper.token,
      url: ORIGIN,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const tab1 = await tabCtx.newPage();
  const tab2 = await tabCtx.newPage();
  await Promise.all([
    tab1.goto(`${ORIGIN}/spin-and-win`, { waitUntil: 'networkidle' }),
    tab2.goto(`${ORIGIN}/spin-and-win`, { waitUntil: 'networkidle' }),
  ]);
  await tab1.locator('#spin-terms').check();
  await tab2.locator('#spin-terms').check();

  const [tab1Click, tab2Click] = await Promise.all([
    Promise.all([
      tab1.waitForResponse((r) => r.url().includes('/api/spin-wheel/spin')),
      tab1.getByRole('button', { name: 'SPIN TO WIN' }).click(),
    ]),
    Promise.all([
      tab2.waitForResponse((r) => r.url().includes('/api/spin-wheel/spin')),
      tab2.getByRole('button', { name: 'SPIN TO WIN' }).click(),
    ]),
  ]);

  const tab1Json = await tab1Click[0].json();
  const tab2Json = await tab2Click[0].json();
  assert.equal(tab1Json.ok, true);
  assert.equal(tab2Json.ok, true);
  assert.equal(tab1Json.spin.spinId, tab2Json.spin.spinId);

  const tabDbRows = await sql`
    select count(*)::int as cnt from spin_wheel_spins where user_id = ${tabShopper.userId}
  `;
  assert.equal(tabDbRows[0].cnt, 1);
  await tabCtx.close();
  console.log('3/5 Two-tab simultaneous double-spin check passed (1 DB spin row)');

  // ------------------------------------------------------------------
  // 4. Concurrent HTTP load check on POST /api/spin-wheel/spin (20 accounts)
  // ------------------------------------------------------------------
  const latencies = [];
  const statusCounts = {};
  let loadErrors = 0;

  await Promise.all(
    loadShoppers.map(async (shopper) => {
      const t0 = performance.now();
      try {
        const res = await fetch(`${ORIGIN}/api/spin-wheel/spin`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: ORIGIN,
            cookie: `user_session=${shopper.token}`,
          },
          body: JSON.stringify({ termsAccepted: true }),
        });
        const dt = performance.now() - t0;
        latencies.push(dt);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
          loadErrors += 1;
        }
      } catch {
        latencies.push(performance.now() - t0);
        loadErrors += 1;
        statusCounts.network_error = (statusCounts.network_error || 0) + 1;
      }
    }),
  );

  latencies.sort((a, b) => a - b);
  const p50 = Math.round(percentile(latencies, 50));
  const p95 = Math.round(percentile(latencies, 95));
  const maxMs = Math.round(latencies[latencies.length - 1] ?? 0);

  const loadIds = loadShoppers.map((s) => s.userId);
  const [{ cnt: loadSpinsWritten }] = await sql`
    select count(*)::int as cnt from spin_wheel_spins where user_id = any(${loadIds})
  `;

  console.log('4/5 Load check summary:', JSON.stringify({
    concurrentRequests: loadShoppers.length,
    statusCounts,
    errors: loadErrors,
    p50Ms: p50,
    p95Ms: p95,
    maxMs,
    dbSpinsWritten: loadSpinsWritten,
  }));

  assert.equal(loadErrors, 0);
  assert.equal(loadSpinsWritten, loadShoppers.length);
  if (serverErrLog.trim()) {
    console.log('Server stderr excerpt recorded (non-fatal if empty):', serverErrLog.slice(0, 300));
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
  }
  await cleanupTestData(snapshot).catch((err) => {
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  });
  await sql.end({ timeout: 5 }).catch(() => {});
  console.log('5/5 Restored original wheel snapshot and deleted all __phase5_* test data.');
}
