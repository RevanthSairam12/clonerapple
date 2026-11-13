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

const {
  computeRemainingMs,
  formatCountdownHms,
  formatSpinCouponExpiry,
  formatSpinCountdown,
} = await jiti.import(path.join(root, 'src', 'lib', 'spin-wheel', 'countdown.ts'));

const { computeTargetWheelRotation, WHEEL_POINTER_RIGHT_ANGLE_DEG } = await jiti.import(
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

  // Multi-day countdown formats Xd HH:MM:SS when >= 24h and HH:MM:SS when < 24h
  assert.equal(formatSpinCountdown(3_661_000), '01:01:01');
  assert.equal(formatSpinCountdown(2 * 86_400_000 + 3_661_000), '2d 01:01:01');
  assert.equal(formatSpinCountdown(-10), '00:00:00');
});

test('computeTargetWheelRotation lands chosen slice centered under 12 o clock and right teardrop pointers across 2..12 slices', () => {
  for (const pointerDeg of [0, WHEEL_POINTER_RIGHT_ANGLE_DEG]) {
    for (let count = 2; count <= 12; count += 1) {
      const sliceDeg = 360 / count;
      let cumulativeRotation = 0;

      for (let targetIdx = 0; targetIdx < count; targetIdx += 1) {
        const nextDeg = computeTargetWheelRotation(cumulativeRotation, targetIdx, count, 5, pointerDeg);
        assert.ok(nextDeg > cumulativeRotation + 360 * 4, 'should spin forward multiple turns');

        const sliceMid = (targetIdx + 0.5) * sliceDeg;
        const landedPos = ((sliceMid + nextDeg) % 360 + 360) % 360;
        const rawDiff = Math.abs(landedPos - pointerDeg);
        const distFromPointer = Math.min(rawDiff, 360 - rawDiff);
        assert.ok(
          distFromPointer < 1e-6,
          `pointer=${pointerDeg} count=${count} targetIdx=${targetIdx} landed ${landedPos}deg`,
        );

        // Verify zero-extra-turns snap (used by reduced-motion and reload restoration)
        const snapDeg = computeTargetWheelRotation(cumulativeRotation, targetIdx, count, 0, pointerDeg);
        const snapPos = ((sliceMid + snapDeg) % 360 + 360) % 360;
        const snapRawDiff = Math.abs(snapPos - pointerDeg);
        const snapDist = Math.min(snapRawDiff, 360 - snapRawDiff);
        assert.ok(snapDist < 1e-6, `snap pointer=${pointerDeg} count=${count} targetIdx=${targetIdx}`);

        cumulativeRotation = nextDeg;
      }
    }
  }
});

