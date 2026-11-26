import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve('.');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  jsx: { runtime: 'automatic' },
  alias: { '@': path.join(root, 'src') },
  virtualModules: {
    '@/lib/cart/CartContext': {
      useCart: () => ({ items: [], removeItem() {}, syncPrices() {}, isHydrated: true }),
    },
    '@/lib/checkout/useCheckoutRefresh': { useCheckoutRefresh() {} },
    '@/lib/storefront/use-availability': { verifyAvailabilityLines: async () => true },
    '@/lib/cart/useCoupon': {
      useCoupon: () => ({
        totals: { subtotalPaise: 129900, discountPaise: 0, shippingPaise: 0, totalPaise: 129900 },
        input: '',
        applied: null,
        busy: false,
      }),
    },
    '@/components/cart/CouponBox': { CouponBox: () => createElement('div', null, 'Coupon box') },
  },
});

const {
  formatDeliveryRangeMessage,
  formatPublicReviewerName,
  parseDeliveryDays,
  resolveCheckoutDeliveryAnnouncement,
  resolveCheckoutTrustDelivery,
  resolveCheckoutTrustItem,
  validateCheckoutTrustDeliveryCrossFields,
} = await jiti.import(path.join(root, 'src/lib/checkout/trust-delivery-rules.ts'));

const { DEFAULT_SETTINGS, validateSettingValue } = await jiti.import(
  path.join(root, 'src/lib/store-admin/settings-rules.ts'),
);

const { CheckoutForm } = await jiti.import(
  path.join(root, 'src/components/checkout/CheckoutForm.tsx'),
);

const { CheckoutDeliveryAnnouncementCard, CheckoutTrustReviewCard } = await jiti.import(
  path.join(root, 'src/components/checkout/CheckoutTrustDeliveryCards.tsx'),
);

const SAMPLE_REVIEWS = [
  {
    id: 'rev_verified_5',
    productName: 'CrystalArmor Clear Case',
    customerName: 'Aarav Mehta',
    rating: 5,
    title: 'Solid build',
    body: 'MagSafe hold is rock solid and delivery arrived neatly packed.',
    orderVerified: true,
    createdAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'rev_unverified_4',
    productName: 'Braided USB-C Cable',
    customerName: 'Priya Sharma',
    rating: 4,
    title: 'Good cable',
    body: 'Feels sturdy and charges fast on my desk setup.',
    orderVerified: false,
    createdAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'rev_pii_leak',
    productName: '20W GaN Adapter',
    customerName: 'secret@example.com',
    rating: 5,
    title: 'Great',
    body: 'Reach me at 9876543210 if needed.',
    orderVerified: true,
    createdAt: '2026-10-03T10:00:00.000Z',
  },
];

function renderCheckout(trustDelivery) {
  return renderToStaticMarkup(
    createElement(CheckoutForm, {
      initialItems: [
        {
          id: 'charger',
          productId: 'charger',
          name: 'Charger',
          variantId: 'usb',
          variantLabel: 'USB-C 30W',
          image: '/sample.png',
          price: 1299,
          quantity: 1,
        },
      ],
      productIdFromQuery: 'charger',
      initialProducts: [
        {
          id: 'charger',
          name: 'Charger',
          inventoryMode: 'variant',
          pricePaise: 129900,
          inStock: true,
          purchasableVariants: [{ id: 'usb', label: 'USB-C 30W', pricePaise: 129900, inStock: true }],
        },
      ],
      shippingPolicy: { enabled: true, chargePaise: 0, freeShippingThresholdPaise: null },
      couponsEnabled: true,
      trustDelivery,
    }),
  );
}

test('1. Normal delivery announcement renders admin-configured range, title, description, and icon', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    checkout_delivery_normal_enabled: 'on',
    checkout_delivery_normal_title: 'Expected Delivery',
    checkout_delivery_normal_min_days: '4',
    checkout_delivery_normal_max_days: '6',
    checkout_delivery_normal_description: 'Estimated delivery after your order is confirmed.',
    checkout_delivery_normal_icon: 'truck',
  };

  const normal = resolveCheckoutDeliveryAnnouncement(settings, false);
  assert.deepEqual(normal, {
    mode: 'normal',
    title: 'Expected Delivery',
    mainMessage: 'Delivered in 4–6 days',
    description: 'Estimated delivery after your order is confirmed.',
    estimateNote: null,
    icon: 'truck',
  });

  assert.equal(formatDeliveryRangeMessage(1, 1), 'Delivered in 1 day');
  assert.equal(formatDeliveryRangeMessage(3, 3), 'Delivered in 3 days');

  const html = renderToStaticMarkup(
    createElement(CheckoutDeliveryAnnouncementCard, { announcement: normal }),
  );
  assert.match(html, /Expected Delivery/);
  assert.match(html, /Delivered in 4–6 days/);
  assert.match(html, /Estimated delivery after your order is confirmed\./);
  assert.match(html, /data-mode="normal"/);
});

