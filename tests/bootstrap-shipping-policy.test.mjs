import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { planShippingBootstrap } = await import(pathToFileURL(path.join(root, 'scripts/bootstrap-shipping-policy.mjs')).href);

test('bootstrap preserves legacy selector and maps positive minimum threshold', () => {
  const result = planShippingBootstrap(
    [
      { key: 'shipping_enabled', value: 'on' },
      { key: 'free_shipping_over', value: '999' },
    ],
    [
      { id: 'b', name: 'Express', rate_paise: 9900, free_over_paise: 0, is_active: true, sort_order: 2 },
      { id: 'a', name: 'Standard', rate_paise: 5000, free_over_paise: 50000, is_active: true, sort_order: 1 },
    ],
  );
  assert.deepEqual(result.values, {
    shipping_charge_paise: '5000',
    free_shipping_threshold_paise: '50000',
  });
  assert.equal(result.enabled, true);
});

test('bootstrap maps no positive legacy threshold to a blank canonical value', () => {
  const result = planShippingBootstrap(
    [{ key: 'shipping_enabled', value: 'off' }, { key: 'free_shipping_over', value: '0' }],
    [{ id: 'a', name: 'Standard', rate_paise: 5000, free_over_paise: 0, is_active: true, sort_order: 1 }],
  );
  assert.deepEqual(result.values, { shipping_charge_paise: '5000', free_shipping_threshold_paise: '' });
  assert.equal(result.enabled, false);
});

test('bootstrap never guesses a missing member of a partial canonical pair', () => {
  assert.throws(
    () => planShippingBootstrap([{ key: 'shipping_charge_paise', value: '5000' }], []),
    /Partial canonical shipping pair/,
  );
});

test('bootstrap is idempotent and does not overwrite a complete pair', () => {
  assert.deepEqual(
    planShippingBootstrap([
      { key: 'shipping_charge_paise', value: '7000' },
      { key: 'free_shipping_threshold_paise', value: '' },
      { key: 'shipping_enabled', value: 'on' },
    ], []),
    { status: 'already-initialized', values: { shipping_charge_paise: '7000', free_shipping_threshold_paise: '' } },
  );
});
