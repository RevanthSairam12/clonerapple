/**
 * Phase 4 tests for Customer Spin and Win UI, countdown helpers,
 * wheel rotation math, entry-point gating, and storefront API guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { computeRemainingMs, formatCountdownHms, formatSpinCouponExpiry } =
  await jiti.import(path.join(root, 'src', 'lib', 'spin-wheel', 'countdown.ts'));

const { computeTargetWheelRotation } = await jiti.import(
  path.join(root, 'src', 'lib', 'spin-wheel', 'colors.ts'),
);

async function readRel(relPath) {
  return fs.readFile(path.join(root, relPath), 'utf8');
}

test('countdown helpers format HH:MM:SS and clamp midnight rollover cleanly', () => {
  const target = '2026-11-14T00:00:00.000+05:30';
  const targetMs = Date.parse(target);

  assert.equal(computeRemainingMs(target, targetMs - 3_661_000), 3_661_000);
  assert.equal(formatCountdownHms(3_661_000), '01:01:01');
  assert.equal(formatCountdownHms(86_399_000), '23:59:59');

  // At/after midnight, remaining ms clamps to 0 and renders 00:00:00
  assert.equal(computeRemainingMs(target, targetMs), 0);
  assert.equal(computeRemainingMs(target, targetMs + 60_000), 0);
  assert.equal(computeRemainingMs(null, targetMs), 0);
  assert.equal(computeRemainingMs('not-a-date', targetMs), 0);
  assert.equal(formatCountdownHms(-5000), '00:00:00');
  assert.equal(formatCountdownHms(0), '00:00:00');

  // Expiry date formats cleanly in IST and handles empty/invalid inputs
  const formatted = formatSpinCouponExpiry('2026-11-20T18:29:59.000Z', 'Asia/Kolkata');
  assert.match(formatted, /20|21/);
  assert.match(formatted, /Nov/);
  assert.equal(formatSpinCouponExpiry(null), '');
  assert.equal(formatSpinCouponExpiry('invalid-iso'), '');
});

test('computeTargetWheelRotation lands chosen slice centered under 12 o clock pointer across 2..12 slices', () => {
  for (let count = 2; count <= 12; count += 1) {
    const sliceDeg = 360 / count;
    let cumulativeRotation = 0;

    for (let targetIdx = 0; targetIdx < count; targetIdx += 1) {
      const nextDeg = computeTargetWheelRotation(cumulativeRotation, targetIdx, count, 5);
      assert.ok(nextDeg > cumulativeRotation + 360 * 4, 'should spin forward multiple turns');

      // Rotating the SVG wheel clockwise by nextDeg moves slice midpoint (targetIdx + 0.5)*sliceDeg
      // modulo 360 to 0 deg (12 o clock top pointer).
      const sliceMid = (targetIdx + 0.5) * sliceDeg;
      const pointerPos = ((sliceMid + nextDeg) % 360 + 360) % 360;
      const distFromTop = Math.min(pointerPos, 360 - pointerPos);
      assert.ok(
        distFromTop < 1e-6,
        `count=${count} targetIdx=${targetIdx} landed ${pointerPos}deg from top`,
      );

      // Verify zero-extra-turns snap (used by reduced-motion and reload restoration)
      const snapDeg = computeTargetWheelRotation(cumulativeRotation, targetIdx, count, 0);
      const snapPointer = ((sliceMid + snapDeg) % 360 + 360) % 360;
      const snapDist = Math.min(snapPointer, 360 - snapPointer);
      assert.ok(snapDist < 1e-6, `snap count=${count} targetIdx=${targetIdx}`);

      cumulativeRotation = nextDeg;
    }
  }
});

test('storefront spin API routes enforce dynamic rendering, same-origin, auth, rate limits, and hashed IP', async () => {
  const statusSrc = await readRel('src/app/api/spin-wheel/route.ts');
  assert.match(statusSrc, /dynamic = 'force-dynamic'/);
  assert.match(statusSrc, /'Cache-Control': 'no-store'/);
  assert.match(statusSrc, /requireStorefrontOpen/);
  assert.match(statusSrc, /getUserSession/);
  assert.match(statusSrc, /getCustomerSpinState/);

  const spinSrc = await readRel('src/app/api/spin-wheel/spin/route.ts');
  assert.match(spinSrc, /dynamic = 'force-dynamic'/);
  assert.match(spinSrc, /assertSameOrigin/);
  assert.match(spinSrc, /requireAccountSessionApi/);
  assert.match(spinSrc, /clientIpFromRequest/);
  assert.match(spinSrc, /checkRateLimit\(`spin-wheel-ip:/);
  assert.match(spinSrc, /checkRateLimit\(`spin-wheel-user:/);
  assert.match(spinSrc, /ip \? createHash\('sha256'\)\.update\(ip\)\.digest\('hex'\) : ''/);
  assert.match(spinSrc, /executeSpinDraw/);
  assert.match(spinSrc, /outcome\.reason === 'unauthorized'.*401/);
  assert.match(spinSrc, /outcome\.reason === 'account_too_new'.*403/);
  assert.match(spinSrc, /outcome\.reason === 'ip_limit'.*429/);
  assert.match(spinSrc, /outcome\.reason === 'unavailable'.*503/);
});

test('customer spin UI covers signed-out redirect, terms check, reduced motion, a11y live region, result actions, and countdown', async () => {
  const clientSrc = await readRel('src/components/spin-wheel/CustomerSpinWheelClient.tsx');
  const svgSrc = await readRel('src/components/spin-wheel/SpinWheelSvg.tsx');
  const pageSrc = await readRel('src/app/spin-and-win/page.tsx');

  // Storefront page chrome & dynamic rendering
  assert.match(pageSrc, /dynamic = 'force-dynamic'/);
  assert.match(pageSrc, /GadzioHeader/);
  assert.match(pageSrc, /GlobalFooter/);
  assert.match(pageSrc, /getCustomerSpinState/);
  assert.match(pageSrc, /CustomerSpinWheelClient/);

  // Screen reader status region, alert role, prize list, focus styles
  assert.match(clientSrc, /role="status" aria-live="polite"/);
  assert.match(clientSrc, /role="alert"/);
  assert.match(clientSrc, /aria-label="Prizes on the wheel"/);
  assert.match(clientSrc, /focus-visible:ring-2/);

  // Reduced motion handling in both wheel client and SVG renderer
  assert.match(clientSrc, /prefers-reduced-motion: reduce/);
  assert.match(clientSrc, /computeTargetWheelRotation\(prev, targetIndex, state\.segments\.length, 0\)/);
  assert.match(svgSrc, /prefers-reduced-motion: reduce/);
  assert.match(svgSrc, /transition:\s*reducedMotion\s*\?\s*'none'/);

  // Signed-out redirects back to /spin-and-win
  assert.match(clientSrc, /\/auth\?redirect=\/spin-and-win/);
  assert.match(clientSrc, /\/auth\?redirect=\/spin-and-win&mode=signup/);

  // Terms checkbox gating, copy code, coupon link, continue shopping, midnight countdown
  assert.match(clientSrc, /id="spin-terms"/);
  assert.match(clientSrc, /href="#spin-terms"/);
  assert.match(clientSrc, /termsAccepted/);
  assert.match(clientSrc, /navigator\.clipboard\.writeText/);
  assert.match(clientSrc, /href="\/account\/coupons"/);
  assert.match(clientSrc, /Next spin in/);
});

test('home, account dashboard, and account coupons entry points honor active/banner gating and label spin coupons', async () => {
  const homePageSrc = await readRel('src/app/page.tsx');
  const homeClientSrc = await readRel(
    'src/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage.tsx',
  );
  const stripSrc = await readRel('src/components/spin-wheel/HomeSpinStrip.tsx');
  const accountPageSrc = await readRel('src/app/account/page.tsx');
  const accountCardSrc = await readRel('src/components/spin-wheel/AccountSpinCard.tsx');
  const couponsPageSrc = await readRel('src/app/account/coupons/page.tsx');
  const couponsListSrc = await readRel('src/components/account/CouponsList.tsx');

  // Home strip hidden unless banner.show is true
  assert.match(homePageSrc, /getHomeSpinBannerState/);
  assert.match(homeClientSrc, /HomeSpinStrip/);
  assert.match(stripSrc, /if \(!banner\?\.show\) return null/);
  assert.match(stripSrc, /href="\/spin-and-win"/);

  // Account dashboard card hidden unless open or todaySpin exists
  assert.match(accountPageSrc, /getCustomerSpinState/);
  assert.match(accountPageSrc, /spinState\.available && spinState\.isOpen && spinState\.segments\.length >= 2/);
  assert.match(accountPageSrc, /spinOpen \|\| spinState\.todaySpin !== null/);
  assert.match(accountPageSrc, /AccountSpinCard/);
  assert.match(accountCardSrc, /Next spin in/);
  assert.match(accountCardSrc, /href="\/spin-and-win"/);

  // Coupons list shows Spin and Win source badge and conditional CTA
  assert.match(couponsPageSrc, /getCustomerSpinState/);
  assert.match(couponsPageSrc, /spinAvailable/);
  assert.match(couponsListSrc, /coupon\.source === 'spin_wheel'/);
  assert.match(couponsListSrc, /From Spin and Win/);
  assert.match(couponsListSrc, /\{spinAvailable \?/);
});
