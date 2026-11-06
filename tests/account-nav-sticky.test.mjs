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
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return module.exports;
}

const Null = () => null;
const { AccountFrame } = load('src/components/account/AccountFrame.tsx', {
  '@/components/header/GadzioHeader': { GadzioHeader: Null },
  '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter': { GlobalFooter: Null },
  '@/lib/account/messages': { getUnreadMessageCount: async () => 3 },
});

const session = { userId: 'customer', firstName: 'Ravi', email: 'r@example.test' };

async function render(active) {
  return renderToStaticMarkup(await AccountFrame({ session, active, children: React.createElement('p', null, 'content') }));
}

test('every account section is present and the current one is marked', async () => {
  const html = await render('/account/orders');
  for (const label of ['Overview', 'Orders', 'Addresses', 'Coupons', 'Messages', 'History', 'Preferences', 'Profile', 'Data &amp; Privacy']) {
    assert.ok(html.includes(label), label);
  }
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /aria-current="page"[^>]*>|href="\/account\/orders"[^>]*aria-current="page"/);
});

test('the sidebar sticks below the sticky header on wide screens only', async () => {
  const html = await render('/account');
  const nav = html.match(/<nav[^>]*aria-label="Account"[^>]*>/)[0];
  // Sticky must be desktop-only: on narrow screens the nav is a horizontal
  // strip above the content, where a sticky sidebar would cover the page.
  assert.match(nav, /(?:^|\s)lg:sticky(\s|"|$)/);
  assert.doesNotMatch(nav, /(?<!lg:)sticky/, 'no unprefixed sticky');
  // The offset is the header's own token, so it tracks the 56px/96px
  // breakpoint change instead of hardcoding one height.
  // Underscores stand in for spaces so Tailwind emits one class per utility.
  assert.match(nav, /lg:top-\[calc\(var\(--gz-nav-height,56px\)_\+_1\.5rem\)\]/);
  assert.match(nav, /--gz-nav-height/);
  // A tall nav must scroll inside itself rather than overflow the viewport.
  assert.match(nav, /lg:max-h-\[calc\(100dvh_-_var\(--gz-nav-height,56px\)_-_3rem\)\]/);
});

test('the nav offset token is the same one the header and accessory sidebars use', () => {
  const css = read('src/app/gadzio.css');
  assert.match(css, /--gz-nav-height: 56px/);
  assert.match(css, /@media \(min-width: 834px\)[\s\S]*--gz-nav-height: 96px/);
  // Loaded globally, so the account page resolves the token outside .gz-root.
  assert.match(read('src/app/globals.css'), /@import "\.\/gadzio\.css"/);
  assert.match(css, /--breakpoint-anav: 834px/);
});
