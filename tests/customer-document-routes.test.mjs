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
// Execute real route/service/page exports. Unknown imports throw, so tests cannot
// accidentally reach the database, audit writer, provider or notification stack.
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, console, Response,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'react/jsx-runtime') return nativeRequire(name);
      if (name === 'next/link') return { __esModule: true, default: ({ children, prefetch, ...props }) => React.createElement('a', props, children) };
      if (name === 'next/navigation') return { notFound() { throw new Error('NOT_FOUND'); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return module.exports;
}
const policy = load('src/lib/orders/document-policy.ts');
const base = { paymentStatus: 'PAID', fulfilmentStatus: 'ON_THE_WAY', totalPaise: 10000,
  capturedPaise: 10000, invoiceNumber: 'PRIVATE-INVOICE', invoiceIssuedAt: 'PRIVATE-DATE', billRequested: true };
const session = { userId: 'owner' };
const receiptFile = 'src/app/account/orders/[txnid]/receipt/page.tsx';
function pageFixture(facts = base, { owned = true, signedIn = true } = {}) {
  const calls = [];
  const order = { id: 'owned-order', txnid: 'ORDER/1', currency: 'INR', createdAt: new Date('2026-11-01'), items: [] };
  Object.defineProperty(order, 'address', { get() { calls.push('address'); return null; } });
  Object.defineProperty(order, 'items', { get() { calls.push('items'); return []; } });
  const mocks = {
    '@/lib/account/auth': { requireAccountPageSession: async path => { assert.match(path, /^\/account\/orders\/ORDER%2F1\/receipt(?:\?document=(?:invoice|receipt))?$/); calls.push('session'); if (!signedIn) throw new Error('LOGIN'); return session; } },
    '@/lib/account/orders': { getCustomerOrderDetail: async (userId, txnid) => { assert.equal(userId, 'owner'); assert.equal(txnid, 'ORDER/1'); calls.push('owner'); return owned ? order : null; } },
    '@/lib/orders/document-policy': policy,
    '@/lib/orders/document-data': { getCustomerDocumentState: async (id, mode) => { assert.equal(id, 'owned-order'); calls.push('state'); return policy.projectCustomerDocumentState(policy.deriveDocumentState(facts), mode); } },
    '@/lib/store-admin/order-documents': { orderTotals: () => { calls.push('totals'); return {}; } },
    '@/lib/orders/option-snapshot': { optionSnapshotLabel: s => [s.deviceModelName, s.colourName].filter(Boolean).join(' · ') || s.variantLabel || null },
    '@/components/account/AccountFrame': { AccountFrame: ({ children }) => children },
    '@/components/account/PrintButton': { PrintButton: () => React.createElement('button', null, 'PRINT') },
    '@/components/orders/OrderDocument': { OrderDocument: ({ state }) => { calls.push('render'); return React.createElement('div', null, JSON.stringify(state)); } },
  };
  const Page = load(receiptFile, mocks).default;
  const render = async document => renderToStaticMarkup(await Page({ params: Promise.resolve({ txnid: 'ORDER/1' }), searchParams: Promise.resolve({ document }) }));
  return { calls, render };
}

test('customer receipt page is session/ownership gated before document facts or construction', async () => {
  for (const options of [{ signedIn: false }, { owned: false }]) {
    const fixture = pageFixture(base, options);
    await assert.rejects(fixture.render('invoice'), /LOGIN|NOT_FOUND/);
    assert.equal(fixture.calls.includes('state'), false);
    assert.equal(fixture.calls.includes('items'), false);
  }
});

test('direct invoice URL before delivery returns unavailable without constructing or substituting document', async () => {
  for (const fulfilmentStatus of ['PENDING','ACCEPTED','PROCESSING','ON_THE_WAY','CANCELED']) {
    const fixture = pageFixture({ ...base, fulfilmentStatus });
    const html = await fixture.render('invoice');
    assert.match(html, /Document unavailable/);
    assert.doesNotMatch(html, /PRIVATE-INVOICE|PRIVATE-DATE|PRINT|receipt/);
    assert.deepEqual(fixture.calls, ['session','owner','state']);
  }
});

test('unpaid and reviewed direct documents are unavailable even with delivered identity and old request', async () => {
  for (const paymentStatus of ['CREATED','PENDING','PROCESSING','FAILED','CANCELLED','PAID']) {
    for (const mode of [undefined,'receipt','invoice']) {
      const fixture = pageFixture({ ...base, fulfilmentStatus: 'DELIVERED', paymentStatus, paymentReviewRequired: paymentStatus === 'PAID' });
      assert.match(await fixture.render(mode), /Document unavailable/);
      assert.deepEqual(fixture.calls, ['session','owner','state']);
    }
  }
});

test('default paid page is a receipt before delivery and invoice after; explicit receipt stays receipt', async () => {
  const before = pageFixture();
  const html = await before.render(undefined);
  assert.match(html, /&quot;kind&quot;:&quot;receipt&quot;/);
  assert.doesNotMatch(html, /PRIVATE-INVOICE|PRIVATE-DATE/);
  assert.match(html, /PRINT/);
  for (const mode of [undefined,'invoice','receipt']) {
    const after = pageFixture({ ...base, fulfilmentStatus: 'DELIVERED' });
    const html = await after.render(mode);
    if (mode === 'receipt') assert.doesNotMatch(html, /PRIVATE-INVOICE|PRIVATE-DATE/);
    else assert.match(html, /PRIVATE-INVOICE/);
    assert.ok(after.calls.includes('totals')); assert.ok(after.calls.includes('render'));
  }
});

test('legacy delivered invoice mode is unavailable but default remains a safe receipt', async () => {
  const facts = { ...base, fulfilmentStatus: 'DELIVERED', invoiceNumber: null, invoiceIssuedAt: null };
  const explicit = pageFixture(facts);
  assert.match(await explicit.render('invoice'), /Document unavailable/);
  assert.deepEqual(explicit.calls, ['session','owner','state']);
  assert.match(await pageFixture(facts).render(undefined), /&quot;kind&quot;:&quot;receipt&quot;/);
});

test('invalid and duplicate modes fail closed after ownership but before eligibility or DTO construction', async () => {
  for (const mode of ['', 'bill', 'INVOICE', ['invoice'], ['invoice','receipt']]) {
    const fixture = pageFixture();
    await assert.rejects(fixture.render(mode), /NOT_FOUND/);
    assert.deepEqual(fixture.calls, ['session','owner']);
  }
});

const billService = load('src/lib/account/bill-requests.ts', { '@/lib/platform/db': { getSql: () => { throw new Error('Unexpected app pool'); } } });
function ownedSql(owned, queries) {
  return async (strings, ...values) => {
    const query = strings.join('?'); queries.push({ query, values });
    assert.match(query, /^select id from orders where txnid=\? and user_id=\?$/);
    return owned ? [{ id: 'owned-order' }] : [];
  };
}
test('retired reason list no longer reads the database or offers new choices', async () => {
  assert.equal((await billService.listBillReasons()).length,0);
});

test('retired service is read-only, checks exact ownership, denies old existing-request shortcut and ignores invalid reasons', async () => {
  for (const owned of [false, true]) for (const input of [undefined, null, {reasonId:'active'}, {reasonId:'other',otherText:'x'.repeat(301)}]) {
    const queries = [];
    await assert.rejects(billService.requestBillUsing(ownedSql(owned, queries), 'owner', 'ORDER/1', input), error => error instanceof billService.BillRequestError && error.status === (owned ? 410 : 404));
    assert.deepEqual(queries[0].values, ['ORDER/1','owner']);
    assert.equal(queries.length, 1, 'no transaction, request lookup, reason, audit or mutation query');
  }
});

test('retired API checks origin, account session and ownership before 410; does not parse obsolete body', async () => {
  for (const state of ['origin','session','foreign','missing','owned','unavailable']) {
    const calls = [];
    const service = { ...billService, requestBill: async (...args) => {
      calls.push('ownership'); assert.deepEqual(args, ['owner','ORDER/1']);
      if (['foreign','missing'].includes(state)) throw new billService.BillRequestError('Order not found.',404);
      if (state === 'unavailable') throw new Error('private failure');
      throw new billService.BillRequestError('Retired',410);
    } };
    const { POST } = load('src/app/api/account/orders/[txnid]/bill-request/route.ts', {
      'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
      '@/lib/platform/api-guard': { assertSameOrigin: () => { calls.push('origin'); return state === 'origin' ? new Response(null,{status:403}) : null; } },
      '@/lib/account/auth': { requireAccountSessionApi: async () => { calls.push('session'); return state === 'session' ? {ok:false,response:new Response(null,{status:401})} : {ok:true,session}; } },
      '@/lib/account/bill-requests': service,
    });
    const response = await POST({ json: () => { throw new Error('obsolete body must not be parsed'); } }, { params: Promise.resolve({txnid:'ORDER/1'}) });
    assert.equal(response.status, {origin:403,session:401,foreign:404,missing:404,owned:410,unavailable:503}[state]);
    assert.deepEqual(calls, state === 'origin' ? ['origin'] : state === 'session' ? ['origin','session'] : ['origin','session','ownership']);
    assert.doesNotMatch(await response.text(), /private failure/);
  }
});

test('customer data loader projects invoice metadata away without any write or invoice allocator', async () => {
  let queries = 0;
  const sql = async strings => {
    queries++; assert.match(strings.join('?'), /select o.status/);
    return [{ status:'PAID',fulfilment_status:'ON_THE_WAY',channel:'web',payment_review_required:false,
      total_paise:10000,amount:100,invoice_number:'INTERNAL-ONLY',invoice_issued_at:'INTERNAL-DATE',shipped:true,captured:'10000',refunded:'0',pending_refund:'0',refund_due:'0',bill_requested:true }];
  };
  const data = load('src/lib/orders/document-data.ts', { '@/lib/platform/db': {getSql: () => {throw new Error('unexpected app pool');}}, './document-policy':policy });
  const state = await data.getCustomerDocumentStateUsing(sql, 'owned-order');
  assert.equal(state.kind,'receipt'); assert.equal(state.invoiceNumber,null); assert.equal(state.invoiceIssuedAt,null); assert.equal(state.billRequested,false);
  assert.doesNotMatch(JSON.stringify(state), /INTERNAL-ONLY|INTERNAL-DATE/);
  assert.equal(queries,1);
});


test('account detail exposes only eligible explicit invoice or payment receipt actions and no retired reason dependencies', async () => {
  for (const facts of [base,{...base,fulfilmentStatus:'DELIVERED'},
    {...base,fulfilmentStatus:'DELIVERED',invoiceNumber:null,invoiceIssuedAt:null},
    {...base,paymentStatus:'FAILED'},{...base,paymentReviewRequired:true}]) {
    const state = policy.projectCustomerDocumentState(policy.deriveDocumentState(facts));
    const Null = () => null;
    const Page = load('src/app/account/orders/[txnid]/page.tsx', {
      '@/lib/account/auth': {requireAccountPageSession:async()=>session},
      '@/lib/account/orders': {getCustomerOrderDetail:async()=>({id:'owned',txnid:'ORDER/1',currency:'INR',status:'PAID',
        fulfilmentStatus:facts.fulfilmentStatus,createdAt:new Date('2026-11-01'),history:[],items:[],requests:[],refunds:[],amount:100,subtotalPaise:10000,discountPaise:0,shippingPaise:0})},
      '@/lib/orders/document-data': {getCustomerDocumentState:async()=>state},
      '@/lib/account/order-live': {isInFlightAccountOrderStatus:()=>false,accountOrderHistoryLabel:()=>null},
      '@/lib/orders/fulfilment': {FULFILMENT_STEPS:[],fulfilmentLabel:x=>x,hasShipmentStarted:()=>false},
      '@/lib/orders/option-snapshot': {optionSnapshotLabel:s=>[s.deviceModelName,s.colourName].filter(Boolean).join(' · ')||s.variantLabel||null},
      '@/lib/store-admin/delivery': {validateHttpsTrackingUrl:()=>null},
      '@/components/account/AccountFrame': {AccountFrame:({children})=>children},
      '@/components/account/LiveOrderPoller': {LiveOrderPoller:Null},
      '@/components/account/OrderRequestButtons': {OrderRequestButtons:Null},
      '@/components/account/OrderStatusChip': {OrderStatusChip:Null},
      '@/components/orders/OrderDocument': {OrderDocumentStatus:({state})=>React.createElement('span',null,JSON.stringify(state))},
    }).default;
    const html = renderToStaticMarkup(await Page({params:Promise.resolve({txnid:'ORDER/1'})}));
    if (state.canViewInvoice) {assert.match(html,/receipt\?document=invoice/);assert.match(html,/View \/ Print invoice/);}
    else {
      assert.doesNotMatch(html,/PRIVATE-INVOICE|PRIVATE-DATE|View \/ Print invoice|document=invoice/);
      if (state.canViewReceipt) assert.match(html,/View Payment receipt/);
      else assert.doesNotMatch(html,/\/receipt/);
    }
    assert.doesNotMatch(html,/RequestBillForm|Choose a reason|Request a bill/);
  }
});
