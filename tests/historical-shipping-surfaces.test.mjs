import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);

// Execute the actual page/export code without DB, auth, audit or client effects.
// Unknown imports fail closed: historical money must not read checkout policy.
function load(file, mocks) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, console, URL, Response,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'react/jsx-runtime') return nativeRequire(name);
      if (name === 'next/link') return { __esModule: true,
        default: ({ children, prefetch, ...props }) => React.createElement('a', props, children) };
      if (name === 'next/navigation') return { notFound() { throw new Error('not found'); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return module.exports;
}

const documents = load('src/lib/store-admin/order-documents.ts', {
  '@/lib/platform/db': {}, './orders': {},
});
const policy = load('src/lib/orders/document-policy.ts', {});
const sharedMoney = value => `₹${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fulfilment = load('src/lib/orders/fulfilment.ts', {
  '@/lib/store-admin/order-rules': { FULFILMENT_STEPS: ['PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED'] },
});
const emptyList = async () => ({ ok: true, data: [] });
const Null = () => null;
const session = { role: 'store_owner', adminId: 'staff', userId: 'customer', email: 'staff@example.test' };
function fixture(shippingPaise) {
  return {
    id: 'order', txnid: 'OLD-ORDER', orderNumber: null, currency: 'INR', channel: 'web',
    status: 'PAID', paymentStatus: 'PAID', saleState: 'DELIVERED', fulfilmentStatus: 'DELIVERED',
    customerEmail: 'customer@example.test', customer: {}, addresses: [], history: [], requests: [], refunds: [],
    createdAt: new Date('2024-01-02T10:00:00Z'), paidAt: null,
    subtotalPaise: 99_900, discountPaise: 15_000, shippingPaise,
    totalPaise: 84_900 + shippingPaise, amount: (84_900 + shippingPaise) / 100,
    items: [{ id: 'p1', lineNumber: 1, productName: 'Historic item', name: 'Historic item',
      productId: 'p1', quantity: 1, unitPrice: 999, totalPrice: 999,
      unitPricePaise: 99_900, lineTotalPaise: 99_900, referencePricePaise: null }],
  };
}
function mocksFor(order, settings = {}) {
  const mocks = {
    '@/lib/store-admin/order-documents': { ...documents, getOrderDocument: async () => ({ ok: true, data: order }) },
    '@/lib/orders/document-policy': policy,
    '@/lib/orders/document-data': {
      getDocumentState: async () => policy.deriveDocumentState({
        paymentStatus: order.paymentStatus, fulfilmentStatus: order.fulfilmentStatus,
        totalPaise: order.totalPaise, capturedPaise: order.totalPaise,
      }),
      getCustomerDocumentState: async (_orderId, mode) => policy.projectCustomerDocumentState(policy.deriveDocumentState({
        paymentStatus: order.paymentStatus, fulfilmentStatus: order.fulfilmentStatus,
        totalPaise: order.totalPaise, capturedPaise: order.totalPaise,
      }), mode),
    },
    '@/lib/orders/fulfilment': fulfilment,
    '@/lib/orders/option-snapshot': load('src/lib/orders/option-snapshot.ts', {}),
    '@/lib/catalog/storefront': { formatPaise: sharedMoney },
    '@/lib/account/bill-requests': { getBillRequest: async () => null, listBillReasons: async () => [] },
    '@/lib/store-admin/refund-lifecycle': { getRefundRequests: emptyList },
    '@/lib/payu/payment-events': { listPaymentEvents: async () => [] },
    '@/lib/store-admin/delivery': { validateHttpsTrackingUrl: () => null },
    '@/lib/payu/return-access': { resolveReturnAccess: () => 'owner', carryReturnToken: href => href },
    '@/lib/store-admin/orders': { getOrderDetail: async () => ({ ok: true, data: order }) },
    '@/lib/store-admin/auth': { getStoreSession: async () => session },
    '@/lib/store-admin/audit': { writeAudit: async () => true },
    '@/lib/store-admin/settings': { getStoreSettings: async () => ({ ok: true, settings }) },
    '@/lib/store-admin/catalog': { formatDate: () => '2 Jan 2024' },
    '@/lib/orders/numbering': { formatInvoiceReference: () => order.txnid },
    '@/lib/store-admin/order-notes': { listOrderNotes: emptyList },
    '@/lib/store-admin/order-edits': { listOrderEdits: emptyList },
    '@/lib/store-admin/payments': { listOrderPayments: emptyList },
    '@/lib/store-admin/payment-rules': { ANY_METHOD_LABELS: {} },
    '@/lib/store-admin/returns': { listOrderRefunds: emptyList, listOrderReturns: emptyList,
      orderReturnableLines: emptyList, listCancellationReasons: async () => ({ ok: true, reasons: [] }) },
    '@/lib/account/auth': { requireAccountPageSession: async () => session },
    '@/lib/account/config': { RECEIPT_TRADE_NAME: 'Gadzio' },
    '@/lib/account/orders': { getCustomerOrderDetail: async () => order },
    '@/lib/account/order-live': { isInFlightAccountOrderStatus: () => false,
      accountPaymentStatusLabel: value => value, accountDeliveryStatusLabel: () => 'Delivered' },
    '@/lib/payu/orders': { getOrderByTxnid: async () => order },
    '@/lib/order-status': { getCustomerOrderStatus: async () => ({ ok: true, data: order }) },
    '@/lib/orders/result-state': load('src/lib/orders/result-state.ts', {}),
    '@/lib/user-auth': { getUserSession: async () => session },
    '@/components/account/AccountFrame': { AccountFrame: ({ children }) => children },
    '@/components/store-admin/OrderDetailTabs': { OrderDetailTabs: ({ tabs }) => tabs[0].content },
    '@/components/store-admin/DocumentHeader': { DocumentHeader: ({ title, kicker }) =>
      React.createElement('header', null, title, kicker) },
  };
  for (const name of ['PrintButton', 'OrderControls', 'OrderCancelForm', 'RefundForm', 'ReturnForm',
    'CustomerRevealForm', 'OrderPaymentControls', 'OrderNoteForm', 'OrderEditForm', 'OrderTestToggleForm']) {
    mocks[`@/components/store-admin/${name}`] = { [name]: Null };
  }
  for (const name of ['PrintButton', 'LiveOrderPoller', 'OrderRequestButtons', 'OrderStatusChip']) {
    mocks[`@/components/account/${name}`] = { [name]: Null };
  }
  mocks['@/components/store-admin/RefundForm'].RefundRequestActions = Null;
  mocks['@/components/store-admin/VerifyWithPayUButton'] = { VerifyWithPayUButton: Null };
  mocks['@/components/account/RequestBillForm'] = { RequestBillForm: Null };
  mocks['@/components/checkout/ClearCartOnSuccess'] = { ClearCartOnSuccess: Null };
  mocks['@/components/checkout/CheckPaymentButton'] = { CheckPaymentButton: Null };
  mocks['@/components/orders/OrderResultPage'] = load('src/components/orders/OrderResultPage.tsx', mocks);
  // Render the actual shared presentational code, not an empty component mock:
  // monetary assertions must keep covering the extracted invoice/receipt table.
  mocks['@/components/orders/OrderDocument'] = load('src/components/orders/OrderDocument.tsx', mocks);
  return mocks;
}
const admin = 'src/app/(store-admin)/store-admin/(protected)/orders/[txnid]';
const pages = [
  ['admin detail', `${admin}/page.tsx`],
  ['invoice', `${admin}/invoice/page.tsx`],
  ['packing slip', `${admin}/packing-slip/page.tsx`],
  ['customer detail', 'src/app/account/orders/[txnid]/page.tsx'],
  ['receipt', 'src/app/account/orders/[txnid]/receipt/page.tsx'],
  ['success', 'src/app/order/success/page.tsx'],
];
async function render(file, order, settings) {
  const Page = load(file, mocksFor(order, settings)).default;
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ txnid: order.txnid }),
    searchParams: Promise.resolve({ txnid: order.txnid }) }));
}
for (const [name, file] of pages) {
  for (const shippingPaise of [5_001, 0]) {
    test(`${name}: discounted historical order shows stored shipping ${shippingPaise}`, async () => {
      const order = fixture(shippingPaise);
      const html = await render(file, order);
      const text = html.replace(/<[^>]*>/g, '');
      // The concise success result now shows the charged total, not itemized
      // shipping. Account/detail/document surfaces retain the stored breakdown.
      if (name === 'success') {
        assert.match(text, shippingPaise ? /Amount paid₹899\.01/ : /Amount paid₹849(?:\.00)?/);
        assert.doesNotMatch(text, /Shipping|Subtotal|Discount/);
      } else assert.match(text, shippingPaise ? /Shipping₹50\.01/ : /ShippingFree/);
      if (name === 'packing slip') {
        assert.equal((html.match(/₹/g) ?? []).length, shippingPaise ? 1 : 0, 'only shipping money is shown');
        assert.doesNotMatch(text, /Subtotal|Discount|Total|₹999|carries no prices/);
        assert.match(text, /Item prices are intentionally omitted/);
      } else if (name !== 'success') {
        assert.match(text, shippingPaise ? /(?:Total(?: Paid)?|Order total)₹899\.01/ : /(?:Total(?: Paid)?|Order total)₹849(?:\.00)?/);
      }
      // Document settings are allowed for branding, never for repricing.
      assert.equal(await render(file, order, { shipping_enabled: 'false',
        shipping_charge_paise: '99999', free_shipping_over: '1' }), html);
    });
  }
}

test('order CSV exports stored shipping separately without adding it to the charged total', async () => {
  const rows = [fixture(5_001), fixture(0)].map(order => ({ ...order,
    amountPaise: order.totalPaise, customerNameMasked: 'C***', customerEmailMasked: 'c***',
    customerPhoneMasked: '***', itemLines: 1 }));
  const { GET } = load('src/app/api/store-admin/orders/export/route.ts', {
    '@/lib/store-admin/auth': { requireStoreRole: async () => ({ ok: true, session }) },
    '@/lib/store-admin/audit': { writeAudit: async () => true },
    '@/lib/store-admin/delivery': { isDateOnly: () => true },
    '@/lib/store-admin/orders': {
      listOrdersForExport: async () => ({ ok: true, data: rows }),
      parseOrderTestFilter: (value) => (value === 'live' || value === 'test' ? value : 'all'),
    },
    '@/lib/store-admin/report-rules': { storeDay: () => '2026-11-01' },
    '@/lib/store-admin/store-clock': { getDatabaseNow: async () => new Date(), getStoreTimeZone: async () => 'Asia/Kolkata' },
  });
  const response = await GET(new Request('https://example.test/api/store-admin/orders/export'));
  assert.equal(response.status, 200);
  const lines = (await response.text()).trim().split('\r\n');
  assert.match(lines[0], /Amount,Shipping,Currency/);
  assert.match(lines[1], /,899\.01,50\.01,INR,1$/);
  assert.match(lines[2], /,849\.00,0\.00,INR,1$/);
});
