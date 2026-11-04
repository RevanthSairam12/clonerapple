import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { releaseExpiredReservationsForProducts } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));

test('lazy expiry binds identity arrays as JSON, retaining null and sibling variant keys', async () => {
  const bindings = [];
  const queries = [];
  const tx = async (strings, ...values) => {
    queries.push({ text: strings.join('?'), values });
    return []; // No expired orders: this test isolates parameter construction.
  };
  tx.json = value => {
    assert.ok(Array.isArray(value), 'JSON binding must receive an array, not a pre-stringified value');
    const binding = { json: value };
    bindings.push(binding);
    return binding;
  };
  const identities = [
    { productId: 'case', variantId: null },
    { productId: 'case', variantId: 'blue' },
    { productId: 'case', variantId: 'red' },
  ];
  assert.deepEqual(await releaseExpiredReservationsForProducts(tx, ['case'], identities), []);
  assert.deepEqual(bindings[0].json, [
    { product_id: 'case', variant_id: null },
    { product_id: 'case', variant_id: 'blue' },
    { product_id: 'case', variant_id: 'red' },
  ]);
  assert.ok(queries[0].values.includes(bindings[0]));
  assert.match(queries[0].text, /jsonb_to_recordset/);
  assert.match(queries[0].text, /is not distinct from oi.variant_id/);

  await releaseExpiredReservationsForProducts(tx, ['case', 'case']);
  assert.deepEqual(bindings[1].json, [{ product_id: 'case', variant_id: null }]);
  const count = queries.length;
  assert.deepEqual(await releaseExpiredReservationsForProducts(tx, []), []);
  assert.equal(queries.length, count);
});

test('every reservation recordset uses explicit JSON array binding', async () => {
  const source = await readFile(path.join(root, 'src/lib/payu/orders.ts'), 'utf8');
  const recordsets = [...source.matchAll(/jsonb_to_recordset\(([^\n]+?)::jsonb\)/g)];
  assert.equal(recordsets.length, 3);
  for (const match of recordsets) assert.match(match[1], /^\$\{tx\.json\(/);
  assert.doesNotMatch(source, /const requested(?:Json|Records)?\s*=\s*JSON\.stringify/);
});