test('2. Minimum and maximum delivery days validate strictly on server rules', () => {
  assert.equal(parseDeliveryDays('1'), 1);
  assert.equal(parseDeliveryDays('60'), 60);
  assert.equal(parseDeliveryDays('0'), null);
  assert.equal(parseDeliveryDays('-2'), null);
  assert.equal(parseDeliveryDays('4.5'), null);
  assert.equal(parseDeliveryDays('61'), null);
  assert.equal(parseDeliveryDays(''), null);

  assert.equal(validateSettingValue('checkout_delivery_normal_min_days', '0').ok, false);
  assert.equal(validateSettingValue('checkout_delivery_normal_max_days', '61').ok, false);
  assert.equal(validateSettingValue('checkout_delivery_normal_min_days', '4').ok, true);

  const inverted = validateCheckoutTrustDeliveryCrossFields({
    ...DEFAULT_SETTINGS,
    checkout_delivery_normal_enabled: 'on',
    checkout_delivery_normal_min_days: '7',
    checkout_delivery_normal_max_days: '5',
  });
  assert.equal(inverted.ok, false);
  assert.match(inverted.error, /Minimum delivery days cannot be greater/);

  const missingTitle = validateCheckoutTrustDeliveryCrossFields({
    ...DEFAULT_SETTINGS,
    checkout_delivery_normal_enabled: 'on',
    checkout_delivery_normal_title: '   ',
  });
  assert.equal(missingTitle.ok, false);
});

test('3 & 4. Sale Mode automatically switches announcement and restores normal mode when sale ends', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    checkout_delivery_normal_enabled: 'on',
    checkout_delivery_normal_title: 'Expected Delivery',
    checkout_delivery_normal_min_days: '4',
    checkout_delivery_normal_max_days: '6',
    checkout_delivery_normal_description: 'Estimated delivery after your order is confirmed.',
    checkout_delivery_sale_enabled: 'on',
    checkout_delivery_sale_title: 'Sale Dispatch Update',
    checkout_delivery_sale_message: 'Dispatch starts after the sale ends.',
    checkout_delivery_sale_description:
      'Orders placed during the sale will be processed once the sale concludes.',
    checkout_delivery_sale_estimate: '',
    checkout_delivery_sale_icon: 'clock',
  };

  const duringSale = resolveCheckoutTrustDelivery(settings, SAMPLE_REVIEWS, true);
  assert.equal(duringSale.saleLive, true);
  assert.equal(duringSale.delivery?.mode, 'sale');
  assert.equal(duringSale.delivery?.title, 'Sale Dispatch Update');
  assert.equal(duringSale.delivery?.mainMessage, 'Dispatch starts after the sale ends.');
  assert.equal(duringSale.delivery?.estimateNote, null);

  // When Sale Mode ends, normal delivery announcement is automatically restored
  const afterSale = resolveCheckoutTrustDelivery(settings, SAMPLE_REVIEWS, false);
  assert.equal(afterSale.saleLive, false);
  assert.equal(afterSale.delivery?.mode, 'normal');
  assert.equal(afterSale.delivery?.mainMessage, 'Delivered in 4–6 days');

  // If sale announcement is disabled while Sale Mode is live, NEVER leak normal delivery promise
  const saleDisabledSettings = { ...settings, checkout_delivery_sale_enabled: 'off' };
  assert.equal(resolveCheckoutDeliveryAnnouncement(saleDisabledSettings, true), null);
});

test('5. Disabled review and delivery announcements remain completely hidden', () => {
  const disabled = resolveCheckoutTrustDelivery(DEFAULT_SETTINGS, SAMPLE_REVIEWS, false);
  assert.equal(disabled.trust, null);
  assert.equal(disabled.delivery, null);

  const html = renderCheckout(disabled);
  assert.doesNotMatch(html, /checkout-trust-review/);
  assert.doesNotMatch(html, /checkout-delivery-announcement/);
});

