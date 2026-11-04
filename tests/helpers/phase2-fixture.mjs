import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHEMA = 'itest_phase2_documents_approved';
export const MIGRATIONS = ['0049_order_documents.sql', '0050_refund_lifecycle.sql'];
export const USERS = ['invoice_user', 'bill_user', 'throttle_user', 'other_user', 'refund_user'];
export const ORDERS = [
  ...['invoice_same', 'invoice_a', 'invoice_b', 'invoice_rollback', 'invoice_pos'].map(id => ({ id, user: 'invoice_user', channel: id === 'invoice_pos' ? 'pos' : 'web' })),
  ...['bill_reason', 'bill_other', 'bill_inactive', 'bill_unpaid', 'bill_cancel', 'bill_shipped', 'bill_review'].map(id => ({ id, user: 'bill_user', status: id === 'bill_unpaid' ? 'PENDING' : 'PAID', fulfilment: id === 'bill_cancel' ? 'CANCELED' : 'ACCEPTED', review: id === 'bill_review' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `throttle_${i}`, user: 'throttle_user' })),
  ...['refund_race', 'refund_terminal', 'refund_return'].map(id => ({ id, user: 'refund_user' })),
];
export const TABLES = ['users', 'store_admins', 'store_settings', 'orders', 'order_status_history', 'order_payments', 'return_requests', 'order_items', 'return_items', 'refunds', 'refund_obligations', 'coupon_redemptions', 'stock_movements', 'store_admin_audit', 'invoice_number_counters', 'bill_request_reasons', 'bill_requests', 'refund_requests', 'refund_request_events'];

/** Pure preapproval output. Never imports a database client or loads environment files. */
export async function phase2Manifest(databaseUrl = process.env.DATABASE_URL) {
  let hostname = null;
  if (databaseUrl) {
    try { hostname = new URL(databaseUrl).hostname; }
    catch { throw new Error('Invalid database URL; connection details withheld'); }
  }
  const migrationSha256 = Object.fromEntries(await Promise.all(MIGRATIONS.map(async name => [name, createHash('sha256').update(await readFile(path.join(ROOT, 'migrations', name))).digest('hex')])));
  const committedInserts = Object.fromEntries(TABLES.map(table => [table, 0]));
  Object.assign(committedInserts, {
    users: USERS.length, store_admins: 1, store_settings: 2, orders: ORDERS.length,
    order_status_history: 1, order_payments: ORDERS.filter(o => o.status !== 'PENDING').length,
    return_requests: 1, order_items: 1, return_items: 1, refund_obligations: 1,
    coupon_redemptions: 1, invoice_number_counters: 1, bill_request_reasons: 2,
    bill_requests: 1, refund_requests: 7, refund_request_events: 7, refunds: 5,
    store_admin_audit: 19,
  });
  const plan = {
    version: 2, hostname, schemas: [SCHEMA], publicTableWrites: 0, publicSequenceAdvances: 0,
    publicBusinessDataReads: 0, migrationSha256,
    sequences: [`${SCHEMA}.phase2_audit_id_seq`], schemaLocalAuditSequenceAdvances: 24, maximumConnections: 2,
    connectionPolicy: 'one max:1 session normally; second max:1 session only during deliberate races; no public search_path fallback',
    committedInserts,
    rolledBackInserts: { store_admin_audit: 2, bill_requests: 0, refund_requests: 2, refunds: 1, refund_request_events: 1 },
    rejectedInsertAttempts: { store_admin_audit: 3, refund_request_events: 1 },
    updates: ['orders invoice identity/fulfilment', 'invoice_number_counters increments', 'store_settings invoice prefix', 'coupon_redemptions release once', 'refund_obligations close once', 'return_requests close once'],
    committedUpdateRowOperations: { orders: 5, invoice_number_counters: 4, store_settings: 1, coupon_redemptions: 1, refund_obligations: 1, return_requests: 1 },
    committedDeleteRows: 0,
    expectedInvoiceCounter: 4,
    cleanup: `DROP SCHEMA ${SCHEMA} CASCADE only if created by this run; never replace an existing schema`,
    externalEffects: 'none; Using transaction seams only; no notification enqueue, drain, SMTP, PayU, cache or app pool',
    scope: 'fixture/helper/test sources and migration hashes are approval-bound; rejected and rolled-back inserts are separate from committed row totals',
  };
  const sourceSha256 = Object.fromEntries(await Promise.all(['tests/helpers/phase2-fixture.mjs', 'tests/phase2-documents-integration.test.mjs'].map(async name => [name, createHash('sha256').update(await readFile(path.join(ROOT, name))).digest('hex')])));
  const approved = { ...plan, sourceSha256 };
  return { ...approved, approvalSha256: createHash('sha256').update(JSON.stringify(approved)).digest('hex') };
}

