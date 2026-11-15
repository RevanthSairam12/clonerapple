import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const { orderTotals } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'order-documents.ts'),
);

function order(overrides = {}) {
  return {
    items: [
      { lineTotalPaise: 3000 },
      { lineTotalPaise: 2000 },
    ],
    subtotalPaise: 0,
    discountPaise: 0,
    shippingPaise: 0,
    totalPaise: 0,
    amount: 50,
    paymentStatus: 'PAID',
    ...overrides,
  };
}

test('legacy web orders fall back to item lines and the amount column', () => {
  const totals = orderTotals(order());
  assert.equal(totals.subtotalPaise, 5000);
  assert.equal(totals.totalPaise, 5000);
  assert.equal(totals.balancePaise, 0);
  assert.equal(totals.paid, true);
});

test('discount and shipping are passed through when stored', () => {
  const totals = orderTotals(
    order({ subtotalPaise: 10000, discountPaise: 1500, shippingPaise: 990, totalPaise: 9490 }),
  );
  assert.equal(totals.subtotalPaise, 10000);
  assert.equal(totals.discountPaise, 1500);
  assert.equal(totals.shippingPaise, 990);
  assert.equal(totals.totalPaise, 9490);
});

test('a stored total wins over the legacy amount column', () => {
  const totals = orderTotals(
    order({ subtotalPaise: 10000, discountPaise: 0, shippingPaise: 0, totalPaise: 8800, amount: 100 }),
  );
  assert.equal(totals.totalPaise, 8800);
});

test('legacy documents do not infer shipping from a total remainder', () => {
  const totals = orderTotals(order({ amount: 60 }));
  assert.equal(totals.subtotalPaise, 5000);
  assert.equal(totals.totalPaise, 6000);
  assert.equal(totals.shippingPaise, 0);
});

test('a fallback calculated total adds the stored shipping exactly once', () => {
  const totals = orderTotals(order({ amount: 0, subtotalPaise: 10000,
    discountPaise: 1500, shippingPaise: 5001 }));
  assert.equal(totals.totalPaise, 13501);
  assert.equal(totals.shippingPaise, 5001);
});

test('an unpaid order carries the balance due', () => {
  const totals = orderTotals(order({ totalPaise: 5000, paymentStatus: 'PENDING' }));
  assert.equal(totals.paid, false);
  assert.equal(totals.balancePaise, 5000);
});

test('a discount can never exceed the subtotal', () => {
  const totals = orderTotals(order({ subtotalPaise: 3000, discountPaise: 9000, totalPaise: 0 }));
  assert.equal(totals.discountPaise, 3000);
});

// Presentation imports are isolated from all database/loader modules. Any attempt
// to add a data read to the shared renderer fails instead of connecting to a DB.
const money = (value) => `₹${(value / 100).toFixed(2)}`;
const renderJiti = createJiti(import.meta.url, {
  moduleCache: false,
  jsx: { runtime: 'automatic' },
  alias: { '@': path.join(here, '..', 'src') },
  virtualModules: {
    '@/lib/catalog/storefront': { formatPaise: money },
    '@/lib/store-admin/order-documents': { formatRupees: money },
    '@/lib/store-admin/catalog': { formatDate: (value) => String(value) },
  },
});
const { OrderDocument, OrderDocumentStatus, buildOrderBarcodeValue } = await renderJiti.import(
  path.join(here, '..', 'src/components/orders/OrderDocument.tsx'),
);
const { deriveDocumentState, projectCustomerDocumentState } = await renderJiti.import(
  path.join(here, '..', 'src/lib/orders/document-policy.ts'),
);
const documentOrder = {
  txnid: 'ORDER-ONLY', createdAt: '2026-11-02T00:00:00Z', currency: 'INR',
  items: [{ lineNumber: 1, productName: 'PRIVATE ITEM SNAPSHOT', quantity: 1,
    unitPricePaise: 10000, lineTotalPaise: 10000,
    variantId: 'durable-variant', variantSku: 'IMMUTABLE-SKU', variantLabel: 'Original model / Blue' }],
};
const baseFacts = { paymentStatus: 'PAID', fulfilmentStatus: 'ACCEPTED',
  totalPaise: 10000, capturedPaise: 10000 };
const documentTotals = { subtotalPaise: 10000, discountPaise: 0,
  shippingPaise: 0, totalPaise: 10000, balancePaise: 0, paid: true };
