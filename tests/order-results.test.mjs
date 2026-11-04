import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = ['success', 'status', 'failed', 'cancelled', 'processing'];
const baseOrder = {
  id: 'order-internal', txnid: 'safe-reference', orderNumber: 42, userId: 'owner',
  totalPaise: 12000, currency: 'INR', paymentStatus: 'PAID', fulfilmentStatus: 'ACCEPTED',
  paymentReviewRequired: false, reservationState: 'CONSUMED', history: [], delivery: null,
  customerEmail: 'PRIVATE_EMAIL', address: 'PRIVATE_ADDRESS', items: ['PRIVATE_ITEM'],
};
const baseDocument = {
  paymentStatus: 'PAID', orderStatus: 'ACCEPTED', label: 'Paid', totalPaise: 12000, paymentSettled: true,
  capturedPaise: 12000, refundedPaise: 0, pendingRefundPaise: 0, refundDuePaise: 0,
  refundStatus: 'NONE', canViewInvoice: false, canViewReceipt: true,
  invoiceNumber: null, invoiceIssuedAt: null,
};
const loadJiti = (virtualModules) => createJiti(import.meta.url, {
  moduleCache: false, jsx: { runtime: 'automatic' },
  alias: { '@': path.join(root, 'src') }, virtualModules,
});

async function fixture({ order = {}, document = {}, owner = true, token, available = true, documentFails = false } = {}) {
  let documentReads = 0;
  const jiti = loadJiti({
    'next/link': { default: ({ children, prefetch, ...props }) => createElement('a', props, children) },
    '@/components/checkout/CheckPaymentButton': { CheckPaymentButton: () => createElement('button', null, 'Check payment status') },
    '@/components/checkout/ClearCartOnSuccess': { ClearCartOnSuccess: () => createElement('span', { 'data-clear-cart': 'true' }) },
    '@/lib/catalog/storefront': { formatPaise: (value) => `Rs ${value / 100}` },
    '@/lib/order-status': { getCustomerOrderStatus: async () => available ? { ok: true, data: { ...baseOrder, ...order } } : { ok: false, reason: 'not-found' } },
    '@/lib/orders/document-data': { getCustomerDocumentState: async () => {
      documentReads++;
      if (documentFails) throw new Error('unavailable');
      return { ...baseDocument, ...document };
    } },
    '@/lib/user-auth': { getUserSession: async () => owner ? { userId: 'owner' } : null },
    '@/lib/payu/return-access': {
      resolveReturnAccess: ({ userId, sessionUserId, token }) => userId && sessionUserId === userId ? 'owner' : token === 'signed-token' ? 'summary' : null,
      carryReturnToken: (href, rt) => rt ? `${href}&rt=${rt}` : href,
    },
  });
  return {
    async render(route, query = {}) {
      const { default: Page } = await jiti.import(path.join(root, `src/app/order/${route}/page.tsx`));
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ txnid: 'safe-reference', rt: token, ...query }) }));
    },
    reads: () => documentReads,
  };
}

