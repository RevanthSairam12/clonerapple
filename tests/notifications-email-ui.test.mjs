import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultTemplate,
  renderEmail,
  templateValues,
} from '../src/lib/notifications/templates.ts';
import {
  formatEmailDate,
  formatPaymentMethodLabel,
  loadEmailOrderDetail,
} from '../src/lib/notifications/order-email-data.ts';

const BASE_URL = 'https://gadzio.test';

function makeBaseDetail(event, overrides = {}) {
  return {
    event,
    txnid: 'GDZ1042001',
    orderNumber: '1042',
    hasCustomerAccount: true,
    orderDate: '14 Nov 2026',
    currency: 'INR',
    orderStatus: 'PAID',
    fulfilmentStatus: 'PROCESSING',
    subtotalPaise: 550000,
    discountPaise: 25000,
    shippingPaise: 0,
    totalPaise: 525000,
    couponCode: 'FESTIVE250',
    paymentMethod: 'PayU (UPI)',
    paymentStatus: 'Paid',
    transactionId: 'MIH40399881234',
    paymentDate: '14 Nov 2026',
    paidAmountPaise: 525000,
    paymentFailureReason: null,
    items: [
      {
        productId: 'prod-mag-case',
        productName: 'MagSafe Silicone Case',
        quantity: 2,
        unitPricePaise: 150000,
        lineTotalPaise: 300000,
        imageUrl: '/sites/apple-clone/media/case-red.png',
        imageAlt: 'MagSafe Silicone Case',
        deviceModelName: 'iPhone 16 Pro',
        colourName: 'Crimson Red',
      },
      {
        productId: 'prod-usb-cable',
        productName: 'Braided USB-C Fast Cable',
        quantity: 1,
        unitPricePaise: 250000,
        lineTotalPaise: 250000,
        imageUrl: 'https://cdn.gadzio.test/media/cable.png',
        imageAlt: 'Braided USB-C Fast Cable',
        colourName: 'Midnight Black',
      },
    ],
    shippingAddress: {
      fullName: 'Asha Rao',
      phone: '+91 98765 43210',
      line1: '2845 MG Road, Indiranagar',
      line2: '2nd Stage',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560038',
    },
    estimatedDelivery: '17 Nov – 19 Nov 2026',
    processingStatus: 'Processing — Packing in Progress',
    expectedDispatch: '15 Nov 2026',
    courierPartner: 'BlueDart Express',
    trackingId: 'BD778899001IN',
    trackingUrl: 'https://track.bluedart.test/BD778899001IN',
    dispatchDate: '15 Nov 2026',
    deliveredDate: '18 Nov 2026',
    cancellationReason: 'Customer asked to cancel',
    refundEligibility: 'Eligible for full refund to original payment method',
    refundAmountPaise: 525000,
    refundStatus: 'Refund Initiated (5–7 business days)',
    refundId: 'REFRQ_900123',
    refundReference: 'UTR9988776655',
    refundMethod: 'UPI',
    refundInitiationDate: '18 Nov 2026',
    refundProcessingDate: '20 Nov 2026',
    refundExpectedTime: '5–7 business days',
    supportEmail: 'support@gadzio.test',
    supportPhone: '+91 63048 59367',
    ...overrides,
  };
}

function makeValues(detail, extra = {}) {
  return templateValues({
    audience: 'customer',
    txnid: detail.txnid,
    orderNumber: detail.orderNumber,
    customerName: 'Asha Rao',
    orderTotalPaise: detail.totalPaise,
    shippingPaise: detail.shippingPaise,
    refundPaise: detail.refundAmountPaise,
    discountPaise: detail.discountPaise,
    couponCode: detail.couponCode,
    orderStatus: detail.orderStatus,
    trackingNumber: detail.trackingId,
    trackingLink: detail.trackingUrl,
    itemCount: detail.items.reduce((sum, item) => sum + item.quantity, 0),
    storeName: 'Gadzio',
    supportEmail: detail.supportEmail,
    supportPhone: detail.supportPhone,
    adminLink: `/order/status?txnid=${encodeURIComponent(detail.txnid)}`,
    ...extra,
  });
}

