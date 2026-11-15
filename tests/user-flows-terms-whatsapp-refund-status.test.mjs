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

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      console,
      Response,
      Request,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name === 'react' || name === 'react/jsx-runtime') return nativeRequire(name);
        if (name === 'next/link') {
          return {
            __esModule: true,
            default: ({ children, prefetch, ...props }) => React.createElement('a', props, children),
          };
        }
        if (name === 'next/navigation') {
          return {
            notFound() {
              throw new Error('NOT_FOUND');
            },
            useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
          };
        }
        throw new Error(`Unexpected dependency: ${name}`);
      },
    },
    { filename },
  );
  return module.exports;
}

const validation = load('src/lib/auth/validation.ts');
const redirectLib = load('src/lib/auth/redirect.ts');

test('signup API rejects account creation when agreeToTerms is not explicitly true', async () => {
  let signUpCalls = 0;
  let cookieSet = false;
  const { POST } = load('src/app/api/auth/signup/route.ts', {
    'next/server': {
      NextResponse: {
        json: (body, options) => Response.json(body, options),
      },
    },
    'next/headers': {
      cookies: async () => ({
        set() {
          cookieSet = true;
        },
      }),
    },
    '@/lib/platform/api-guard': {
      assertSameOrigin: () => null,
    },
    '@/lib/user-auth': {
      USER_SESSION_COOKIE: 'gadzio_session',
      userSessionCookie: { name: 'gadzio_session', options: {} },
      signUp: async () => {
        signUpCalls++;
        return { ok: true, token: 'tok' };
      },
    },
    '@/lib/auth/validation': validation,
  });

  for (const agreeToTerms of [undefined, false, 'true', 1, null]) {
    const response = await POST(
      new Request('https://gadzio.co.in/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'User',
          email: 'user@example.com',
          password: 'Password123!',
          agreeToTerms,
        }),
      }),
    );
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.match(json.error, /Terms/i);
  }
  assert.equal(signUpCalls, 0);
  assert.equal(cookieSet, false);

  const okResponse = await POST(
    new Request('https://gadzio.co.in/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'User',
        email: 'user@example.com',
        password: 'Password123!',
        agreeToTerms: true,
      }),
    }),
  );
  assert.equal(okResponse.status, 200);
  assert.equal(signUpCalls, 1);
  assert.equal(cookieSet, true);
});

test('AuthForm renders only one Terms & Conditions checkbox in signup mode', () => {
  const { AuthForm } = load('src/components/auth/AuthForm.tsx', {
    '@/lib/auth/redirect': redirectLib,
    '@/lib/auth/validation': validation,
  });
  const html = renderToStaticMarkup(React.createElement(AuthForm, { initialMode: 'signup', redirectTo: '/account' }));
  const checkboxCount = (html.match(/type="checkbox"/g) ?? []).length;
  assert.equal(checkboxCount, 1);
  assert.match(html, /name="agreeToTerms"/);
  assert.match(html, /Terms &amp; Conditions/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /disabled=""/);
});

