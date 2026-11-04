import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
function load(relative) {
  const filename = path.resolve(root, relative), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText,
    { module, exports: module.exports, require(name) {
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
        for (const ext of ['.ts', '.tsx']) { try { readFileSync(target + ext); return load(target + ext); } catch {} }
      }
      return nativeRequire(name);
    }, console });
  return module.exports;
}
const { parsePriceChangedQuote, createQuoteGeneration, nextSaleRefreshDelay } = load('src/lib/checkout/client-quote.ts');
const policy = { enabled: true, chargePaise: 5000, freeShippingThresholdPaise: 100000 };
const quote = { shippingPolicy: policy, items: [{ id: 'a', name: 'A', quantity: 2, unitPaise: 500, totalPaise: 1000, regularPricePaise: null }], totals: { subtotalPaise: 1000, discountPaise: 0, shippingPaise: 5000, totalPaise: 6000 } };
test('price_changed parser rejects malformed or inconsistent recovery', () => {
  assert.deepEqual(parsePriceChangedQuote(quote), quote);
  assert.equal(parsePriceChangedQuote({ ...quote, totals: { ...quote.totals, totalPaise: 1 } }), null);
  assert.equal(parsePriceChangedQuote({ ...quote, shippingPolicy: { enabled: true } }), null);
});
test('generation gate rejects stale response after signature changes', () => {
  const gate = createQuoteGeneration(); gate.update('A'); const ticket = gate.capture(); gate.update('B'); assert.equal(gate.current(ticket), false);
});
test('sale refresh uses database clock and waits for boundary', () => {
  assert.equal(nextSaleRefreshDelay({ enabled: true, databaseNow: '2026-01-01T00:00:00Z', startsAt: '2026-01-01T00:01:00Z', endsAt: null }), 60100);
});