test('6. Genuine published selected reviews and auto-rotation render cleanly', () => {
  const manualSettings = {
    ...DEFAULT_SETTINGS,
    checkout_trust_enabled: 'on',
    checkout_trust_mode: 'manual_review',
    checkout_trust_review_id: 'rev_verified_5',
    checkout_trust_show_verified: 'on',
  };
  const manual = resolveCheckoutTrustItem(manualSettings, SAMPLE_REVIEWS);
  assert.deepEqual(manual, {
    kind: 'review',
    quote: 'MagSafe hold is rock solid and delivery arrived neatly packed.',
    reviewerName: 'Aarav M.',
    rating: 5,
    verifiedPurchase: true,
  });

  const html = renderToStaticMarkup(createElement(CheckoutTrustReviewCard, { item: manual }));
  assert.match(html, /5 out of 5 stars/);
  assert.match(html, /Aarav M\./);
  assert.match(html, /Verified Purchase/);

  const rotateSettings = {
    ...DEFAULT_SETTINGS,
    checkout_trust_enabled: 'on',
    checkout_trust_mode: 'auto_rotate',
    checkout_trust_min_rating: '4',
    checkout_trust_verified_only: 'on',
    checkout_trust_show_verified: 'on',
  };
  const rotated = resolveCheckoutTrustItem(rotateSettings, SAMPLE_REVIEWS, { rotationIndex: 0 });
  assert.equal(rotated?.kind, 'review');
  assert.equal(rotated?.reviewerName, 'Aarav M.');
  assert.equal(rotated?.verifiedPurchase, true);
});

test('7. Unverified reviews and trust messages never display Verified Purchase; unpublished reviews fail closed', () => {
  const unverifiedSettings = {
    ...DEFAULT_SETTINGS,
    checkout_trust_enabled: 'on',
    checkout_trust_mode: 'manual_review',
    checkout_trust_review_id: 'rev_unverified_4',
    checkout_trust_show_verified: 'on',
  };
  const unverified = resolveCheckoutTrustItem(unverifiedSettings, SAMPLE_REVIEWS);
  assert.equal(unverified?.kind, 'review');
  assert.equal(unverified?.verifiedPurchase, false);

  const unverifiedHtml = renderToStaticMarkup(
    createElement(CheckoutTrustReviewCard, { item: unverified }),
  );
  assert.doesNotMatch(unverifiedHtml, /Verified Purchase/);

  const trustMessageSettings = {
    ...DEFAULT_SETTINGS,
    checkout_trust_enabled: 'on',
    checkout_trust_mode: 'trust_message',
    checkout_trust_text: 'Every order ships with 7-day replacement support.',
    checkout_trust_reviewer_name: 'Gadzio Care Team',
    checkout_trust_show_verified: 'on',
  };
  const trustMsg = resolveCheckoutTrustItem(trustMessageSettings, SAMPLE_REVIEWS);
  assert.deepEqual(trustMsg, {
    kind: 'trust_message',
    quote: 'Every order ships with 7-day replacement support.',
    authorLabel: 'Gadzio Care Team',
  });
  const msgHtml = renderToStaticMarkup(
    createElement(CheckoutTrustReviewCard, { item: trustMsg }),
  );
  assert.doesNotMatch(msgHtml, /Verified Purchase/);
  assert.doesNotMatch(msgHtml, /out of 5 stars/);

  // Non-existent / unpublished review ID fails closed to null
  const missingReview = resolveCheckoutTrustItem(
    { ...unverifiedSettings, checkout_trust_review_id: 'rev_unpublished' },
    SAMPLE_REVIEWS,
  );
  assert.equal(missingReview, null);
});