test('storefront spin API routes enforce dynamic rendering, same-origin, auth, rate limits, cooldown 429, and 42P01 guards', async () => {
  const statusSrc = await readRel('src/app/api/spin-wheel/route.ts');
  assert.match(statusSrc, /dynamic = 'force-dynamic'/);
  assert.match(statusSrc, /'Cache-Control': 'no-store'/);
  assert.match(statusSrc, /requireStorefrontOpen/);
  assert.match(statusSrc, /getUserSession/);
  assert.match(statusSrc, /getCustomerSpinState/);

  const spinSrc = await readRel('src/app/api/spin-wheel/spin/route.ts');
  assert.match(spinSrc, /dynamic = 'force-dynamic'/);
  assert.match(spinSrc, /assertSameOrigin/);
  assert.match(spinSrc, /requireStorefrontOpen/);
  assert.match(spinSrc, /requireAccountSessionApi/);
  assert.match(spinSrc, /clientIpFromRequest/);
  assert.match(spinSrc, /checkRateLimit\(`spin-wheel-ip:/);
  assert.match(spinSrc, /checkRateLimit\(`spin-wheel-user:/);
  assert.match(spinSrc, /ip \? createHash\('sha256'\)\.update\(ip\)\.digest\('hex'\) : ''/);
  assert.match(spinSrc, /executeSpinDraw/);
  assert.match(spinSrc, /outcome\.reason === 'unauthorized'.*401/);
  assert.match(spinSrc, /outcome\.reason === 'account_too_new' \|\| outcome\.reason === 'bot_check_failed'.*403/);
  assert.match(spinSrc, /reward_cooldown[\s\S]*429/);
  assert.match(spinSrc, /outcome\.reason === 'unavailable'.*503/);

  const maintenanceSrc = await readRel('src/lib/storefront/maintenance.ts');
  assert.match(maintenanceSrc, /'\/spin-and-win'/);
  assert.match(maintenanceSrc, /'\/api\/spin-wheel'/);

  const storeSrc = await readRel('src/lib/spin-wheel/store.ts');
  assert.match(storeSrc, /42P01/);
  assert.match(storeSrc, /isUndefinedTableError/);
  assert.match(storeSrc, /maskEmail/);
  assert.match(storeSrc, /maskPhone/);
});

test('customer spin UI covers 1:1 poster design, masked PII, accessible popup with 7-day cap, signed-out redirect, terms check, reduced motion, and cooldown copy', async () => {
  const clientSrc = await readRel('src/components/spin-wheel/CustomerSpinWheelClient.tsx');
  const showcaseSrc = await readRel('src/components/spin-wheel/SpinToWinShowcase.tsx');
  const popupSrc = await readRel('src/components/spin-wheel/HomeSpinPopup.tsx');
  const svgSrc = await readRel('src/components/spin-wheel/SpinWheelSvg.tsx');
  const pageSrc = await readRel('src/app/spin-and-win/page.tsx');

  // Storefront page chrome & dynamic rendering
  assert.match(pageSrc, /dynamic = 'force-dynamic'/);
  assert.match(pageSrc, /GadzioHeader/);
  assert.match(pageSrc, /GlobalFooter/);
  assert.match(pageSrc, /getCustomerSpinState/);
  assert.match(pageSrc, /CustomerSpinWheelClient/);
  assert.match(clientSrc, /SpinToWinShowcase/);

  // 1:1 Cream/Coral/Lilac/Lime visual palette, boxed fields, 1/1 quota & controls
  assert.match(showcaseSrc, /#fbf8ef/);
  assert.match(showcaseSrc, /#e8c6ff/);
  assert.match(showcaseSrc, /#d8f561/);
  assert.match(showcaseSrc, /#f25c3b/);
  assert.match(showcaseSrc, /YOUR EMAIL/);
  assert.match(showcaseSrc, /YOUR PHONE NUMBER/);
  assert.match(showcaseSrc, /SPIN TO WIN/);
  assert.match(showcaseSrc, /NO THANKS/);
  assert.match(showcaseSrc, /Signed in/);
  assert.doesNotMatch(showcaseSrc, />\s*Verified\s*</);
  assert.doesNotMatch(showcaseSrc, /api\/newsletter|newsletter_subscribers|subscribeNewsletter/i);
  assert.match(showcaseSrc, /Daily Spin/);
  assert.match(showcaseSrc, /effectiveRemainingSpins\}\/\$\{state\.dailySpinsTotal\}/);
  assert.match(showcaseSrc, /Reward cooldown active/);
  assert.match(popupSrc, /role="dialog"/);
  assert.match(popupSrc, /aria-modal="true"/);
  assert.match(popupSrc, /Escape/);
  assert.match(popupSrc, /Tab/);
  assert.match(popupSrc, /previousFocusRef/);
  assert.match(popupSrc, /sessionStorage/);
  assert.match(popupSrc, /SPIN_POPUP_DISMISS_UNTIL_KEY/);
  assert.match(popupSrc, /popupDelaySeconds/);
  assert.match(popupSrc, /popupRequireScroll/);
  assert.match(popupSrc, /popupMobileFloatingButton/);
  assert.match(popupSrc, /isSpinPopupRouteBlocked/);
  assert.match(popupSrc, /prefers-reduced-motion: reduce/);

  // Screen reader status region, alert role, prize list, focus styles
  assert.match(showcaseSrc, /role="status" aria-live="polite"/);
  assert.match(showcaseSrc, /role="alert"/);
  assert.match(showcaseSrc, /aria-label="Prizes on the wheel"/);
  assert.match(showcaseSrc, /focus-visible:ring-2/);

  // Reduced motion handling in both wheel showcase and SVG renderer
  assert.match(showcaseSrc, /prefers-reduced-motion: reduce/);
  assert.match(showcaseSrc, /computeTargetWheelRotation\(prev, targetIndex, state\.segments\.length, 0/);
  assert.match(svgSrc, /prefers-reduced-motion: reduce/);
  assert.match(svgSrc, /transition:\s*reducedMotion\s*\?\s*'none'/);
  assert.match(svgSrc, /WHEEL_POINTER_RIGHT_ANGLE_DEG/);

  // Signed-out redirects back to /spin-and-win
  assert.match(showcaseSrc, /\/auth\?redirect=\/spin-and-win/);
  assert.match(showcaseSrc, /\/auth\?redirect=\/spin-and-win&mode=signup/);

  // Terms checkbox gating, copy code, coupon link, continue shopping, next-spin countdown
  assert.match(showcaseSrc, /id="spin-terms"/);
  assert.match(showcaseSrc, /href="#spin-terms"/);
  assert.match(showcaseSrc, /termsAccepted/);
  assert.match(showcaseSrc, /navigator\.clipboard\.writeText/);
  assert.match(showcaseSrc, /href="\/account\/coupons"/);
  assert.match(showcaseSrc, /Next spin in/);
});

test('home, account dashboard, and account coupons entry points honor active/banner/popup gating and label spin coupons', async () => {
  const homePageSrc = await readRel('src/app/page.tsx');
  const homeClientSrc = await readRel(
    'src/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage.tsx',
  );
  const stripSrc = await readRel('src/components/spin-wheel/HomeSpinStrip.tsx');
  const accountPageSrc = await readRel('src/app/account/page.tsx');
  const accountCardSrc = await readRel('src/components/spin-wheel/AccountSpinCard.tsx');
  const couponsPageSrc = await readRel('src/app/account/coupons/page.tsx');
  const couponsListSrc = await readRel('src/components/account/CouponsList.tsx');

  // Home strip & popup wired on / via unified cached-first surface loader
  assert.match(homePageSrc, /getHomeSpinSurface/);
  assert.match(homeClientSrc, /HomeSpinStrip/);
  assert.match(homeClientSrc, /HomeSpinPopup/);
  assert.match(stripSrc, /if \(!banner\?\.show\) return null/);
  assert.match(stripSrc, /href="\/spin-and-win"/);

  // Account dashboard card hidden unless open or todaySpin/cooldownBlocked
  assert.match(accountPageSrc, /getCustomerSpinState/);
  assert.match(accountPageSrc, /spinState\.available && spinState\.isOpen && spinState\.segments\.length >= 2/);
  assert.match(accountPageSrc, /spinOpen \|\| spinState\.todaySpin !== null/);
  assert.match(accountPageSrc, /AccountSpinCard/);
  assert.match(accountCardSrc, /Next spin in/);
  assert.match(accountCardSrc, /formatSpinCountdown/);
  assert.match(accountCardSrc, /href="\/spin-and-win"/);

  // Coupons list shows Spin and Win source badge and conditional CTA
  assert.match(couponsPageSrc, /getCustomerSpinState/);
  assert.match(couponsPageSrc, /spinAvailable/);
  assert.match(couponsListSrc, /coupon\.source === 'spin_wheel'/);
  assert.match(couponsListSrc, /From Spin and Win/);
  assert.match(couponsListSrc, /\{spinAvailable \?/);
});