// This is an intentionally small contract fixture, NOT LIKE public tables.
// All dependencies and FKs are local. Real Phase2 migration DDL installs its
// constraints, triggers and RLS; existing immutable ledgers get local triggers.
const BASE_DDL = `
create table users (id text primary key);
create table store_admins (id text primary key);
create table store_settings (key text primary key, value text not null);
create table orders (id text primary key, txnid text not null unique, user_id text references users(id), status text not null, fulfilment_status text not null, channel text not null, payment_review_required boolean not null default false, total_paise bigint not null, amount numeric not null, currency text not null default 'INR');
create table order_status_history (id text primary key, order_id text not null references orders(id), domain text not null, to_status text not null);
create table order_payments (id text primary key, order_id text not null references orders(id), status text not null, amount_paise bigint not null);
create table return_requests (id text primary key, order_id text not null references orders(id), status text not null, refunded_at timestamptz, updated_at timestamptz not null default now());
create table order_items (id bigint primary key, order_id text not null references orders(id), quantity integer not null, line_total_paise bigint not null, discount_paise bigint not null default 0);
create table return_items (id text primary key, return_id text not null references return_requests(id), order_item_id bigint not null references order_items(id), quantity integer not null);
create table refunds (id text primary key, order_id text not null references orders(id), return_id text references return_requests(id), amount_paise bigint not null check(amount_paise>0), currency text not null default 'INR', method text not null check(method in ('cash','upi','card_machine','bank_transfer','other')), provider_ref text, reason text not null default '', note text not null default '', status text not null default 'RECORDED' check(status='RECORDED'), recorded_by text references store_admins(id), created_at timestamptz not null default now());
create table refund_obligations (id text primary key, order_id text not null references orders(id), amount_paise bigint not null, status text not null default 'PENDING', refund_id text references refunds(id), updated_at timestamptz not null default now());
create table coupon_redemptions (id text primary key, order_id text not null references orders(id), state text not null, released_at timestamptz, release_reason text);
create table stock_movements (id text primary key, order_id text references orders(id));
create sequence phase2_audit_id_seq;
create table store_admin_audit (id bigint primary key default nextval('phase2_audit_id_seq'), actor_id text references store_admins(id), actor_email text not null, action text not null, entity text not null, entity_id text not null, before jsonb, after jsonb, request_id text, route text not null, status text not null, reason text not null, ip_hash text, user_agent_hash text, created_at timestamptz not null default now());
create function fixture_immutable() returns trigger language plpgsql as $$ begin raise exception 'fixture ledger is immutable'; end $$;
create trigger refunds_immutable before update or delete on refunds for each row execute function fixture_immutable();
create trigger audit_immutable before update or delete on store_admin_audit for each row execute function fixture_immutable();
`;