test('8 & 9. Store Admin authorization, same-origin enforcement, and settings validation', async () => {
  const settingsRoute = await readFile(
    path.join(root, 'src/app/api/store-admin/settings/route.ts'),
    'utf8',
  );
  assert.match(settingsRoute, /assertSameOrigin\(request\)/);
  assert.match(settingsRoute, /requireStoreRole\('store_admin'\)/);
  assert.match(settingsRoute, /writeAudit\(/);

  const settingsLib = await readFile(
    path.join(root, 'src/lib/store-admin/settings.ts'),
    'utf8',
  );
  assert.match(settingsLib, /validateCheckoutTrustDeliveryCrossFields/);
  assert.match(settingsLib, /status = 'published'/);
  assert.match(settingsLib, /clearCheckoutTrustDeliveryCache\(\)/);
});

test('10. Public API and serializers strip/reject PII and omit sensitive customer/internal fields', async () => {
  assert.equal(formatPublicReviewerName('secret@example.com'), 'Gadzio Customer');
  assert.equal(formatPublicReviewerName('9876543210'), 'Gadzio Customer');
  assert.equal(validateSettingValue('checkout_trust_reviewer_name', 'alice@example.com').ok, false);
  assert.equal(validateSettingValue('checkout_trust_text', 'Call 9876543210 now').ok, false);

  // Auto-rotate skips reviews whose body contains email/phone PII
  const rotated = resolveCheckoutTrustItem(
    {
      ...DEFAULT_SETTINGS,
      checkout_trust_enabled: 'on',
      checkout_trust_mode: 'auto_rotate',
      checkout_trust_min_rating: '4',
      checkout_trust_verified_only: 'on',
      checkout_trust_show_verified: 'on',
    },
    [SAMPLE_REVIEWS[2]],
    { rotationIndex: 0 },
  );
  assert.equal(rotated, null);

  // Strict field allowlist check
  const payload = resolveCheckoutTrustDelivery(
    {
      ...DEFAULT_SETTINGS,
      checkout_trust_enabled: 'on',
      checkout_trust_mode: 'manual_review',
      checkout_trust_review_id: 'rev_verified_5',
      checkout_delivery_normal_enabled: 'on',
    },
    SAMPLE_REVIEWS,
    false,
  );
  assert.deepEqual(Object.keys(payload).sort(), ['delivery', 'saleLive', 'trust']);
  assert.deepEqual(Object.keys(payload.trust).sort(), [
    'kind',
    'quote',
    'rating',
    'reviewerName',
    'verifiedPurchase',
  ]);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /rev_verified_5|example\.com|9876543210/);

  // Public server reader never selects customer_email, order_id, or user_id
  const serverSource = await readFile(
    path.join(root, 'src/lib/checkout/trust-delivery-server.ts'),
    'utf8',
  );
  const selectMatch = serverSource.match(/select([\s\S]*?)from product_reviews r/);
  assert.ok(selectMatch, 'Expected published review SELECT query');
  assert.doesNotMatch(
    selectMatch[1],
    /r\.customer_email|r\.order_id|r\.user_id|r\.rejection_reason|r\.store_reply/,
  );

  const publicApiSource = await readFile(
    path.join(root, 'src/app/api/checkout/trust-delivery/route.ts'),
    'utf8',
  );
  assert.match(publicApiSource, /requireStorefrontOpen\(\)/);
  assert.match(publicApiSource, /getPublicCheckoutTrustDelivery\(\)/);
});

test('11. Checkout layout preserves existing grid and orders Summary -> Trust Review -> Delivery Announcement -> Form', () => {
  const payload = resolveCheckoutTrustDelivery(
    {
      ...DEFAULT_SETTINGS,
      checkout_trust_enabled: 'on',
      checkout_trust_mode: 'manual_review',
      checkout_trust_review_id: 'rev_verified_5',
      checkout_delivery_normal_enabled: 'on',
    },
    SAMPLE_REVIEWS,
    false,
  );

  const html = renderCheckout(payload);
  const summaryIdx = html.indexOf('aria-label="Order summary"');
  const trustIdx = html.indexOf('data-testid="checkout-trust-review"');
  const deliveryIdx = html.indexOf('data-testid="checkout-delivery-announcement"');
  const formIdx = html.indexOf('<form');

  assert.ok(summaryIdx > -1 && trustIdx > -1 && deliveryIdx > -1 && formIdx > -1);
  assert.ok(summaryIdx < trustIdx, 'Trust review must appear below Order Summary');
  assert.ok(trustIdx < deliveryIdx, 'Delivery announcement must appear below Trust review');
  assert.ok(deliveryIdx < formIdx, 'Delivery announcement must appear before checkout form');
  assert.match(html, /lg:grid-cols-2/);
  assert.match(html, /id="checkout-pay-now-btn"/);
});

test('13. Missing or invalid settings fail safely without showing misleading promises', () => {
  const corrupted = {
    checkout_trust_enabled: 'on',
    checkout_trust_mode: 'unknown_mode',
    checkout_delivery_normal_enabled: 'on',
    checkout_delivery_normal_title: '',
    checkout_delivery_normal_min_days: '9',
    checkout_delivery_normal_max_days: '2',
    checkout_delivery_sale_enabled: 'on',
    checkout_delivery_sale_title: '',
    checkout_delivery_sale_message: '',
  };

  const normalResult = resolveCheckoutTrustDelivery(corrupted, SAMPLE_REVIEWS, false);
  assert.equal(normalResult.trust, null);
  assert.equal(normalResult.delivery, null);

  const saleResult = resolveCheckoutTrustDelivery(corrupted, SAMPLE_REVIEWS, true);
  assert.equal(saleResult.trust, null);
  assert.equal(saleResult.delivery, null);
});
