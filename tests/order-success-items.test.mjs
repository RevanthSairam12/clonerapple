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
const read = file => readFileSync(path.join(root, file), 'utf8');

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

const Null = () => null;
const money = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const policy = load('src/lib/orders/document-policy.ts', {});
const resultState = load('src/lib/orders/result-state.ts', {});
const fulfilment = load('src/lib/orders/fulfilment.ts', {
  '@/lib/store-admin/order-rules': { FULFILMENT_STEPS: ['PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED'] },
});

function fixture(items) {
  return {
    id: 'order', txnid: 'TXN-ITEMS', orderNumber: 7, userId: 'customer', currency: 'INR',
    saleState: 'PAID', paymentStatus: 'PAID', fulfilmentStatus: 'PENDING', channel: 'web',
    totalPaise: 39_400, createdAt: new Date('2026-11-06T10:00:00Z'),
    updatedAt: new Date('2026-11-06T10:00:00Z'),
    reservationState: 'CONSUMED', reservationExpiresAt: null, reservationReleasedReason: '',
    paymentReviewRequired: false, processingDeadline: null, deliverySlot: null,
    delivery: null, history: [], items,
  };
}

function mocksFor(order) {
  return {
    '@/lib/catalog/storefront': { formatPaise: money },
    '@/lib/account/order-live': { accountOrderHistoryLabel: () => null },
    '@/lib/order-status': { getCustomerOrderStatus: async () => ({ ok: true, data: order }) },
    '@/lib/orders/document-data': { getCustomerDocumentState: async () => policy.projectCustomerDocumentState(
      policy.deriveDocumentState({ paymentStatus: 'PAID', fulfilmentStatus: 'PENDING', totalPaise: order.totalPaise, capturedPaise: order.totalPaise })) },
    '@/lib/orders/fulfilment': fulfilment,
    '@/lib/orders/result-state': resultState,
    '@/lib/payu/return-access': { resolveReturnAccess: () => 'owner', carryReturnToken: href => href },
    '@/lib/store-admin/delivery': { validateHttpsTrackingUrl: () => null },
    '@/lib/user-auth': { getUserSession: async () => ({ userId: 'customer' }) },
    '@/components/checkout/ClearCartOnSuccess': { ClearCartOnSuccess: Null },
    '@/components/checkout/CheckPaymentButton': { CheckPaymentButton: Null },
  };
}

async function render(order) {
  const component = load('src/components/orders/OrderResultPage.tsx', mocksFor(order));
  return renderToStaticMarkup(await component.OrderResultPage({
    searchParams: Promise.resolve({ txnid: order.txnid }), route: 'success',
  }));
}

const item = {
  name: 'Gadzio Test Silicone Case', quantity: 2, unitPricePaise: 19_700, lineTotalPaise: 39_400,
  deviceModelName: 'Iphone 17', colourName: 'Blue', colourHex: '#0000FF',
  imageUrl: 'https://cdn.example.test/case-blue.jpg', imageAlt: 'Gadzio Test Silicone Case — Blue',
};

test('the success page shows each bought item under the result with its photo and title', async () => {
  const html = await render(fixture([item]));
  const title = html.indexOf('Order successful');
  const products = html.indexOf('Gadzio Test Silicone Case');
  assert.ok(title > -1 && products > title, 'items follow the "Order successful" heading');
  // The photo comes from the order snapshot, not a live catalogue read.
  assert.match(html, /src="https:\/\/cdn\.example\.test\/case-blue\.jpg"/);
  assert.match(html, /alt="Gadzio Test Silicone Case — Blue"/);
  // The exact option and the money for that line are both shown.
  const text = html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');
  assert.match(text, /Iphone 17 • Blue/);
  assert.match(text, /Qty 2/);
  assert.match(text, /₹394\.00/);
  assert.match(html, /background-color:#0000FF/, 'the shared colour is the swatch');
});

test('an item without a stored photo keeps its layout and never renders a broken image', async () => {
  const html = await render(fixture([{ ...item, imageUrl: null, imageAlt: null }]));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /border-dashed/, 'a placeholder occupies the photo slot');
  assert.match(html, /Gadzio Test Silicone Case/);
});

test('orders written before the item snapshot still render with no empty sections', async () => {
  const legacy = { name: 'Historic item', quantity: 1, unitPricePaise: 99_900, lineTotalPaise: 99_900,
    deviceModelName: null, colourName: null, colourHex: null, imageUrl: null, imageAlt: null };
  const asText = (await render(fixture([legacy]))).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ');
  assert.match(asText, /Historic item/);
  assert.doesNotMatch(asText, /•/);
  const empty = await render(fixture([]));
  assert.doesNotMatch(empty, /aria-labelledby="order-items-title"/, 'no item section when the order has no lines');
  assert.match(empty, /Order successful/);
});

test('the status loader reads the item snapshot without requiring the 0061 columns', () => {
  const source = read('src/lib/order-status.ts');
  assert.match(source, /from order_items/);
  assert.match(source, /order by line_number asc/);
  // jsonb access keeps the query valid on a database where 0061 is not applied.
  for (const column of ['variant_device_model_name', 'variant_colour_name', 'variant_colour_hex', 'image_url', 'image_alt']) {
    assert.match(source, new RegExp(`to_jsonb\\(order_items\\)->>'${column}'`), column);
  }
  assert.match(source, /items: CustomerStatusItem\[\]/);
  assert.match(source, /items,\n\s+\},\n\s+};/);
  // The item read must stay inside the same guarded block as the rest of the
  // order facts, so an unreadable order still returns "unavailable".
  assert.match(source, /catch \{\n\s+console\.warn\('\[order\/status\]/);
});
