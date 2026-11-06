/**
 * SECURITY (L-7): the order result page said "Sign in to view this order" for an
 * order that exists but belongs to someone else, and "Order status unavailable"
 * for an unknown reference. With sequential order numbers, txnid is guessable,
 * so the wording was an order-existence oracle for anonymous callers.
 *
 * Every non-owner case now renders one identical answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('the result page has one unavailable answer for every non-owner case', async () => {
  const source = await readFile(path.join(root, 'src', 'components', 'orders', 'OrderResultPage.tsx'), 'utf8');

  // The old wording distinguished "exists but not yours" from "unknown".
  assert.doesNotMatch(source, /Sign in to view this order/);
  assert.doesNotMatch(source, /No transaction identifier was provided/);

  assert.match(source, /function Unavailable\(\) \{/);
  assert.match(source, /Order status unavailable/);
  assert.match(source, /We could not load this order\. Check the reference, sign in with the account that placed it, or use the payment return link\./);

  // Every entry point renders the same component with no discriminating prop.
  const calls = source.match(/<Unavailable[^>]*\/>/g) ?? [];
  assert.ok(calls.length >= 3, `expected every exit to use it, saw ${calls.length}`);
  for (const call of calls) assert.equal(call, '<Unavailable />');
});