test('OrderRequestButtons sends Request cancellation to WhatsApp and includes Refund policy button', () => {
  const whatsapp = load('src/lib/whatsapp.ts');
  const { OrderRequestButtons } = load('src/components/account/OrderRequestButtons.tsx', {
    '@/lib/whatsapp': whatsapp,
  });

  const html = renderToStaticMarkup(
    React.createElement(OrderRequestButtons, {
      txnid: 'ORDER-99',
      canCancel: true,
      canReturn: true,
    }),
  );

  assert.match(html, /href="https:\/\/wa\.me\/916304859367\?text=/);
  assert.match(html, />Request cancellation<\/a>/);
  assert.match(html, /href="\/return-refund"[^>]*>Refund<\/a>/);
  assert.match(html, />Request return<\/button>/);

  const terminalHtml = renderToStaticMarkup(
    React.createElement(OrderRequestButtons, {
      txnid: 'ORDER-99',
      canCancel: false,
      canReturn: false,
    }),
  );
  assert.doesNotMatch(terminalHtml, /Request cancellation/);
  assert.match(terminalHtml, /href="\/return-refund"[^>]*>Refund<\/a>/);
});

test('account order page places Status information only inside Items section below Total with collapsible arrow', async () => {
  const Null = () => null;
  const Page = load('src/app/account/orders/[txnid]/page.tsx', {
    '@/lib/account/auth': { requireAccountPageSession: async () => ({ userId: 'u1' }) },
    '@/lib/account/orders': {
      getCustomerOrderDetail: async () => ({
        id: 'o1',
        txnid: 'ORDER-1',
        currency: 'INR',
        status: 'PAID',
        fulfilmentStatus: 'DELIVERED',
        createdAt: new Date('2026-11-01'),
        history: [],
        items: [
          {
            id: 'item-1',
            name: 'Phone',
            variantLabel: null,
            serialNumber: 'SN-123',
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
            image: null,
          },
        ],
        requests: [],
        refunds: [],
        amount: 100,
        subtotalPaise: 10000,
        discountPaise: 0,
        shippingPaise: 0,
      }),
    },
    '@/lib/orders/document-data': {
      getCustomerDocumentState: async () => ({
        kind: 'status',
        canViewInvoice: false,
        canViewReceipt: false,
        canRequestBill: false,
        refundedPaise: 0,
      }),
    },
    '@/lib/account/bill-requests': { listBillReasons: async () => [{ id: 'warranty', label: 'Warranty claim' }] },
    '@/lib/account/order-live': { isInFlightAccountOrderStatus: () => false, accountOrderHistoryLabel: () => null },
    '@/lib/orders/fulfilment': { FULFILMENT_STEPS: [], fulfilmentLabel: (x) => x, hasShipmentStarted: () => false },
    '@/lib/orders/option-snapshot': { optionSnapshotLabel: () => null },
    '@/lib/store-admin/delivery': { validateHttpsTrackingUrl: () => null },
    '@/components/account/AccountFrame': { AccountFrame: ({ children }) => children },
    '@/components/account/LiveOrderPoller': { LiveOrderPoller: Null },
    '@/components/account/OrderRequestButtons': { OrderRequestButtons: Null },
    '@/components/account/RequestBillForm': { RequestBillForm: Null },
    '@/components/account/OrderStatusChip': { OrderStatusChip: Null },
    '@/components/orders/OrderDocument': { OrderDocumentStatus: () => React.createElement('span', null, 'STATUS_BODY') },
  }).default;

  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ txnid: 'ORDER-1' }) }));
  const itemsHeadingIndex = html.indexOf('>Items<');
  const totalIndex = html.indexOf('>Total<');
  const detailsIndex = html.indexOf('<details');
  const statusIndex = html.indexOf('Status information only');
  const serialMatch = /Serial No:\s*(?:<span[^>]*>)?SN-123/.exec(html);

  assert.ok(itemsHeadingIndex !== -1 && totalIndex > itemsHeadingIndex);
  assert.ok(serialMatch && serialMatch.index > itemsHeadingIndex && serialMatch.index < totalIndex);
  assert.ok(detailsIndex > totalIndex);
  assert.ok(statusIndex > detailsIndex);
  assert.match(html, /Status information only<\/span><span[^>]*>▾<\/span><\/summary>.*STATUS_BODY/);
});

test('migration 0074 is additive-only', () => {
  const sql = readFileSync(path.join(root, 'migrations/0074_order_item_serial_numbers.sql'), 'utf8');
  assert.match(sql, /alter table order_items\s+add column if not exists serial_number text;/i);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|constraint)\b|\btruncate\b/i);
});

test('terms page incorporates Privacy, Shipping, and Return & Refund policies into Terms agreement', async () => {
  const Null = () => null;
  const TermsPage = load('src/app/terms/page.tsx', {
    '@/components/header/GadzioHeader': { GadzioHeader: Null },
    '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter': { GlobalFooter: Null },
    '@/lib/storefront/site-pages': {
      parseSafePageParagraphs: () => [],
      readSeoPageOverride: async () => null,
      readStorePageAndContact: async () => ({
        page: null,
        contact: {
          tradeName: 'Gadzio',
          legalName: 'RUPEEDO TECHNOLOGIES',
          email: 'support@gadzio.co.in',
          phone: '+916304859367',
          address: 'SAI NIVAS, MOGALTUR',
          footerText: '',
          cookieNotice: '',
        },
      }),
    },
  }).default;

  const html = renderToStaticMarkup(await TermsPage());
  assert.match(html, /aria-label="Incorporated Policies"/);
  assert.match(html, /<a[^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/);
  assert.match(html, /<a[^>]*href="\/shipping-policy"[^>]*>Shipping Policy<\/a>/);
  assert.match(html, /<a[^>]*href="\/return-refund"[^>]*>Return &amp; Refund Policy<\/a>/);
  assert.match(html, /agree to these Terms &amp; Conditions together with all three policies/i);
});

test('download invoice controls show Download wording only without Print text', () => {
  const { PrintButton } = load('src/components/account/PrintButton.tsx');
  const btnHtml = renderToStaticMarkup(React.createElement(PrintButton, { label: 'Download invoice' }));
  assert.match(btnHtml, />Download invoice<\/button>/);
  assert.doesNotMatch(btnHtml, /Print/i);
});
