import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);

function load(relative) {
  const filename = path.resolve(root, relative);
  const module = { exports: {} };
  const outputText = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      require(name) {
        if (name.startsWith('@/') || name.startsWith('.')) {
          const target = name.startsWith('@/')
            ? path.join(root, 'src', name.slice(2))
            : path.resolve(path.dirname(filename), name);
          for (const ext of ['.ts', '.tsx']) {
            try {
              readFileSync(target + ext);
              return load(target + ext);
            } catch {}
          }
        }
        return nativeRequire(name);
      },
      console,
    },
  );
  return module.exports;
}

const { buildFreeShippingBanner, formatBannerRupees } = load('src/lib/checkout/shipping-banner.ts');

test('formatBannerRupees omits .00 for whole rupees and keeps 2 decimals for fractional paise', () => {
  assert.equal(formatBannerRupees(0), '₹0');
  assert.equal(formatBannerRupees(400000), '₹4,000');
  assert.equal(formatBannerRupees(99900), '₹999');
  assert.equal(formatBannerRupees(49950), '₹499.50');
});

test('buildFreeShippingBanner returns null when shippingPolicy is unavailable or paid without threshold', () => {
  assert.equal(buildFreeShippingBanner(50000, null), null);
  assert.equal(
    buildFreeShippingBanner(50000, { enabled: true, chargePaise: 5000, freeShippingThresholdPaise: null }, 5000),
    null,
  );
});

test('buildFreeShippingBanner returns always-free when shipping is disabled, ₹0 charge, or ₹0 threshold', () => {
  const disabledEmpty = buildFreeShippingBanner(0, { enabled: false, chargePaise: 5000, freeShippingThresholdPaise: 400000 });
  assert.equal(disabledEmpty.status, 'always-free');
  assert.equal(disabledEmpty.unlocked, true);
  assert.equal(disabledEmpty.progressPercent, 100);
  assert.equal(disabledEmpty.headline, 'Free delivery on all orders!');

  const zeroChargeNonEmpty = buildFreeShippingBanner(49900, { enabled: true, chargePaise: 0, freeShippingThresholdPaise: 400000 });
  assert.equal(zeroChargeNonEmpty.status, 'always-free');
  assert.equal(zeroChargeNonEmpty.headline, 'Your order qualifies for FREE delivery!');

  const zeroThreshold = buildFreeShippingBanner(100, { enabled: true, chargePaise: 5000, freeShippingThresholdPaise: 0 });
  assert.equal(zeroThreshold.status, 'always-free');
  assert.equal(zeroThreshold.headline, 'Your order qualifies for FREE delivery!');
});

test('buildFreeShippingBanner tracks empty, in-progress, exact, and above-threshold states', () => {
  const policy = { enabled: true, chargePaise: 9900, freeShippingThresholdPaise: 400000 };

  const empty = buildFreeShippingBanner(0, policy);
  assert.equal(empty.status, 'threshold-empty');
  assert.equal(empty.unlocked, false);
  assert.equal(empty.progressPercent, 0);
  assert.equal(empty.remainingPaise, 400000);
  assert.equal(empty.headline, 'Free delivery on orders of ₹4,000 or more');
  assert.equal(empty.progressLabel, '₹0 / ₹4,000');

  const progress = buildFreeShippingBanner(149950, policy);
  assert.equal(progress.status, 'threshold-progress');
  assert.equal(progress.unlocked, false);
  assert.equal(progress.remainingPaise, 250050);
  assert.equal(progress.progressPercent, 37);
  assert.equal(progress.headline, 'Add ₹2,500.50 more for FREE delivery');
  assert.equal(progress.progressLabel, '₹1,499.50 / ₹4,000');

  const exact = buildFreeShippingBanner(400000, policy);
  assert.equal(exact.status, 'threshold-unlocked');
  assert.equal(exact.unlocked, true);
  assert.equal(exact.progressPercent, 100);
  assert.equal(exact.remainingPaise, 0);
  assert.equal(exact.headline, "You've unlocked FREE delivery!");
  assert.equal(exact.progressLabel, '₹4,000 / ₹4,000');

  const above = buildFreeShippingBanner(550000, policy);
  assert.equal(above.status, 'threshold-unlocked');
  assert.equal(above.unlocked, true);
  assert.equal(above.progressPercent, 100);
});

test('buildFreeShippingBanner shows coupon-unlocked when a free-shipping coupon waives shipping', () => {
  const withThreshold = buildFreeShippingBanner(
    100000,
    { enabled: true, chargePaise: 9900, freeShippingThresholdPaise: 400000 },
    0,
  );
  assert.equal(withThreshold.status, 'coupon-unlocked');
  assert.equal(withThreshold.unlocked, true);
  assert.equal(withThreshold.progressPercent, 100);
  assert.equal(withThreshold.headline, 'FREE delivery unlocked with your coupon!');

  const withoutThreshold = buildFreeShippingBanner(
    100000,
    { enabled: true, chargePaise: 9900, freeShippingThresholdPaise: null },
    0,
  );
  assert.equal(withoutThreshold.status, 'coupon-unlocked');
  assert.equal(withoutThreshold.unlocked, true);
});

test('CartPageView renders FreeShippingProgressBar and preserves Delivery across India strip', () => {
  const cartView = readFileSync(path.join(root, 'src/components/cart/CartPageView.tsx'), 'utf8');
  assert.match(cartView, /Delivery across India\./);
  assert.match(
    cartView,
    /buildFreeShippingBanner\(subtotalPaise,\s*shippingPolicy,\s*coupon\.totals\.shippingPaise\)/,
  );
  assert.match(cartView, /<FreeShippingProgressBar\s+banner=\{freeShippingBanner\}/);
});
