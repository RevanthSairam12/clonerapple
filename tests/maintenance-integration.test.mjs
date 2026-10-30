/**
 * Maintenance mode must not stop money that was already taken.
 *
 * A PayU callback writes through `transitionOrderStatusUsing` directly; it is
 * never routed through the storefront gate. This test turns maintenance on in
 * a throwaway schema and pays an order through that same function, proving the
 * order becomes PAID and stock is claimed while the shop is closed to
 * customers.
 *
 * Skipped when DATABASE_URL is unset or points at a transaction pooler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(here, '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; the test stays skipped.
  }
}

function connectionDetails() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    isPooler: url.hostname.includes('pooler') && url.port === '6543',
    transactionPooler: url.port === '6543',
  };
}

const skip = !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  const { isPooler } = connectionDetails();
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});
const { createOrderUsing, transitionOrderStatusUsing } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'payu', 'orders.ts'),
);

const TABLES = [
  'categories',
  'products',
  'stock',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'stock_movements',
  'store_settings',
  'refund_obligations',
];

test('a callback settles the order while maintenance is on', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_maint_${suffix}`;
  const productId = `itestmaint${suffix}`;
  const stockId = `itestmaintstk${suffix}`;
  const txnid = `ITESTMAINT${suffix}`;
  const a = client();

  try {
    await a.unsafe(`create schema "${schema}"`);
    for (const table of TABLES) {
      await a.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
    }
    await a.unsafe(`set search_path to "${schema}"`);

    // The owner has closed the shop.
    await a`
      insert into store_settings (key, value) values ('maintenance_enabled', 'on')
    `;

    await a`
      insert into categories (id, slug, name)
      values (${`itestmc${suffix}`}, ${`itestmc${suffix}`}, 'Integration category')
    `;
    await a`
      insert into products (id, category_id, slug, name, price_paise)
      values (${productId}, ${`itestmc${suffix}`}, ${productId}, ${productId}, 50000)
    `;
    await a`
      insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
      values (${stockId}, ${productId}, null, 1, 0, true)
    `;

    await createOrderUsing(a, {
      txnid,
      items: [
        {
          id: productId,
          name: `Maintenance fixture ${productId}`,
          quantity: 1,
          unitPrice: 500,
          totalPrice: 500,
        },
      ],
      subtotalPaise: 50000,
      shippingPaise: 0,
      totalPaise: 50000,
      currency: 'INR',
      paymentMethod: 'payu',
      customerName: 'Integration Buyer',
      customerEmail: 'integration@example.test',
      customerPhone: '9000000000',
      shippingAddress: {
        name: 'Integration Buyer',
        phone: '9000000000',
        line1: '1 Test Lane',
        line2: '',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    });

    // The callback path: no maintenance check anywhere in it.
    const paid = await transitionOrderStatusUsing(a, {
      txnid,
      targetStatus: 'PAID',
      mihpayid: `mihpay_${suffix}`,
    });
    assert.equal(paid.transitioned, true);
    assert.equal(paid.firstTimePaid, true);

    const rows = await a`select status from orders where txnid = ${txnid}`;
    assert.equal(rows[0].status, 'PAID');

    const stock = await a`select on_hand, reserved from stock where product_id = ${productId}`;
    assert.equal(Number(stock[0].on_hand), 0, 'the paid callback claimed the unit');
    assert.equal(Number(stock[0].reserved), 0);
  } finally {
    await a.unsafe('set search_path to public');
    await a.unsafe(`drop schema if exists "${schema}" cascade`);
    await a.end();
  }
});
