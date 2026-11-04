import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { fulfilmentLabel, hasShipmentStarted, FULFILMENT_STEPS } = await jiti.import(path.join(root, 'src/lib/orders/fulfilment.ts'));
const { validateFulfilmentTransition, transitionFulfilmentUsing, FULFILMENT_TRANSITIONS } = await jiti.import(path.join(root, 'src/lib/store-admin/orders.ts'));
const { validateDeliveryDetailsForOnTheWay } = await jiti.import(path.join(root, 'src/lib/store-admin/delivery.ts'));
const source = (file) => readFile(path.join(root, file), 'utf8');

test('the full workflow reuses the legal stored states and business labels', () => {
  assert.deepEqual([...FULFILMENT_STEPS], ['PENDING', 'ACCEPTED', 'PROCESSING', 'ON_THE_WAY', 'DELIVERED']);
  assert.equal(fulfilmentLabel('PROCESSING'), 'Preparing');
  assert.equal(fulfilmentLabel('ON_THE_WAY', 'courier'), 'Pickup done / In transit');
  assert.equal(fulfilmentLabel('ON_THE_WAY', 'self'), 'Dispatched / Out for delivery');
  assert.ok(!FULFILMENT_TRANSITIONS.PENDING.includes('ON_THE_WAY'));
});

test('shipping is hidden until collection, not when a label is prepared', () => {
  for (const status of ['PENDING', 'ACCEPTED', 'PROCESSING', 'CANCELED', 'UNKNOWN', null]) {
    assert.equal(hasShipmentStarted(status), false);
  }
  assert.equal(hasShipmentStarted('ON_THE_WAY'), true);
  assert.equal(hasShipmentStarted('DELIVERED'), true);
});

test('fulfilment history preserves shipping after cancellation, payment history never implies pickup', () => {
  assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'fulfilment', toStatus: 'ON_THE_WAY' }]), true);
  assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'fulfilment', to_status: 'DELIVERED' }]), true);
  assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'payment', toStatus: 'DELIVERED' }]), false);
  assert.equal(hasShipmentStarted('CANCELED', [{ domain: 'fulfilment', toStatus: 'PROCESSING' }]), false);
});

test('acceptance remains paid-only and cancellation after pickup remains owner-only', () => {
  assert.equal(validateFulfilmentTransition({ current: 'PENDING', target: 'ACCEPTED', paymentStatus: 'PROCESSING', role: 'store_admin' }).code, 'payment-required');
  assert.equal(validateFulfilmentTransition({ current: 'ON_THE_WAY', target: 'CANCELED', paymentStatus: 'PAID', role: 'store_admin' }).code, 'owner-required');
  assert.equal(validateFulfilmentTransition({ current: 'ON_THE_WAY', target: 'CANCELED', paymentStatus: 'PAID', role: 'store_owner' }).ok, true);
  assert.equal(validateFulfilmentTransition({ current: 'DELIVERED', target: 'PROCESSING', paymentStatus: 'PAID', role: 'store_owner' }).ok, false);
});

test('pickup requires persisted courier or self-delivery details, keeping past valid schedules usable', () => {
  const saved = { method: 'courier', carrier: 'Fixture courier', trackingNumber: 'FIX123', trackingUrl: 'https://courier.example/track/FIX123', scheduledFor: '2025-01-01', deliverySlot: '10:00-13:00' };
  assert.equal(validateDeliveryDetailsForOnTheWay(null).ok, false);
  assert.equal(validateDeliveryDetailsForOnTheWay(saved).ok, true);
  assert.equal(validateDeliveryDetailsForOnTheWay({ ...saved, trackingNumber: '' }).ok, false);
  assert.equal(validateDeliveryDetailsForOnTheWay({ ...saved, trackingUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateDeliveryDetailsForOnTheWay({ ...saved, method: 'self', personName: 'Fixture rider', personPhone: '0000000000' }).ok, true);
  assert.equal(validateDeliveryDetailsForOnTheWay({ ...saved, method: 'self' }).ok, false);
});

test('repository refuses pickup before delivery is saved and writes status/history only after validation', async () => {
  async function attempt(delivery) {
    const writes = [];
    const sql = async (strings, ...values) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.startsWith('select id, txnid, status')) return [{ id: 'fixture', txnid: 'FIXTURE', status: 'PAID', fulfilment_status: 'PROCESSING' }];
      if (text.includes('from order_deliveries d')) return delivery ? [delivery] : [];
      if (text.startsWith('select invoice_number')) return [{ invoice_number: null, invoice_issued_at: null }];
      if (text.startsWith('select value from store_settings')) return [{ value: 'INV' }];
      if (text.startsWith('update invoice_number_counters')) { writes.push({ text, values }); return [{ value: '1' }]; }
      if (text.startsWith('update orders set invoice_sequence')) { writes.push({ text, values }); return [{ invoice_issued_at: '2026-11-02T00:00:00Z' }]; }
      if (text.startsWith('update') || text.startsWith('insert')) { writes.push({ text, values }); return []; }
      throw new Error(`Unexpected SQL: ${text}`);
    };
    sql.begin = async (fn) => fn(sql);
    sql.json = value => value;
    const result = await transitionFulfilmentUsing(sql, { txnid: 'FIXTURE', target: 'ON_THE_WAY', staffId: 'staff-fixture', role: 'store_admin' });
    return { result, writes };
  }
  const blocked = await attempt(null);
  assert.equal(blocked.result.reason, 'delivery-required');
  assert.equal(blocked.writes.length, 0);
  const pickedUp = await attempt({ delivery_method: 'courier', courier_name: 'Fixture courier', tracking_number: 'FIX123', tracking_url: 'https://courier.example/FIX123', delivery_scheduled_for: '2025-01-01', delivery_slot: '10:00-13:00' });
  assert.equal(pickedUp.result.ok, true);
  assert.equal(pickedUp.result.currentStatus, 'ON_THE_WAY');
  assert.equal(pickedUp.writes.length, 6);
  assert.ok(pickedUp.writes.some(({ text }) => text.includes('update invoice_number_counters')));
  assert.ok(pickedUp.writes.some(({ text }) => text.includes('insert into store_admin_audit')));
  assert.ok(pickedUp.writes.some(({ text }) => text.includes('insert into order_status_history')));
});

