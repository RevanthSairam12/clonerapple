import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

async function monitorHarness() {
  let interval, focus, visible, cleanup, response = { status: 200, ok: true, json: async () => ({ role: 'store_admin', mustChangePassword: false }) };
  const redirects = [];
  let checks = 0, refreshes = 0;
  const module = { exports: {} };
  const window = {
    location: { replace: value => redirects.push(value) },
    setInterval: (fn, delay) => { assert.equal(delay, 30_000); interval = fn; return 7; },
    clearInterval: id => assert.equal(id, 7),
    addEventListener: (name, fn) => { assert.equal(name, 'focus'); focus = fn; },
    removeEventListener() {},
  };
  const document = {
    visibilityState: 'visible', addEventListener: (_name, fn) => { visible = fn; }, removeEventListener() {},
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('src/components/store-admin/StoreSessionMonitor.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, window, document,
    fetch: async (_url, options) => { assert.equal(options.cache, 'no-store'); checks++; return response; },
    require(name) {
      if (name === 'react') return { useEffect: effect => { cleanup = effect(); } };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh: () => refreshes++ }) };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  module.exports.StoreSessionMonitor({ role: 'store_admin' });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  return { redirects, flush, interval: () => interval(), focus: () => focus(), visible: () => visible(),
    cleanup: () => cleanup(), respond: value => { response = value; }, checks: () => checks, refreshes: () => refreshes };
}

test('session monitor executes immediate, interval, focus and visibility checks and handles revocation', async () => {
  const h = await monitorHarness();
  assert.equal(h.checks(), 1);
  h.interval(); await h.flush();
  h.focus(); await h.flush();
  h.visible(); await h.flush();
  assert.equal(h.checks(), 4);
  h.respond({ status: 200, ok: true, json: async () => ({ role: 'store_viewer' }) });
  h.interval(); await h.flush();
  assert.equal(h.refreshes(), 1);
  h.respond({ status: 401, ok: false });
  h.interval(); await h.flush();
  assert.equal(h.redirects.at(-1), '/store-admin/login?reason=account-unavailable');
  h.cleanup();
});

test('session monitor routes temporary-password users to the forced screen', async () => {
  const h = await monitorHarness();
  h.respond({ status: 200, ok: true, json: async () => ({ role: 'store_admin', mustChangePassword: true }) });
  h.focus(); await h.flush();
  assert.equal(h.redirects.at(-1), '/store-admin/change-password');
  h.cleanup();
});