export async function openPhase2Fixture() {
  // All guards run before even constructing a lazy client.
  assert.equal(process.env.RUN_PHASE2_DB_TESTS, '1', 'Phase2 database tests require explicit approval');
  const manifest = await phase2Manifest();
  assert.ok(manifest.hostname, 'Supply DATABASE_URL explicitly; environment files are never loaded');
  assert.equal(process.env.PHASE2_APPROVED_MANIFEST, manifest.approvalSha256, 'Generate and approve the exact Phase2 write manifest before execution');
  const url = new URL(process.env.DATABASE_URL);
  assert.notEqual(url.port, '6543', 'Requires a session connection, not a transaction pooler');
  const { default: postgres } = await import('postgres');
  const options = { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {}, connection: { search_path: SCHEMA, statement_timeout: 15000, lock_timeout: 10000 } };
  const sql = postgres(process.env.DATABASE_URL, options);
  let created = false;
  async function pinned(client) {
    const [row] = await client`select current_schema() as name, current_setting('search_path') as path`;
    assert.equal(row.name, SCHEMA); assert.equal(row.path, SCHEMA);
  }
  const fixture = {
    sql, manifest,
    async race(callback) {
      const second = postgres(process.env.DATABASE_URL, options);
      try {
        await pinned(sql); await pinned(second);
        const [one] = await sql`select pg_backend_pid() as pid`;
        const [two] = await second`select pg_backend_pid() as pid`;
        assert.notEqual(one.pid, two.pid, 'Race requires independent database sessions');
        return await callback(sql, second);
      } finally { await second.end({ timeout: 5 }); }
    },
    async close() {
      try { if (created) await sql.unsafe(`drop schema "${SCHEMA}" cascade`); }
      finally { await sql.end({ timeout: 5 }); }
    },
  };
  try {
    // Intentionally no IF NOT EXISTS: never adopt/drop someone else's schema.
    await sql.unsafe(`create schema "${SCHEMA}"`); created = true;
    await pinned(sql);
    await sql.unsafe(BASE_DDL);
    for (const table of TABLES.slice(0, 14)) await sql.unsafe(`alter table "${table}" enable row level security`);
    for (const name of MIGRATIONS) await sql.unsafe(await readFile(path.join(ROOT, 'migrations', name), 'utf8'));
    for (const id of USERS) await sql`insert into users(id) values (${id})`;
    await sql`insert into store_admins(id) values ('phase2_owner')`;
    await sql`insert into store_settings(key,value) values ('invoice_prefix','FIX'),('refunds_restore_coupon','on')`;
    for (const order of ORDERS) {
      await sql`insert into orders(id,txnid,user_id,status,fulfilment_status,channel,payment_review_required,total_paise,amount) values (${order.id},${order.id},${order.user},${order.status ?? 'PAID'},${order.fulfilment ?? 'ACCEPTED'},${order.channel ?? 'web'},${order.review ?? false},10000,100)`;
      if (order.status !== 'PENDING') await sql`insert into order_payments(id,order_id,status,amount_paise) values (${`pay_${order.id}`},${order.id},'PAID',10000)`;
    }
    await sql`insert into order_status_history(id,order_id,domain,to_status) values ('shipped_history','bill_shipped','fulfilment','ON_THE_WAY')`;
    await sql`insert into bill_request_reasons(id,label,is_active) values ('active','Original reason',true),('inactive','Inactive reason',false)`;
    // Preserve coverage of historical append-only request/audit rows without
    // invoking the retired mutation to manufacture new requests.
    await sql`insert into bill_requests(id,order_id,user_id,reason_id,reason_label,other_text) values ('historical_bill','bill_reason','bill_user','active','Original reason','')`;
    await sql`insert into store_admin_audit(actor_email,action,entity,entity_id,route,status,reason) values ('','order.bill.request','order','bill_reason','','ok','fixture_historical_request')`;

    await sql`insert into return_requests(id,order_id,status) values ('return_fixture','refund_return','RECEIVED')`;
    await sql`insert into order_items(id,order_id,quantity,line_total_paise) values (1,'refund_return',1,5000)`;
    await sql`insert into return_items(id,return_id,order_item_id,quantity) values ('return_item','return_fixture',1,1)`;
    await sql`insert into refund_obligations(id,order_id,amount_paise) values ('obligation','refund_race',10000)`;
    await sql`insert into coupon_redemptions(id,order_id,state) values ('redemption','refund_race','CONSUMED')`;
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}

export async function assertPhase2Counts(fixture) {
  for (const [table, count] of Object.entries(fixture.manifest.committedInserts)) {
    const [row] = await fixture.sql.unsafe(`select count(*)::int as n from "${table}"`);
    assert.equal(row.n, count, `${table}: approved committed insert count`);
  }
  const [counter] = await fixture.sql`select last_number::int as n from invoice_number_counters`;
  assert.equal(counter.n, fixture.manifest.expectedInvoiceCounter);
}