function renderDocument(facts, customer = false) {
  return renderToStaticMarkup(createElement(OrderDocument, {
    order: documentOrder, totals: documentTotals,
    state: deriveDocumentState(facts), customer,
  }));
}

test('status-only customer and staff documents do not render an itemized bill', () => {
  for (const customer of [false, true]) {
    for (const facts of [...(customer ? [] : [baseFacts]), { ...baseFacts, paymentStatus: 'PROCESSING' },
      { ...baseFacts, paymentStatus: 'FAILED' },
      { ...baseFacts, paymentStatus: 'CANCELLED', fulfilmentStatus: 'CANCELED', channel: 'pos' }]) {
      const html = renderDocument(facts, customer);
      assert.match(html, /Status only/);
      assert.match(html, /not a bill or proof of payment/);
      assert.doesNotMatch(html, /PRIVATE ITEM SNAPSHOT|<table|Bill to|Ship to/);
    }
  }
});

test('customer paid receipt needs no historical request and uses no invoice or bill wording', () => {
  const html = renderDocument({ ...baseFacts, billRequested: true }, true);
  assert.match(html, /PRIVATE ITEM SNAPSHOT/);
  assert.match(html, /IMMUTABLE-SKU/);
  assert.match(html, /Original model \/ Blue/);
  assert.match(html, /Payment receipt/);
  assert.doesNotMatch(html, /invoice|bill|provisional|request/i);
  assert.doesNotMatch(html, /<dt>Invoice ref|<dt>Invoice issued/);
});

test('issued delivered invoice retains reference and prominent completed/pending refund facts', () => {
  const html = renderDocument({ ...baseFacts, fulfilmentStatus: 'DELIVERED', shipmentStarted: true,
    billRequested: true,
    invoiceNumber: 'PERMANENT-0007', invoiceIssuedAt: '2026-10-31T00:00:00Z',
    refundedPaise: 2500, pendingRefundPaise: 1500, refundDuePaise: 1000 }, true);
  for (const text of ['PERMANENT-0007', '2026-10-31T00:00:00Z', 'Refund Initiated',
    'DELIVERED', 'Refund successful (partial)', '₹25.00', '₹15.00', '₹10.00', '₹75.00']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /not confirmation of a current paid sale/);
  assert.doesNotMatch(html, />Paid<|is-paid/);
});

test('legacy document does not turn the order reference into an invoice number', () => {
  const html = renderDocument({ ...baseFacts, fulfilmentStatus: 'DELIVERED' });
  assert.match(html, /Legacy document/);
  assert.match(html, /order reference is not an invoice number/);
  assert.doesNotMatch(html, /<dt>Invoice ref|<dt>Invoice issued/);
});

test('payment summary component stays PII-free and distinguishes refund obligations', () => {
  const state = deriveDocumentState({ ...baseFacts, fulfilmentStatus: 'CANCELED', refundDuePaise: 10000 });
  const html = renderToStaticMarkup(createElement(OrderDocumentStatus, { state, customer: true }));
  assert.match(html, /Cancelled/);
  assert.match(html, /Refund due — not yet initiated/);
  assert.doesNotMatch(html, /PRIVATE ITEM SNAPSHOT|ORDER-ONLY|@|Refund Initiated|>Paid</);
});


test('customer renderer defensively hides an already-issued shipment invoice even for status-only review', () => {
  for (const fulfilmentStatus of ['ACCEPTED', 'ON_THE_WAY', 'CANCELED']) {
    for (const paymentReviewRequired of [false, true]) {
      const html = renderDocument({ ...baseFacts, fulfilmentStatus, paymentReviewRequired,
        invoiceNumber: 'SECRET-INVOICE-REF', invoiceIssuedAt: 'SECRET-ISSUED-DATE', billRequested: true }, true);
      assert.doesNotMatch(html, /SECRET-INVOICE-REF|SECRET-ISSUED-DATE|Invoice ref|Invoice issued|Bill of supply|provisional|request a bill/i);
      if (!paymentReviewRequired) assert.match(html, /Payment receipt/);
    }
  }
});

test('delivered customer legacy receipt never invents an invoice or calls itself a bill', () => {
  const html = renderDocument({ ...baseFacts, fulfilmentStatus: 'DELIVERED' }, true);
  assert.match(html, /Payment receipt/);
  assert.doesNotMatch(html, /invoice|bill|legacy/i);
});

