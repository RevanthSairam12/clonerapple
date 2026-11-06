/**
 * SECURITY (H-1): `order_sale_state` is a view over `orders`. A view without
 * `security_invoker` runs with its owner's rights, so the RLS on `orders` did
 * not apply and the publishable key could read every order through PostgREST.
 *
 * These tests pin the database fix and the fact that every application read
 * goes through the server-side owner connection, never the public REST client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const migrationPath = path.join(root, 'migrations', '0063_order_sale_state_security_invoker.sql');
const verifierPath = path.join(root, 'scripts', 'verify-rls-consumer-tables.mjs');

const VIEW_CONSUMERS = [
  'src/lib/account/orders.ts',
  'src/lib/order-status.ts',
  'src/lib/store-admin/order-channel.ts',
  'src/lib/store-admin/orders.ts',
];

test('migration 0063 makes the view run as the caller and revokes public access', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(
    sql,
    /alter\s+view\s+public\.order_sale_state\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
    'the view must be security_invoker',
  );
  assert.match(
    sql,
    /revoke\s+all\s+on\s+public\.order_sale_state\s+from\s+anon\s*,\s*authenticated/i,
    'anon and authenticated must not keep any privilege on the view',
  );
  // Additive only: the fix must not switch RLS off anywhere.
  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/i);
  assert.doesNotMatch(sql, /grant\s+/i);
});

test('every view read goes through the server-side owner connection', async () => {
  for (const relative of VIEW_CONSUMERS) {
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.match(source, /order_sale_state/, `${relative} should still read the view`);
    assert.match(source, /getSql/, `${relative} must use the DATABASE_URL connection`);
    assert.doesNotMatch(
      source,
      /NEXT_PUBLIC_SUPABASE|createClient|createServerClient/,
      `${relative} must not read the view with the publishable key`,
    );
  }
});

test('the RLS verifier asserts the view is denied and no longer pins a row count', async () => {
  const source = await readFile(verifierPath, 'utf8');

  assert.match(source, /order_sale_state/);
  assert.match(source, /deniedCheck\(orderSaleState\)/);
  // The old verifier expected exactly 12 products and failed once the
  // catalogue grew; it must assert a readable, non-empty set instead.
  assert.doesNotMatch(source, /rows\s*!==\s*12/);
  assert.match(source, /products\.rows\s*===\s*0/);
  // Products must be read by explicit public columns, not `select=*`.
  assert.match(source, /'id,name,price_paise'/);
});