test('admin controls use shared stages, saved readiness, separate cancellation and terminal edit guards', async () => {
  const controls = await source('src/components/store-admin/OrderControls.tsx');
  assert.match(controls, /FULFILMENT_STEPS\.map/);
  assert.match(controls, /FULFILMENT_TRANSITIONS\[current\]/);
  assert.match(controls, /validateDeliveryDetailsForOnTheWay\(saved/);
  assert.match(controls, /!readOnly && !terminal && <form/);
  assert.match(controls, /Tracking number \(required\)/);
  assert.match(controls, /method === 'self'\s*\? \{ personName, personPhone \}/);
  assert.match(controls, /target !== 'CANCELED'/);
  assert.match(controls, /Mark pickup done/);
  assert.match(controls, /Only the store owner can cancel after pickup/);
});

test('rendered controls show all stages for viewers and next legal actions for staff', async () => {
  // This jiti installation does not transform TSX; compile with the project's
  // TypeScript compiler and evaluate with only the component's pure imports.
  const code = ts.transpileModule(await source('src/components/store-admin/OrderControls.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const pureModules = {
    react: React,
    'react/jsx-runtime': await import('react/jsx-runtime'),
    '@/lib/store-admin/delivery': await jiti.import(path.join(root, 'src/lib/store-admin/delivery.ts')),
    '@/lib/store-admin/order-rules': await jiti.import(path.join(root, 'src/lib/store-admin/order-rules.ts')),
    '@/lib/orders/fulfilment': { fulfilmentLabel },
  };
  const exports = {};
  new Function('require', 'exports', code)((id) => {
    if (!(id in pureModules)) throw new Error(`Unexpected component import: ${id}`);
    return pureModules[id];
  }, exports);
  const { OrderControls } = exports;
  const order = { txnid: 'fixture', paymentStatus: 'PAID', fulfilmentStatus: 'PENDING', delivery: null };
  const staff = renderToStaticMarkup(React.createElement(OrderControls, { order, role: 'store_admin' }));
  for (const label of ['Pending', 'Accepted', 'Preparing', 'Pickup done / In transit', 'Delivered']) assert.ok(staff.includes(label));
  assert.match(staff, /Accept order/);
  assert.doesNotMatch(staff, />Mark delivered<|>Mark pickup done</);
  const viewer = renderToStaticMarkup(React.createElement(OrderControls, { order, role: 'store_viewer' }));
  assert.match(viewer, /Viewer access is read-only/);
  assert.doesNotMatch(viewer, /<button|<form/);
  const terminal = renderToStaticMarkup(React.createElement(OrderControls, { order: { ...order, fulfilmentStatus: 'DELIVERED' }, role: 'store_owner' }));
  assert.doesNotMatch(terminal, /<form/);
});

test('legacy automatic shipping defaults display the safe effective value without a silent write', async () => {
  const form = await source('src/components/store-admin/SettingsForm.tsx');
  assert.match(form, /field.key === 'default_fulfilment_status'.*stored === 'ON_THE_WAY'.*stored === 'DELIVERED'.*return 'PROCESSING'/);
  assert.match(form, /inputValue\(field, initial\) !== values\[field.key\]/);
});

test('shipment rendering is pickup-gated and timeline labels remain domain-aware', async () => {
  const page = await source('src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/page.tsx');
  assert.match(page, /shipmentStarted && order.delivery/);
  assert.match(page, /entry.domain === 'fulfilment' \? fulfilmentLabel/);
});
