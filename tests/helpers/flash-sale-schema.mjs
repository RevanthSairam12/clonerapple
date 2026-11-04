/**
 * Shared fixtures for the flash-sale integration tests.
 *
 * Each test opens a throwaway schema cloned from the public tables
 * (`create table ... (like public.x including all)`) and pins one connection to
 * it, so the real SQL — row locks, the append-only ledger, the partial unique
 * indexes and the reconcile lease — runs against nothing production can see.
 * Cleanup is one `drop schema`; no live row is touched.
 *
 * Skipped when DATABASE_URL is unset, or on a transaction pooler (6543) where a
 * session-level `search_path` is not stable.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './isolated-schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; the tests stay skipped.
  }
}

function connectionDetails() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    isPooler: url.hostname.includes('pooler') && url.port === '6543',
    transactionPooler: url.port === '6543',
  };
}

export const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

export function client() {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  const { isPooler } = connectionDetails();
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    connection: { search_path: 'pg_catalog' },
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

/**
 * Load a source module through jiti so the test exercises the TypeScript the
 * app ships, not a re-implementation.
 */
export async function loadModule(relativePath) {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
  });
  return jiti.import(path.join(root, relativePath));
}

const { DEFAULT_RESERVATION_POLICY } = await loadModule('src/lib/checkout/reservation-rules.ts');

export const POLICY = { ...DEFAULT_RESERVATION_POLICY };

export const TABLES = [
  'categories',
  'products',
  'users',
  'stock',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'stock_movements',
  'store_settings',
  'refund_obligations',
];

export function suffix() {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

export async function openSchema(a, schema) {
  await createFixtureSchema(a, schema, TABLES);
  // Reconcile records a timeline even with sideEffects:false. Keep this local
  // as migration 0047 may not have been deployed on the source database.
  await a.unsafe(`create table "${schema}".payment_events (
    id bigint generated always as identity primary key,
    order_id text not null,
    txnid text not null,
    source text not null,
    payu_status text not null default '',
    outcome text not null,
    reason text not null default '',
    created_at timestamptz not null default now()
  )`);
  await a.unsafe(`alter table "${schema}".payment_events enable row level security`);
  // Retired tables need not exist on the source deployment. Keep only the
  // local contracts exercised by the one-time hold cleanup regression.
  await a.unsafe(`create table "${schema}".waiting_list_entries (
    id text primary key,
    product_id text not null,
    user_id text not null,
    status text not null default 'ACTIVE'
      check (status in ('ACTIVE', 'INVITED', 'PURCHASED', 'EXPIRED', 'CANCELLED')),
    invited_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await a.unsafe(`alter table "${schema}".waiting_list_entries enable row level security`);
  await a.unsafe(`create table "${schema}".stock_reservations (
    id text primary key,
    product_id text not null,
    user_id text not null,
    waiting_list_entry_id text,
    quantity integer not null default 1 check (quantity > 0),
    status text not null default 'HELD'
      check (status in ('HELD', 'CLAIMED', 'EXPIRED', 'CANCELLED')),
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await a.unsafe(`alter table "${schema}".stock_reservations enable row level security`);
  const pinned = await a`show search_path`;
  assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');
}

export async function closeSchema(a, schema) {
  try {
    await dropFixtureSchema(a, schema);
  } finally {
    await a.end({ timeout: 5 });
  }
}

export async function addProduct(a, { categoryId, productId, stockId, quantity }) {
  await a`
    insert into categories (id, slug, name)
    values (${categoryId}, ${categoryId}, 'Integration category')
    on conflict do nothing
  `;
  await a`
    insert into products (id, category_id, slug, name, price_paise, is_active)
    values (${productId}, ${categoryId}, ${productId}, ${productId}, 50000, true)
  `;
  await a`
    insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
    values (${stockId}, ${productId}, null, ${quantity}, 0, true)
  `;
}

export async function addUser(a, id) {
  await a`
    insert into users (id, email, password_hash, first_name, last_name, phone)
    values (${id}, ${`${id}@example.test`}, 'x', 'Test', ${id}, '9000000000')
  `;
}

export function orderParams({
  productId,
  txnid,
  userId = null,
  quantity = 1,
  reservationSeconds = 120,
}) {
  return {
    txnid,
    userId,
    items: [
      { id: productId, name: `Fixture ${productId}`, quantity, unitPrice: 500, totalPrice: 500 * quantity },
    ],
    subtotalPaise: 50000 * quantity,
    shippingPaise: 0,
    totalPaise: 50000 * quantity,
    currency: 'INR',
    paymentMethod: 'payu',
    reservationSeconds,
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
  };
}

export async function stockState(a, productId) {
  const rows = await a`select on_hand, reserved from stock where product_id = ${productId}`;
  return { onHand: Number(rows[0].on_hand), reserved: Number(rows[0].reserved) };
}

export async function orderRow(a, txnid) {
  const rows = await a`select * from orders where txnid = ${txnid}`;
  return rows[0];
}

export async function movementCount(a, orderId) {
  const rows = await a`
    select count(*)::int as count from stock_movements where order_id = ${orderId}
  `;
  return Number(rows[0].count);
}

/** Verifier answers shaped like `verifyPaymentWithPayU`'s result. */
export const VERIFY = {
  /** A capture PayU confirms. */
  paid: async () => ({
    verified: true,
    status: 'success',
    unmappedstatus: 'captured',
    mihpayid: 'mihpayid_test',
    mode: 'UPI',
    amount: '500.00',
    raw: null,
  }),
  /** PayU explicitly says the transaction failed. */
  failed: async () => ({
    verified: false,
    status: 'failure',
    unmappedstatus: 'failure',
    mihpayid: null,
    mode: null,
    amount: null,
    raw: null,
  }),
  /** The verifier cannot answer: ambiguous, never a failure. */
  unavailable: async () => ({
    verified: false,
    status: 'UNKNOWN',
    unmappedstatus: 'HTTP_ERROR',
    mihpayid: null,
    mode: null,
    amount: null,
    raw: null,
    error: 'verify endpoint unreachable',
  }),
};

/** A `ReconcileSummary` with every counter at zero. */
export function reconcileSummary() {
  return {
    processed: 0,
    markedPaid: 0,
    markedFailed: 0,
    markedCancelled: 0,
    markedProcessing: 0,
    released: 0,
    flagged: 0,
    unchanged: 0,
    errors: [],
    pendingRefundObligations: 0,
  };
}

/**
 * The context `reconcileOrderUsing` needs. Side effects are off: notifications,
 * audit rows and cache invalidation address the application pool, not the
 * throwaway schema under test.
 */
export function reconcileContext(verifier, summary, now = new Date()) {
  return {
    policy: { ...POLICY, failureGraceSeconds: 120, unresolvedMinutes: 60 },
    autoCancelHours: 24,
    verifier,
    now,
    summary,
    sideEffects: false,
  };
}