test('staff shipment-time invoice and POS access are unchanged', () => {
  for (const [fulfilmentStatus, channel] of [['ON_THE_WAY','web'], ['DELIVERED','pos']]) {
    const html = renderDocument({ ...baseFacts, fulfilmentStatus, channel,
      invoiceNumber: 'STAFF-ISSUED', invoiceIssuedAt: '2026-11-01T00:00:00Z' });
    assert.match(html, /STAFF-ISSUED/);
    assert.match(html, /Bill of supply/);
    assert.match(html, /PRIVATE ITEM SNAPSHOT/);
  }
});


test('delivered invoice refund stamps remain truthful for full, partial, pending, failed and rejected outcomes', () => {
  for (const [refund, label] of [
    [{refundedPaise:10000}, 'Refund Successful'],
    [{refundedPaise:2500}, 'Refund Successful — Partial'],
    [{pendingRefundPaise:10000}, 'Refund Initiated'],
    [{lastRefundOutcome:'FAILED'}, 'FAILED'],
    [{lastRefundOutcome:'REJECTED'}, 'REJECTED'],
  ]) {
    const html = renderDocument({...baseFacts,fulfilmentStatus:'DELIVERED',billRequested:true,invoiceNumber:'REFUND-INVOICE',
      invoiceIssuedAt:'2026-11-01',...refund}, true);
    assert.ok(html.includes(label),label);
    assert.match(html,/REFUND-INVOICE/);
    if (refund.refundedPaise || refund.pendingRefundPaise) assert.doesNotMatch(html,/>Paid</);
  }
});

test('explicit unavailable invoice state stays status-only when passed through customer renderer again', () => {
  const state = projectCustomerDocumentState(deriveDocumentState({...baseFacts,
    fulfilmentStatus:'ON_THE_WAY',invoiceNumber:'INTERNAL-INVOICE',invoiceIssuedAt:'INTERNAL-DATE'}),'invoice');
  const html = renderToStaticMarkup(createElement(OrderDocument, {
    order:documentOrder,totals:documentTotals,state,customer:true,
  }));
  assert.match(html,/Status only/);
  assert.doesNotMatch(html,/Payment receipt|PRIVATE ITEM SNAPSHOT|INTERNAL-INVOICE|INTERNAL-DATE/);
});

test('staff cancelled issued documents retain immutable identity and refund overlay', () => {
  const html = renderDocument({...baseFacts,fulfilmentStatus:'CANCELED',shipmentStarted:true,
    invoiceNumber:'STAFF-CANCELLED',invoiceIssuedAt:'2026-11-01',refundedPaise:10000});
  assert.match(html,/STAFF-CANCELLED/); assert.match(html,/Refund Successful/);
  assert.match(html,/CANCELLED/); assert.match(html,/not confirmation of a current paid sale/);
});

test('invoice renders company details, MSME Udyam number, logo on top, and serial number per product', () => {
  const serialOrder = {
    ...documentOrder,
    items: [
      { ...documentOrder.items[0], serialNumber: 'SN-GADZIO-001' },
      { lineNumber: 2, productName: 'Second accessory', quantity: 1, unitPricePaise: 5000, lineTotalPaise: 5000, serialNumber: 'SN-GADZIO-002' },
    ],
  };
  const html = renderToStaticMarkup(createElement(OrderDocument, {
    order: serialOrder,
    totals: documentTotals,
    state: deriveDocumentState({
      ...baseFacts,
      fulfilmentStatus: 'DELIVERED',
      billRequested: true,
      invoiceNumber: 'INV000099',
      invoiceIssuedAt: '2026-11-02T00:00:00Z',
    }),
    customer: true,
  }));
  assert.match(html, /\/gadzio_logo\.png/);
  assert.match(html, /RUPEEDO TECHNOLOGIES/);
  assert.match(html, /UDYAM-AP-12-0109134/);
  assert.match(html, /Serial No:.*SN-GADZIO-001/);
  assert.match(html, /Serial No:.*SN-GADZIO-002/);
});

