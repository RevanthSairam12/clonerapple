import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isConfirmedRecoveryPayment,
  paymentRetryAfterSeconds,
  safePaymentStatusUrl,
} from '../src/lib/checkout/payment-recovery.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('reservation recovery accepts only the exact relative status path and one txnid', () => {
  assert.equal(safePaymentStatusUrl('/order/status?txnid=order-123'), '/order/status?txnid=order-123');
  assert.equal(safePaymentStatusUrl('/order/status?txnid=a%2Fb%26c'), '/order/status?txnid=a%2Fb%26c');
  for (const value of [
    undefined, null, {}, 12, '', '/order/status', '/order/status?txnid=',
    '/order/status?txnid=%20', '/order/status?txnid=%00', '/order/status?txnid=%ZZ',
    '//evil.example/order/status?txnid=1', 'https://evil.example/order/status?txnid=1',
    'https://store.example/order/status?txnid=1', 'javascript:alert(1)',
    '/order/status/other?txnid=1', '/order/status/?txnid=1',
    '/other/../order/status?txnid=1', '/order/status?txnid=1#receipt',
    '/order/status?txnid=1&next=https://evil.example', '/order/status?txnid=1&rt=secret',
    '/order/status?txnid=1&txnid=2', '/order/status?txnid=1&',
    '/order/status?next=1&txnid=2', '/order/status?txnid=1?next=2',
    '/order/status?txnid=1\\evil', ' /order/status?txnid=1',
  ]) assert.equal(safePaymentStatusUrl(value), null, String(value));
});

test('only an effective PAID response permits recovery success navigation', () => {
  assert.equal(isConfirmedRecoveryPayment({ ok: true, status: 'PAID' }), true);
  for (const status of ['PROCESSING', 'PENDING', 'FAILED', 'CANCELLED', 'CREATED', 'success', 'paid', 'UNKNOWN']) {
    assert.equal(isConfirmedRecoveryPayment({ ok: true, status, retryable: true }), false, status);
  }
  for (const value of [null, undefined, {}, { status: 'PAID' }, { ok: false, status: 'PAID' }, { ok: 'true', status: 'PAID' }, { ok: true, verified: true }]) {
    assert.equal(isConfirmedRecoveryPayment(value), false);
  }
});

test('Retry-After seconds and dates are respected without automatic retries', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(paymentRetryAfterSeconds('45', now), 45);
  assert.equal(paymentRetryAfterSeconds('Mon, 02 Nov 2026 12:01:00 GMT', now), 60);
  assert.equal(paymentRetryAfterSeconds('Mon, 02 Nov 2026 11:00:00 GMT', now), 1);
  assert.equal(paymentRetryAfterSeconds(null, now), 30);
  assert.equal(paymentRetryAfterSeconds('invalid', now), 30);
});

test('verification is an explicit POST with only a confirmed-payment success destination', () => {
  const button = source('src/components/checkout/CheckPaymentButton.tsx');
  assert.match(button, /onClick=\{checkPayment\}/);
  assert.match(button, /method: 'POST'/);
  assert.match(button, /\/api\/account\/orders\/\$\{encodeURIComponent\(txnid\)\}\/verify/);
  assert.match(button, /if \(isConfirmedRecoveryPayment\(result\)\)/);
  assert.match(button, /router\.push\(`\/order\/success\?txnid=\$\{encodeURIComponent\(txnid\)\}&recovery=1`\)/);
  assert.match(button, /response\.status === 429/);
  assert.match(button, /response\.headers\.get\('Retry-After'\)/);
  assert.doesNotMatch(button, /useEffect|setInterval|setTimeout|form\.submit|\/api\/payu\/initiate|router\.refresh/);
});

test('summary-only result viewers do not get the mutation button or recovery success loops', () => {
  const shared = source('src/components/orders/OrderResultPage.tsx');
  assert.match(shared, /state\.canCheck \? access === 'owner' \? <CheckPaymentButton txnid=\{order\.txnid\}/);
  assert.match(shared, /preserveCart \? '&recovery=1' : ''/);
  assert.doesNotMatch(shared, /href=\{[^}]*\/order\/success/);
  for (const route of ['success', 'status', 'processing', 'failed', 'cancelled']) {
    assert.match(source(`src/app/order/${route}/page.tsx`), new RegExp(`OrderResultPage\\(\\{ \\.\\.\\.props, route: '${route}' \\}\\)`));
  }
});

test('the single cart-clearing mount requires authorized confirmed active payment and normal checkout', () => {
  const shared = source('src/components/orders/OrderResultPage.tsx');
  assert.match(shared, /const preserveCart = recovery === '1'/);
  assert.equal((shared.match(/<ClearCartOnSuccess \/>/g) || []).length, 1);
  assert.match(shared, /route === 'success' && state\.confirmedActiveOrder && !preserveCart && <ClearCartOnSuccess \/>/);
  const authorized = shared.indexOf('if (!access)');
  const policyRead = shared.indexOf('await getCustomerDocumentState(order.id)');
  assert.ok(authorized > 0 && authorized < policyRead);
  assert.ok(policyRead < shared.indexOf('<ClearCartOnSuccess'));
  const policy = source('src/lib/orders/result-state.ts');
  assert.match(policy, /state\.capturedPaise >= state\.totalPaise/);
  assert.match(policy, /settled && state\.label === 'Paid' && activeOrder && state\.orderStatus !== 'CANCELLED'/);
  assert.match(policy, /state\.paymentSettled === true/);
});

test('an active reservation stops checkout before the gateway form and exposes only a validated link', () => {
  const checkout = source('src/components/checkout/CheckoutForm.tsx');
  assert.match(checkout, /if \(isSubmitting \|\| activeReservation\) return/);
  assert.match(checkout, /res\.status === 409 && data\.code === 'reservation_active'/);
  assert.match(checkout, /statusUrl: safePaymentStatusUrl\(data\.statusUrl\)/);
  assert.match(checkout, /href=\{activeReservation\.statusUrl\} prefetch=\{false\}/);
  assert.match(checkout, /dateTime=\{activeReservation\.expiresAt\}/);
  assert.match(checkout, /disabled=\{isSubmitting \|\| Boolean\(activeReservation\)/);
  assert.ok(checkout.indexOf("data.code === 'reservation_active'") < checkout.indexOf('const { actionUrl, fields }'));
});