function assertMatchesCardShell(html, text) {
  // Blush pink canvas, white rounded card, warm total band, magenta accent, help + copyright
  assert.match(html, /#fef2f4/i);
  assert.match(html, /border-radius:16px/);
  assert.match(html, /Order#:<\/strong>/);
  assert.match(html, /#f8f4f5/i);
  assert.match(html, /border-radius:50%;background-color:#111111[^>]*>i<\/span>/);
  assert.match(html, /#c82362/i);
  assert.match(html, /https:\/\/gadzio\.test\/support/);
  assert.match(html, />Need Help\?<\/a>/);
  assert.match(html, /&copy; GADZIO /);
  assert.ok(text.length > 40);
}

test('1. order_placed (Order Accepted) includes all required fields and card UI elements', () => {
  const detail = makeBaseDetail('order_placed', { paymentStatus: 'Pay on Delivery' });
  const out = renderEmail(defaultTemplate('order_placed', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Order Accepted!/);
  assert.match(out.html, /1042 \(GDZ1042001\)/);
  assert.match(out.html, /14 Nov 2026/);
  assert.match(out.html, /Shipping Address:/);
  assert.match(out.html, /2845 MG Road, Indiranagar/);
  assert.match(out.html, /Bengaluru, Karnataka, 560038/);
  // Product thumbnails in pastel circles + details + qty + prices
  assert.match(out.html, /background-color:#fadadd/);
  assert.match(out.html, /https:\/\/gadzio\.test\/sites\/apple-clone\/media\/case-red\.png/);
  assert.match(out.html, /https:\/\/cdn\.gadzio\.test\/media\/cable\.png/);
  assert.match(out.html, /MagSafe Silicone Case/);
  assert.match(out.html, /Model: iPhone 16 Pro/);
  assert.match(out.html, /Color: Crimson Red/);
  assert.match(out.html, /Qty: 2/);
  assert.match(out.html, /Subtotal/);
  assert.match(out.html, /Shipping/);
  assert.match(out.html, /Free/);
  assert.match(out.html, /Total:/);
  assert.match(out.html, /5,250\.00/);
  assert.match(out.html, /PayU \(UPI\)/);
  assert.match(out.html, /Pay on Delivery/);
  assert.match(out.html, /17 Nov – 19 Nov 2026/);
  assert.match(out.html, /href="https:\/\/gadzio\.test\/order\/status\?txnid=GDZ1042001"[^>]*>View Order<\/a>/);
});

test('2. payment_received (Payment Successful) includes transaction details, payment receipt & order status link', () => {
  const detail = makeBaseDetail('payment_received');
  const out = renderEmail(defaultTemplate('payment_received', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Payment Successful!/);
  assert.match(out.html, /MIH40399881234/);
  assert.match(out.html, /Payment Amount/);
  assert.match(out.html, /Payment Method/);
  assert.match(out.html, /PayU \(UPI\)/);
  assert.match(out.html, /Payment Date/);
  assert.match(out.html, /Order ID/);
  assert.match(out.html, /href="https:\/\/gadzio\.test\/account\/orders\/GDZ1042001\/receipt"[^>]*>Payment Receipt<\/a>/);
  assert.match(out.html, /https:\/\/gadzio\.test\/order\/status\?txnid=GDZ1042001/);
});

test('3. processing (Order Processing) includes order details, status, expected dispatch & support button', () => {
  const detail = makeBaseDetail('processing');
  const out = renderEmail(defaultTemplate('processing', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Order is Processing!/);
  assert.match(out.html, /Processing Status/);
  assert.match(out.html, /Processing — Packing in Progress/);
  assert.match(out.html, /Expected Dispatch Date/);
  assert.match(out.html, /15 Nov 2026/);
  assert.match(out.html, /href="https:\/\/gadzio\.test\/support"[^>]*>Customer Support<\/a>/);
});

test('4. shipped (Order Shipped) includes courier partner, tracking ID, https tracking URL, dispatch & ETA', () => {
  const detail = makeBaseDetail('shipped');
  const out = renderEmail(defaultTemplate('shipped', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Your Order Has Shipped!/);
  assert.match(out.html, /BlueDart Express/);
  assert.match(out.html, /BD778899001IN/);
  assert.match(out.html, /https:\/\/track\.bluedart\.test\/BD778899001IN/);
  assert.match(out.html, /Dispatch Date/);
  assert.match(out.html, /15 Nov 2026/);
  assert.match(out.html, /Estimated Delivery/);
  assert.match(out.html, /17 Nov – 19 Nov 2026/);
  assert.match(out.html, /href="https:\/\/track\.bluedart\.test\/BD778899001IN"[^>]*>Track Shipment<\/a>/);
});

test('5. delivered (Order Delivered) includes delivered date, products, summary, Report an Issue & Review Products buttons', () => {
  const detail = makeBaseDetail('delivered');
  const out = renderEmail(defaultTemplate('delivered', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Order Delivered!/);
  assert.match(out.html, /Delivered Date/);
  assert.match(out.html, /18 Nov 2026/);
  assert.match(out.html, /MagSafe Silicone Case/);
  assert.match(out.html, /Order Summary/);
  assert.match(out.html, /2 items · Total/);
  assert.match(out.html, /href="https:\/\/gadzio\.test\/shop\/product\/prod-mag-case"[^>]*>Review Products<\/a>/);
  assert.match(out.html, /href="https:\/\/gadzio\.test\/account\/orders\/GDZ1042001"[^>]*>Report an Issue<\/a>/);
});

test('6. cancelled (Order Cancellation) includes confirmation, products, reason, refund eligibility & status', () => {
  const detail = makeBaseDetail('cancelled');
  const out = renderEmail(defaultTemplate('cancelled', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Order Cancelled/);
  assert.match(out.html, /Cancellation Confirmation/);
  assert.match(out.html, /Customer asked to cancel/);
  assert.match(out.html, /Refund Eligibility/);
  assert.match(out.html, /Eligible for full refund to original payment method/);
  assert.match(out.html, /Refund Amount &amp; Status/);
  assert.match(out.html, /Refund Initiated \(5–7 business days\)/);
  assert.match(out.html, /MagSafe Silicone Case/);

  // Reason omitted gracefully when unavailable
  const noReason = makeBaseDetail('cancelled', { cancellationReason: null });
  const outNoReason = renderEmail(defaultTemplate('cancelled', 'email', 'customer'), makeValues(noReason), BASE_URL, noReason);
  assert.doesNotMatch(outNoReason.html, /Cancellation Reason/);
});

test('7. refund_pending (Refund Initiated) includes refund ID, original txnid, amount, method, initiation & processing time', () => {
  const detail = makeBaseDetail('refund_pending');
  const out = renderEmail(defaultTemplate('refund_pending', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Refund Initiated!/);
  assert.match(out.html, /REFRQ_900123/);
  assert.match(out.html, /Original Transaction ID/);
  assert.match(out.html, /MIH40399881234/);
  assert.match(out.html, /Refund Amount/);
  assert.match(out.html, /5,250\.00/);
  assert.match(out.html, /Refund Method/);
  assert.match(out.html, /UPI/);
  assert.match(out.html, /Initiation Date/);
  assert.match(out.html, /18 Nov 2026/);
  assert.match(out.html, /Expected Processing Time/);
  assert.match(out.html, /5–7 business days/);
});

test('8. refund_completed (Refund Successful) includes confirmation, amount, ref, original method, processing date & disclaimer', () => {
  const detail = makeBaseDetail('refund_completed');
  const out = renderEmail(defaultTemplate('refund_completed', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Refund Successful!/);
  assert.match(out.html, /Refund Confirmation/);
  assert.match(out.html, /Refunded Amount/);
  assert.match(out.html, /5,250\.00/);
  assert.match(out.html, /Refund Reference Number/);
  assert.match(out.html, /UTR9988776655/);
  assert.match(out.html, /Original Payment Method/);
  assert.match(out.html, /PayU \(UPI\)/);
  assert.match(out.html, /Processing Date/);
  assert.match(out.html, /20 Nov 2026/);
  assert.match(out.html, /Bank processing disclaimer/i);
  assert.match(out.html, /3–7 business days/);
});

test('9. payment_failed (Payment Failed) includes failure status, ref, reason, amount charged, Retry button & duplicate payment guidance', () => {
  const detail = makeBaseDetail('payment_failed', {
    orderStatus: 'FAILED',
    paidAmountPaise: 0,
    paymentFailureReason: 'The payment was declined by your bank or payment provider.',
  });
  const out = renderEmail(defaultTemplate('payment_failed', 'email', 'customer'), makeValues(detail), BASE_URL, detail);

  assertMatchesCardShell(out.html, out.text);
  assert.match(out.html, /Payment Failed/);
  assert.match(out.html, /Payment Failure Status/);
  assert.match(out.html, /Order \/ Payment Reference/);
  assert.match(out.html, /Failure Reason/);
  assert.match(out.html, /declined by your bank/);
  assert.match(out.html, /Amount Charged, if any/);
  assert.match(out.html, /No amount charged/);
  assert.match(out.html, /href="https:\/\/gadzio\.test\/order\/failed\?txnid=GDZ1042001"[^>]*>Retry Payment<\/a>/);
  assert.match(out.html, /Duplicate payment support instructions/i);
  assert.match(out.html, /Customer Support/);
});

test('XSS payloads and unsafe javascript URLs inside detail fields are escaped or stripped', () => {
  const evil = makeBaseDetail('shipped', {
    trackingUrl: 'javascript:alert(1)',
    courierPartner: '<script>alert("courier")</script>',
    items: [
      {
        productId: 'p1',
        productName: '<img src=x onerror=alert(1)>',
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000,
        imageUrl: 'javascript:alert(2)',
        colourName: '<b onmouseover=alert(3)>Red</b>',
      },
    ],
    shippingAddress: {
      fullName: '<script>x</script>',
      line1: 'Road 1',
      city: 'Hyderabad',
      state: 'TS',
      postalCode: '500001',
    },
  });

  const out = renderEmail(defaultTemplate('shipped', 'email', 'customer'), makeValues(evil), BASE_URL, evil);
  assert.doesNotMatch(out.html, /<script/i);
  assert.doesNotMatch(out.html, /<img[^>]*onerror=/i);
  assert.doesNotMatch(out.html, /<[^>]*onmouseover=/i);
  assert.doesNotMatch(out.html, /javascript:/i);
  assert.match(out.html, /&lt;script&gt;alert\(&quot;courier&quot;\)&lt;\/script&gt;/);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out.html, /&lt;b onmouseover=alert\(3\)&gt;Red&lt;\/b&gt;/);
  // Safe fallback Track Shipment points to order status instead of stripped javascript: URL
  assert.match(out.html, /https:\/\/gadzio\.test\/order\/status\?txnid=GDZ1042001/);
});

test('order-email-data helpers format labels safely and tolerate partial DB failures', async () => {
  assert.equal(formatPaymentMethodLabel('upi', 'payu'), 'PayU (UPI)');
  assert.equal(formatPaymentMethodLabel(null, 'cod'), 'Cash on Delivery');
  assert.equal(formatEmailDate('2026-11-14T10:00:00Z'), '14 Nov 2026');

  // Mock sql tagged template: returns base order on `from orders`, throws on optional tables
  let callIndex = 0;
  const mockSql = async (strings) => {
    callIndex += 1;
    const text = strings.join(' ');
    if (text.includes('from orders')) {
      return [
        {
          row_data: {
            id: 'ord_1',
            txnid: 'GDZ999',
            order_number: 999,
            status: 'PAID',
            subtotal_paise: 100000,
            discount_paise: 0,
            shipping_paise: 0,
            total_paise: 100000,
            payment_method: 'payu',
            payu_mode: 'UPI',
            payu_mihpayid: 'MIH999',
            created_at: '2026-11-14T10:00:00Z',
            items: [
              { id: 'item-1', name: 'Adapter', quantity: 1, unitPrice: 1000, totalPrice: 1000 },
            ],
          },
        },
      ];
    }
    throw new Error('simulated missing optional table');
  };

  const detail = await loadEmailOrderDetail({
    sql: mockSql,
    txnid: 'GDZ999',
    event: 'order_placed',
  });

  assert.ok(callIndex > 1);
  assert.ok(detail);
  assert.equal(detail.orderNumber, '999');
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].productName, 'Adapter');
  assert.equal(detail.transactionId, 'MIH999');
  assert.equal(detail.paymentMethod, 'PayU (UPI)');
});