test('invoice renders Shipped to user name only (no address) and unique order+date barcode at bottom', () => {
  const addressedOrder = {
    ...documentOrder,
    billTo: {
      type: 'billing',
      fullName: 'Billing User',
      phone: '8888888888',
      line1: '99 Secret Billing Lane',
      line2: 'Suite 4',
      city: 'Bengaluru',
      state: 'KA',
      postalCode: '560001',
      country: 'IN',
    },
    shipTo: {
      type: 'shipping',
      fullName: 'Aarav Rao',
      phone: '9999999999',
      line1: '123 MG Road',
      line2: 'Near Metro',
      city: 'Hyderabad',
      state: 'TS',
      postalCode: '500001',
      country: 'IN',
    },
  };
  const html = renderToStaticMarkup(createElement(OrderDocument, {
    order: addressedOrder,
    totals: documentTotals,
    state: deriveDocumentState({
      ...baseFacts,
      fulfilmentStatus: 'DELIVERED',
      billRequested: true,
      invoiceNumber: 'INV000100',
      invoiceIssuedAt: '2026-11-02T00:00:00Z',
    }),
    customer: true,
  }));

  assert.match(html, /Shipped to<\/h2>.*<strong>Aarav Rao<\/strong>/);
  assert.doesNotMatch(html, /Bill to|Billing User|123 MG Road|Near Metro|Hyderabad|500001|9999999999|99 Secret Billing Lane|560001|8888888888/);

  const codeA = buildOrderBarcodeValue('ORDER-ONLY', '2026-11-02T00:00:00Z', new Date('2026-11-15T10:00:00+05:30'));
  const codeDiffOrder = buildOrderBarcodeValue('ORDER-TWO', '2026-11-02T00:00:00Z', new Date('2026-11-15T10:00:00+05:30'));
  const codeDiffDate = buildOrderBarcodeValue('ORDER-ONLY', '2026-11-02T00:00:00Z', new Date('2026-11-16T10:00:00+05:30'));
  assert.notEqual(codeA, codeDiffOrder);
  assert.notEqual(codeA, codeDiffDate);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="Order verification barcode GZ-/);
  assert.ok(html.indexOf('Order verification barcode') > html.indexOf('Order total'));
});

test('saveOrderSerialNumbersUsing saves serial numbers for every item and issues the invoice', async () => {
  const { saveOrderSerialNumbersUsing } = await jiti.import(
    path.join(here, '..', 'src/lib/store-admin/orders.ts'),
  );
  const queries = [];
  const fakeSql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    queries.push({ query, values });
    if (query.startsWith('select id, txnid, status')) {
      return [{ id: 'ord-sn-1', txnid: 'GDZ000010', status: 'PAID', fulfilment_status: 'PROCESSING' }];
    }
    if (query.startsWith('select line_number, product_id')) {
      return [
        { line_number: 1, product_id: 'p1', product_name: 'Item 1' },
        { line_number: 2, product_id: 'p2', product_name: 'Item 2' },
      ];
    }
    if (query.startsWith('select invoice_number')) return [{ invoice_number: null, invoice_issued_at: null }];
    if (query.startsWith('select value from store_settings')) return [{ value: 'INV' }];
    if (query.startsWith('update invoice_number_counters')) return [{ value: '7' }];
    if (query.startsWith('update orders set invoice_sequence')) return [{ invoice_issued_at: '2026-11-02T00:00:00Z' }];
    if (query.startsWith('update') || query.startsWith('insert')) return [];
    throw new Error(`Unexpected SQL: ${query}`);
  };
  fakeSql.begin = async (fn) => fn(fakeSql);
  fakeSql.json = (v) => v;

  const missing = await saveOrderSerialNumbersUsing(fakeSql, {
    txnid: 'GDZ000010',
    serialNumbers: [{ lineNumber: 1, serialNumber: 'SN-1' }],
    staffId: 'staff-1',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'invalid-input');

  const okResult = await saveOrderSerialNumbersUsing(fakeSql, {
    txnid: 'GDZ000010',
    serialNumbers: [
      { lineNumber: 1, serialNumber: 'SN-1' },
      { lineNumber: 2, serialNumber: 'SN-2' },
    ],
    staffId: 'staff-1',
  });
  assert.equal(okResult.ok, true);
  assert.equal(okResult.invoiceNumber, 'INV000007');
  assert.equal(
    queries.filter((q) => q.query.startsWith('update order_items set serial_number')).length,
    2,
  );
});