for (const route of routes) {
  test(`${route}: authoritative paid active order wins over URL, with one action pair`, async () => {
    const f = await fixture();
    const html = await f.render(route);
    assert.match(html, /<h1[^>]*>Order successful<\/h1>/);
    assert.equal((html.match(/>View order summary<\/a>/g) || []).length, 1);
    assert.equal((html.match(/>Continue shopping<\/a>/g) || []).length, 1);
    assert.match(html, /href="\/account\/orders\/safe-reference"/);
    assert.match(html, /Amount paid|Rs 120/);
    assert.doesNotMatch(html, /invoice follows|Request bill|email.*sent|PRIVATE_|Shipment details will appear|Order progress/);
    assert.equal(html.includes('data-clear-cart'), route === 'success');
  });

  test(`${route}: missing/invalid return access never reveals summary or reads documents`, async () => {
    for (const token of [undefined, 'unsigned-token']) {
      const f = await fixture({ owner: false, token });
      const html = await f.render(route);
      assert.match(html, /Sign in to view this order/);
      assert.doesNotMatch(html, /Rs 120|#42|safe-reference|data-clear-cart|Payment receipt/);
      assert.equal(f.reads(), 0);
    }
  });

  test(`${route}: signed guest sees safe summary only, including guest orders`, async () => {
    const f = await fixture({ owner: false, token: 'signed-token', order: { userId: null,
      delivery: { carrier: 'PRIVATE_CARRIER', trackingNumber: 'PRIVATE_TRACKING' }, fulfilmentStatus: 'ON_THE_WAY',
    } });
    const html = await f.render(route);
    assert.match(html, /Order successful/);
    assert.doesNotMatch(html, /PRIVATE_|Payment receipt|View invoice|Check payment status|\/receipt/);
    assert.match(html, route === 'status' ? /href="#order-summary"/ : /href="\/order\/status\?txnid=safe-reference&amp;rt=signed-token"/);
  });

  test(`${route}: uncertain payment never offers retry or clears the cart`, async () => {
    const f = await fixture({ document: { paymentStatus: 'PROCESSING', label: 'Payment Pending / Verifying', capturedPaise: 0, canViewReceipt: false } });
    const html = await f.render(route);
    assert.match(html, /We are checking your payment/);
    assert.match(html, /do not pay again/);
    assert.equal((html.match(/>Check payment status<\/button>/g) || []).length, 1);
    assert.doesNotMatch(html, /Start a new checkout|data-clear-cart|Order successful/);
  });
}

test('success recovery=1 preserves a newer cart; status and other stale paths never clear it', async () => {
  const f = await fixture();
  assert.doesNotMatch(await f.render('success', { recovery: '1' }), /data-clear-cart/);
  for (const route of routes.filter((r) => r !== 'success')) assert.doesNotMatch(await f.render(route), /data-clear-cart/);
});

test('status guest refresh preserves signed token and recovery flag with no success/status loop', async () => {
  const f = await fixture({ owner: false, token: 'signed-token', document: { paymentStatus: 'PENDING', capturedPaise: 0, canViewReceipt: false } });
  const html = await f.render('status', { recovery: '1' });
  assert.match(html, /href="\/order\/status\?txnid=safe-reference&amp;recovery=1&amp;rt=signed-token"/);
  assert.doesNotMatch(html, /\/order\/success|\/checkout|Check payment status/);
});

test('safe missing, not-found and document-unavailable branches do not claim payment success', async () => {
  const f = await fixture();
  assert.match(await f.render('success', { txnid: undefined }), /No transaction identifier/);
  assert.equal(f.reads(), 0);
  assert.match(await f.render('failed', { txnid: ['one', 'two'] }), /No transaction identifier/);
  for (const options of [{ available: false }, { documentFails: true }]) {
    const fail = await fixture(options);
    const html = await fail.render('success');
    assert.match(html, /Order status unavailable/);
    assert.doesNotMatch(html, /data-clear-cart|Order successful/);
  }
});

test('stale success URL shows paid-cancelled/refund facts rather than success or repayment', async () => {
  for (const document of [
    { orderStatus: 'CANCELLED', label: 'Cancelled', refundDuePaise: 12000 },
    { orderStatus: 'CANCELLED', label: 'Refund Initiated', refundStatus: 'INITIATED', pendingRefundPaise: 12000 },
    { label: 'Refund Successful', refundStatus: 'COMPLETED', refundedPaise: 12000 },
    { label: 'Refund Successful — Partial', refundStatus: 'PARTIAL', refundedPaise: 3000 },
  ]) {
    const f = await fixture({ document });
    const html = await f.render('success');
    assert.doesNotMatch(html, /Order successful|data-clear-cart|Start a new checkout/);
    assert.match(html, /cancelled|refund/i);
  }
});

test('only definitive unpaid failure/cancellation offers a new checkout', async () => {
  for (const paymentStatus of ['FAILED', 'CANCELLED']) {
    const f = await fixture({ document: { paymentStatus, capturedPaise: 0, label: 'Failed', canViewReceipt: false } });
    const html = await f.render('success');
    assert.match(html, /Start a new checkout/);
    assert.match(html, /contact us before paying again/);
    assert.doesNotMatch(html, /data-clear-cart|Order successful/);
  }
  const f = await fixture({ document: { paymentStatus: 'FAILED', capturedPaise: 12000, canViewReceipt: false } });
  assert.doesNotMatch(await f.render('failed'), /Start a new checkout/);
});

test('success requires settlement plus a known active order and never clears reviewed or unknown orders', async () => {
  for (const options of [
    { document: { paymentSettled: false } },
    { document: { orderStatus: 'UNKNOWN' } },
    { document: { capturedPaise: 11999 } },
    { order: { paymentReviewRequired: true } },
    { document: { paymentStatus: 'PENDING', capturedPaise: 0 } },
  ]) {
    const f = await fixture(options);
    const html = await f.render('success');
    assert.doesNotMatch(html, /Order successful|data-clear-cart|Start a new checkout/);
    assert.match(html, /do not pay again/);
  }
});

test('status preserves actual event history and owner-only real shipment/documents, without placeholders', async () => {
  const f = await fixture({ order: { fulfilmentStatus: 'ON_THE_WAY',
    history: [ { domain: 'payment', toStatus: 'PAID', createdAt: '2026-11-01T10:00:00Z' },
      { domain: 'fulfilment', toStatus: 'ON_THE_WAY', createdAt: '2026-11-02T10:00:00Z' },
      { domain: 'internal', toStatus: 'PRIVATE_INTERNAL', createdAt: '2026-11-02T10:00:00Z' } ],
    delivery: { method: 'courier', carrier: 'Example courier', trackingNumber: 'track-123', trackingUrl: 'javascript:alert(1)' },
  } });
  const html = await f.render('status');
  assert.match(html, /Status timeline|Example courier|track-123|Payment receipt/);
  assert.doesNotMatch(html, /javascript:|PRIVATE_INTERNAL|Shipment details will appear|Order progress|View invoice/);
  assert.match(html, /href="\/account\/orders\/safe-reference\/receipt"/);
  const delivered = await fixture({ document: { canViewInvoice: true } });
  assert.match(await delivered.render('status'), /href="\/account\/orders\/safe-reference\/receipt\?document=invoice"/);
});

test('one order-scoped layout wraps every branch using shared nav/footer and responsive design values', async () => {
  const jiti = loadJiti({
    '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav': { GlobalNav: () => createElement('nav', null, 'Store navigation') },
    '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter': { GlobalFooter: () => createElement('footer', null, 'Store footer') },
  });
  const { default: Layout } = await jiti.import(path.join(root, 'src/app/order/layout.tsx'));
  const html = renderToStaticMarkup(createElement(Layout, null, createElement('h1', null, 'Any result or access state')));
  assert.match(html, /<nav>Store navigation<\/nav>[\s\S]*<main[^>]*>[\s\S]*Any result or access state[\s\S]*<footer>Store footer/);
  assert.match(html, /max-w-\[1440px\]|px-4|sm:px-8|transducer/);
});
