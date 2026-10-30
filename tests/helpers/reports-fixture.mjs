/**
 * Shared fixture for the reports correctness tests.
 *
 * Builds a throwaway schema on the real DATABASE_URL (search_path scoped, always
 * dropped by the caller), copies the tables the reports read with
 * `like public.x including all`, and exposes small insert helpers plus an
 * independent plain-JavaScript model of each order, so expectations never come
 * from the SQL under test.
 *
 * The same connection is installed as the process-wide pool (`getSql()` reads
 * `globalThis.__gadzioSql`), so the production report functions run unchanged
 * against the throwaway schema.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const env = await readFile(path.join(here, '..', '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; callers skip.
  }
}

export function skipReason() {
  if (!process.env.DATABASE_URL) return 'DATABASE_URL is not set';
  const url = new URL(process.env.DATABASE_URL);
  if (url.port === '6543') return 'temporary-schema isolation needs a session connection (not port 6543)';
  return false;
}

function client() {
  const url = new URL(process.env.DATABASE_URL);
  const isPooler = url.hostname.includes('pooler') && url.port === '6543';
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: !isPooler,
    onnotice: () => {},
  });
}

const TABLES = [
  'categories',
  'brands',
  'products',
  'stock',
  'stock_movements',
  'users',
  'user_sessions',
  'orders',
  'order_items',
  'order_payments',
  'refunds',
  'return_requests',
  'return_items',
  'expense_categories',
  'expenses',
  'coupons',
  'coupon_redemptions',
  'store_settings',
];

/** Run `fn(sql)` inside a fresh schema that is always dropped afterwards. */
export async function withSchema(label, fn) {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_${label}_${suffix}`;
  const sql = client();
  const previous = globalThis.__gadzioSql;
  try {
    await sql.unsafe(`create schema "${schema}"`);
    for (const table of TABLES) {
      await sql.unsafe(`create table "${schema}".${table} (like public.${table} including all)`);
    }
    // LIKE copies serial defaults verbatim, including references to public
    // sequences. Give fixture columns their own sequences before any insert.
    const serialDefaults = await sql`
      select table_name, column_name from information_schema.columns
      where table_schema = ${schema} and column_default like 'nextval(%'
    `;
    for (const { table_name, column_name } of serialDefaults) {
      const sequence = `${table_name}_${column_name}_fixture_seq`;
      await sql.unsafe(`create sequence "${schema}"."${sequence}"`);
      await sql.unsafe(`alter table "${schema}"."${table_name}" alter column "${column_name}" set default nextval('"${schema}"."${sequence}"'::regclass)`);
    }
    await sql.unsafe(`set search_path to "${schema}"`);

    // The real sale-state view, recreated against the throwaway tables.
    const migration = await readFile(
      path.join(here, '..', '..', 'migrations', '0037_flash_sale_reservations.sql'),
      'utf8',
    );
    const view = migration.match(/create or replace view order_sale_state as[\s\S]*?from orders o;/i);
    if (!view) throw new Error('order_sale_state view definition not found in migration 0037');
    await sql.unsafe(view[0]);

    globalThis.__gadzioSql = sql;
    return await fn(sql);
  } finally {
    globalThis.__gadzioSql = previous;
    try {
      await sql.unsafe('set search_path to public');
      await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

/* ------------------------------------------------------------ catalogue */

export const CATALOGUE = {
  categories: [
    { id: 'c_a', name: 'Cases' },
    { id: 'c_b', name: 'Chargers' },
  ],
  brands: [
    { id: 'b_x', name: 'Xbrand' },
    { id: 'b_y', name: 'Ybrand' },
  ],
  // pricePaise is the list price; stock: [onHand, reserved, threshold, tracked]
  products: [
    { id: 'p1', name: 'Case', cat: 'c_a', brand: 'b_x', price: 123450, cost: 40000, stock: [10, 2, 5, true] },
    { id: 'p2', name: 'Cable', cat: 'c_a', brand: 'b_y', price: 49950, cost: 20000, stock: [3, 1, 5, true] },
    { id: 'p3', name: 'Charger', cat: 'c_b', brand: 'b_x', price: 1234567, cost: 900000, stock: [0, 0, 2, true] },
    { id: 'p4', name: 'Strap', cat: 'c_b', brand: 'b_y', price: 25000, cost: null, stock: [7, 0, 0, false] },
    { id: 'p5', name: 'NoStock', cat: 'c_b', brand: null, price: 10000, cost: null, stock: null },
  ],
};

export async function insertCatalogue(sql) {
  for (const c of CATALOGUE.categories) {
    await sql`insert into categories (id, slug, name) values (${c.id}, ${c.id}, ${c.name})`;
  }
  for (const b of CATALOGUE.brands) {
    await sql`insert into brands (id, slug, name) values (${b.id}, ${b.id}, ${b.name})`;
  }
  for (const p of CATALOGUE.products) {
    await sql`
      insert into products (id, category_id, slug, name, price_paise, cost_paise, brand_id)
      values (${p.id}, ${p.cat}, ${p.id}, ${p.name}, ${p.price}, ${p.cost}, ${p.brand})
    `;
    if (p.stock) {
      const [onHand, reserved, threshold, tracked] = p.stock;
      await sql`
        insert into stock (id, product_id, variant_id, on_hand, reserved, low_stock_threshold, track_inventory)
        values (${`stk_${p.id}`}, ${p.id}, null, ${onHand}, ${reserved}, ${threshold}, ${tracked})
      `;
    }
  }
}

export const product = (id) => CATALOGUE.products.find((p) => p.id === id);

/* --------------------------------------------------------------- orders */

/** IST is a fixed +05:30 offset, so the store day of an instant is exact arithmetic. */
export function istDay(isoInstant) {
  return new Date(Date.parse(isoInstant) + 19_800_000).toISOString().slice(0, 10);
}

export function istMinute(isoInstant) {
  return new Date(Date.parse(isoInstant) + 19_800_000).toISOString().slice(0, 16).replace('T', ' ');
}

export function utcDay(isoInstant) {
  return new Date(Date.parse(isoInstant)).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diffDays(later, earlier) {
  const [y1, m1, d1] = later.split('-').map(Number);
  const [y2, m2, d2] = earlier.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000);
}

/** Normalise an order spec and derive its money from its lines. */
export function buildOrder(spec) {
  const items = (spec.items ?? []).map((line, index) => ({
    lineNumber: index + 1,
    productId: line.pid,
    name: product(line.pid)?.name ?? line.pid,
    quantity: line.qty,
    unitPaise: line.unit,
    lineTotalPaise: line.qty * line.unit,
    discountPaise: line.disc ?? 0,
  }));
  const subtotal = items.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const discount = items.reduce((sum, line) => sum + line.discountPaise, 0);
  const shipping = spec.shipping ?? 0;
  return {
    status: 'PAID',
    fulfil: 'PENDING',
    channel: 'web',
    userId: null,
    email: '',
    phone: '',
    name: '',
    method: null,
    ref: null,
    coupon: null,
    ...spec,
    items,
    subtotal,
    discount,
    shipping,
    total: subtotal - discount + shipping,
  };
}

export const isCaptured = (o) => o.status === 'PAID' && o.fulfil !== 'CANCELED';

export async function insertOrder(sql, o) {
  const paidAt = o.status === 'PAID' ? new Date(Date.parse(o.at) + 60_000).toISOString() : null;
  await sql`
    insert into orders (
      id, txnid, user_id, items, amount, status, customer_name, customer_email,
      customer_phone, payu_mihpayid, created_at, updated_at, paid_at, channel,
      fulfilment_status, payment_method, subtotal_paise, discount_paise,
      shipping_paise, total_paise, coupon_code, cancelled_at
    ) values (
      ${o.id}, ${o.id}, ${o.userId}, '[]'::jsonb, ${o.total / 100}, ${o.status}, ${o.name},
      ${o.email}, ${o.phone}, ${o.ref}, ${o.at}::timestamptz, ${o.at}::timestamptz,
      ${paidAt}::timestamptz, ${o.channel}, ${o.fulfil}, ${o.method}, ${o.subtotal},
      ${o.discount}, ${o.shipping}, ${o.total}, ${o.coupon},
      ${o.fulfil === 'CANCELED' ? o.at : null}::timestamptz
    )
  `;
  for (const line of o.items) {
    await sql`
      insert into order_items (
        order_id, line_number, product_id, product_name, quantity,
        unit_price_paise, line_total_paise, discount_paise, created_at
      ) values (
        ${o.id}, ${line.lineNumber}, ${line.productId}, ${line.name}, ${line.quantity},
        ${line.unitPaise}, ${line.lineTotalPaise}, ${line.discountPaise}, ${o.at}::timestamptz
      )
    `;
  }
}

export async function insertPayment(sql, p) {
  await sql`
    insert into order_payments (order_id, channel, method, amount_paise, status, provider_ref, paid_at, created_at)
    values (${p.orderId}, ${p.channel}, ${p.method}, ${p.amount}, ${p.status ?? 'PAID'},
            ${p.ref ?? null}, ${p.at}::timestamptz, ${p.at}::timestamptz)
  `;
}

export async function insertRefund(sql, r) {
  await sql`
    insert into refunds (id, order_id, amount_paise, method, status, created_at)
    values (${r.id}, ${r.orderId}, ${r.amount}, ${r.method ?? 'cash'}, 'RECORDED', ${r.at}::timestamptz)
  `;
}

export async function insertUser(sql, u) {
  await sql`
    insert into users (id, email, password_hash, first_name, last_name, created_at)
    values (${u.id}, ${u.email}, 'x', ${u.first}, ${u.last}, ${u.at}::timestamptz)
  `;
}

export async function insertSession(sql, s) {
  await sql`
    insert into user_sessions (token_hash, user_id, expires_at, created_at)
    values (${s.token}, ${s.userId}, now() + interval '1 day', ${s.at}::timestamptz)
  `;
}

export async function itemIds(sql, orderId) {
  const rows = await sql`select id, product_id from order_items where order_id = ${orderId} order by line_number`;
  return rows.map((row) => ({ id: Number(row.id), productId: row.product_id }));
}
