import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHEMA = 'itest_phase5_coupon_visibility_approved';
export const TABLES = ['users', 'orders', 'order_items', 'products', 'categories', 'brands', 'store_settings', 'store_admin_audit', 'coupons', 'coupon_targets', 'coupon_redemptions'];
const SOURCES = ['tests/helpers/phase5-fixture.mjs', 'tests/phase5-coupon-integration.test.mjs', 'src/lib/account/coupons.ts', 'src/lib/account/coupon-rules.ts', 'src/lib/coupons/rules.ts', 'src/lib/store-admin/customer-rules.ts', 'src/lib/store-admin/coupons.ts', 'src/lib/store-admin/coupon-rules.ts', 'src/lib/store-admin/audit.ts'];

/** Pure manifest: no environment loading or SQL client construction. */
export async function phase5Manifest(databaseUrl) {
  let target;
  try {
    target = new URL(databaseUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
    assert.notEqual(target.port, '6543');
  } catch { throw new Error('An explicit PostgreSQL session target is required; details withheld'); }
  const hash = async file => createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex');
  const plan = {
    version: 1, hostname: target.hostname, port: target.port || '5432', schemas: [SCHEMA], maximumConnections: 1,
    targetSha256: createHash('sha256').update(databaseUrl).digest('hex'),
    publicBusinessDataReads: 0, publicTableWrites: 0, publicSequenceAdvances: 0,
    migrations: Object.fromEntries(await Promise.all(['0041_coupons.sql', '0053_coupon_visibility_assignments.sql'].map(async file => [file, await hash(`migrations/${file}`)]))),
    sourceSha256: Object.fromEntries(await Promise.all(SOURCES.map(async file => [file, await hash(file)]))),
    committedInserts: { users: 2, orders: 2, store_settings: 1, coupons: 10, coupon_redemptions: 2, store_admin_audit: 6 },
    rolledBackInserts: { coupons: 1 },
    committedUpdates: { coupons: 5 },
    rolledBackUpdates: { coupons: 3 },
    sequenceAdvances: { coupon_redemptions_id_seq: 2, coupon_targets_id_seq: 0, store_admin_audit_id_seq: 6 },
    ddl: { createOwnedSchemas: 1, baseTables: 8, couponMigrationExecutions: 1, visibilityMigrationExecutions: 2, cleanupOwnedSchemas: 1 },
    scope: 'Actual migrations and injected customer/admin services; synthetic identities, no app pool, public data, SMTP, PayU, browser, or restricted-role RLS authorization proof.',
    cleanup: 'Refuse existing schema; remove only the schema successfully created by this run. Pin search_path to owned schema; local serial sequences only.',
  };
  return { ...plan, approvalSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

export async function openPhase5Fixture() {
  assert.equal(process.env.RUN_PHASE5_DB_TESTS, '1', 'Phase5 SQL writes require separate approval');
  const manifest = await phase5Manifest(process.env.DATABASE_URL);
  assert.equal(process.env.PHASE5_APPROVED_MANIFEST, manifest.approvalSha256, 'Approve the exact Phase5 manifest first');
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1, idle_timeout: 20, connect_timeout: 10, max_lifetime: 1800, prepare: false, ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {},
    connection: { search_path: SCHEMA, statement_timeout: 15000, lock_timeout: 5000 },
  });
  let created = false;
  const close = async () => {
    try {
      if (created) {
        await sql.unsafe('set search_path to pg_catalog');
        await sql.unsafe(`drop schema "${SCHEMA}" cascade`);
        assert.equal((await sql`select count(*)::int as n from pg_namespace where nspname = ${SCHEMA}`)[0].n, 0);
      }
    } finally { await sql.end({ timeout: 1 }); }
  };
  try {
    await sql.unsafe(`create schema "${SCHEMA}"`); created = true;
    assert.equal((await sql`select current_schema() as name`)[0].name, SCHEMA);
    await sql.begin(async tx => {
      await tx.unsafe(`
        create table users (id text primary key, email text not null, customer_group text not null);
        create table orders (id text primary key, txnid text, order_number text, status text, user_id text references users(id), customer_email text, total_paise bigint, amount numeric);
        create table order_items (id text primary key, line_total_paise bigint not null default 0);
        create table products (id text primary key, name text);
        create table categories (id text primary key, name text);
        create table brands (id text primary key, name text);
        create table store_settings (key text primary key, value text);
        create table store_admin_audit (id bigserial primary key, actor_id text, actor_email text not null, action text not null, entity text not null, entity_id text not null, before jsonb, after jsonb, request_id text, route text not null, status text not null, reason text not null, ip_hash text, user_agent_hash text, created_at timestamptz not null default now());
        ${TABLES.slice(0, 8).map(table => `alter table ${table} enable row level security;`).join('\n')}
      `);
      await tx.unsafe(await readFile(path.join(ROOT, 'migrations/0041_coupons.sql'), 'utf8'));
      await tx`insert into coupons(id, code, type, value) values ('legacy', 'LEGACY5', 'PERCENT', 10)`;
    });
    return { sql, manifest, close, applyVisibility: async () => sql.unsafe(await readFile(path.join(ROOT, 'migrations/0053_coupon_visibility_assignments.sql'), 'utf8')) };
  } catch (error) { await close(); throw error; }
}
