import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHEMA = 'itest_phase4_variant_stock_approved';
export const MIGRATION = '0052_variant_inventory.sql';
export const TABLES = ['products', 'device_models', 'product_variants', 'orders', 'order_items', 'stock', 'stock_movements'];
const METRICS = ['inserts', 'updates', 'deletes', 'rejectedInserts', 'rejectedUpdates', 'rejectedDeletes', 'zeroRowUpdates'];
const stockWrite = n => ({ updates: { stock: n }, inserts: { stock_movements: n } });
export const OPERATIONS = [
  { name: 'seed', inserts: { products: 3, device_models: 1, product_variants: 5, orders: 10, order_items: 2, stock: 6 } },
  { name: 'migration repeat' },
  { name: 'claim two variants', ...stockWrite(2) },
  { name: 'release two variants', ...stockWrite(2) },
  { name: 'duplicate release' },
  { name: 'late reclaim two variants', ...stockWrite(2) },
  { name: 'return two variants', ...stockWrite(2) },
  { name: 'cap remaining return', ...stockWrite(1) },
  { name: 'settled release no-op' },
  { name: 'same variant race', ...stockWrite(1), zeroRowUpdates: { stock: 1 }, transactionRollbacks: 1 },
  { name: 'independent sibling race', ...stockWrite(2) },
  { name: 'claim for concurrent returns', ...stockWrite(1) },
  { name: 'concurrent capped returns', ...stockWrite(1) },
  { name: 'legacy claim', ...stockWrite(1) },
  { name: 'legacy release', ...stockWrite(1) },
  { name: 'caller rollback', ...stockWrite(2), rollback: true, transactionRollbacks: 1 },
  { name: 'claim before failed reclaim', ...stockWrite(2) },
  { name: 'release before failed reclaim', ...stockWrite(2) },
  { name: 'reserve competing units', updates: { stock: 1 } },
  { name: 'late reclaim all-or-none refusal' },
  { name: 'clear competing reservation', updates: { stock: 1 } },
  { name: 'untracked and missing plans' },
  { name: 'reject stock owner', rejectedInserts: { stock: 1 }, transactionRollbacks: 1 },
  { name: 'reject movement owner', rejectedInserts: { stock_movements: 1 }, transactionRollbacks: 1 },
  { name: 'reject order item owner', rejectedInserts: { order_items: 1 }, transactionRollbacks: 1 },
  { name: 'reject movement update', rejectedUpdates: { stock_movements: 1 }, transactionRollbacks: 1 },
  { name: 'reject movement delete', rejectedDeletes: { stock_movements: 1 }, transactionRollbacks: 1 },
  { name: 'reject negative stock', rejectedUpdates: { stock: 1 }, transactionRollbacks: 1 },
  { name: 'reject empty commerce identity', rejectedInserts: { product_variants: 1 }, transactionRollbacks: 1 },
  { name: 'reject duplicate commerce combination', rejectedInserts: { product_variants: 1 }, transactionRollbacks: 1 },
  { name: 'reject invalid inventory mode', rejectedUpdates: { products: 1 }, transactionRollbacks: 1 },
];
export const SOURCE_FILES = ['tests/helpers/phase4-fixture.mjs', 'tests/phase4-stock-integration.test.mjs', 'scripts/phase4-test-manifest.mjs', 'src/lib/payu/stock.ts', 'src/lib/checkout/stock-rules.ts'];
const zeros = () => Object.fromEntries(TABLES.map(table => [table, 0]));
const metrics = () => Object.fromEntries(METRICS.map(key => [key, zeros()]));
const expected = op => Object.fromEntries(METRICS.map(key => [key, { ...zeros(), ...op[key] }]));
export function manifestTotals(operations = OPERATIONS) {
  const committed = metrics(), rolledBack = metrics();
  let transactionRollbacks = 0;
  for (const op of operations) {
    transactionRollbacks += op.transactionRollbacks ?? 0;
    for (const key of METRICS) for (const [table, n] of Object.entries(op[key] ?? {})) {
      // Rejected/zero-row statements never change rows, even in mixed race operations.
      (op.rollback ? rolledBack : committed)[key][table] += n;
    }
  }
  const sequences = ['stock_movements', 'order_items'].map(table => ({
    name: `${SCHEMA}.${table}_id_seq`,
    committedAdvances: committed.inserts[table],
    rolledBackAdvances: rolledBack.inserts[table],
    rejectedAdvances: committed.rejectedInserts[table] + rolledBack.rejectedInserts[table],
    totalAdvances: committed.inserts[table] + rolledBack.inserts[table] + committed.rejectedInserts[table] + rolledBack.rejectedInserts[table],
  }));
  return { committed, rolledBack, transactionRollbacks, sequences };
}

/** Pure: reads only explicitly listed source files; never loads env files or postgres. */
export async function phase4Manifest(databaseUrl) {
  let target;
  try {
    target = new URL(databaseUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
    assert.ok(target.hostname);
    assert.notEqual(target.port, '6543');
  } catch { throw new Error('Supply an explicit PostgreSQL session target; details withheld'); }
  const hash = async name => createHash('sha256').update(await readFile(path.join(ROOT, name))).digest('hex');
  const plan = {
    version: 1, hostname: target.hostname, port: target.port || '5432',
    // Bind credentials/options too, without exposing them in approval output.
    targetSha256: createHash('sha256').update(databaseUrl).digest('hex'),
    schemas: [SCHEMA], maximumConnections: 2,
    connectionPolicy: 'session pool max:2; search_path is only the owned schema; no global application pool or env auto-load',
    publicBusinessDataReads: 0, publicTableWrites: 0, publicSequenceAdvances: 0,
    ddl: { createSchemas: 1, createBaseTables: TABLES.length, enableRls: TABLES.length, migrationExecutions: 2, dropOwnedSchemasCascade: 1 },
    migrationSha256: { [MIGRATION]: await hash(`migrations/${MIGRATION}`) },
    sourceSha256: Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, await hash(file)]))),
    operations: OPERATIONS, ...manifestTotals(),
    countsPolicy: 'Row writes measured per operation, including successful writes subsequently rolled back, rejected single-row statement attempts, zero-row guarded updates, and nontransactional sequence advances. SELECT FOR UPDATE is a row lock, not a logical row update.',
    cleanup: `DROP SCHEMA ${SCHEMA} CASCADE only after this run successfully created it; existing schemas are refused, never adopted`,
    externalEffects: 'none: injected transaction stock helpers only; no notifications/cache/SMTP/PayU/app pool',
    scope: 'Actual migration 0052 and stock engine only; not full checkout/payment/POS/return-route lifecycle, allocation, browser or RLS role authorization proof',
  };
  return { ...plan, approvalSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

// Minimal pre-0052 local contracts, not LIKE copies. Every base table gets RLS
// in this same transaction. All FKs and sequence defaults resolve locally.
const BASE_DDL = `
create table products (id text primary key);
create table device_models (id text primary key);
create table product_variants (id text primary key,product_id text not null references products(id) on delete cascade,sku text unique,is_active boolean not null default true);
create table orders (id text primary key);
create table order_items (id bigserial primary key,order_id text not null references orders(id) on delete cascade,product_id text not null);
create table stock (id text primary key,product_id text not null references products(id) on delete cascade,variant_id text references product_variants(id) on delete cascade,on_hand integer not null default 0 check(on_hand>=0),reserved integer not null default 0 check(reserved>=0),track_inventory boolean not null default false,updated_at timestamptz not null default now(),updated_by text,check(reserved<=on_hand));
create unique index idx_stock_product_variant on stock(product_id,variant_id) where variant_id is not null;
create unique index idx_stock_product_level on stock(product_id) where variant_id is null;
create table stock_movements (id bigserial primary key,product_id text not null references products(id),variant_id text references product_variants(id),delta integer not null,reason text not null check(reason in ('seed','receipt','sale','return','release','adjustment','damage')),order_id text references orders(id) on delete set null,created_by text,created_at timestamptz not null default now());
${TABLES.map(table => `alter table ${table} enable row level security;`).join('\n')}
`;

export async function openPhase4Fixture() {
  // These gates MUST precede importing/constructing a SQL client.
  assert.equal(process.env.RUN_PHASE4_DB_TESTS, '1', 'Phase4 DB tests require explicit write approval');
  const manifest = await phase4Manifest(process.env.DATABASE_URL);
  assert.equal(process.env.PHASE4_APPROVED_MANIFEST, manifest.approvalSha256, 'Generate and approve the exact Phase4 write manifest before execution');
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 20, connect_timeout: 10, max_lifetime: 1800, fetch_types: false, prepare: false, ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {}, connection: { search_path: SCHEMA, statement_timeout: 15000, lock_timeout: 10000 } });
  let created = false, active = null;
  const done = new Set();
  const rows = async () => {
    const [row] = await sql.unsafe(`
      select ${TABLES.map(t => `(select count(*)::int from "${SCHEMA}"."${t}") as "${t}"`).join(', ')}
    `);
    return Object.fromEntries(TABLES.map(t => [t, Number(row[t] ?? 0)]));
  };
  const sequences = async () => {
    const [row] = await sql.unsafe(`
      select ${manifest.sequences.map((s, i) => `(select case when is_called then last_value::int else 0 end from ${s.name}) as "s${i}"`).join(', ')}
    `);
    return Object.fromEntries(manifest.sequences.map((s, i) => [s.name, Number(row[`s${i}`] ?? 0)]));
  };
  function instrument(tx, record) {
    return Object.assign(async (strings, ...values) => {
      if (!strings || !Array.isArray(strings.raw)) return tx(strings, ...values);
      const text = strings.join('?');
      const cteWrite = text.match(/^\s*with\s+(?:claimed|restored)\s+as\s*\(\s*update\s+stock\b/i);
      const write = text.match(/^\s*(insert\s+into|update|delete\s+from)\s+([a-z_]+)/i);
      const kind = write?.[1].toLowerCase().split(/\s/)[0];
      const table = write?.[2];
      if (write) assert.ok(TABLES.includes(table), 'Write outside declared local tables');
      try {
        const result = await tx(strings, ...values);
        if (cteWrite) {
          const n = result.count;
          assert.ok(Number.isInteger(n), 'SQL row count required');
          if (n > 0) {
            record.updates.stock += n;
            record.inserts.stock_movements += n;
          } else {
            record.zeroRowUpdates.stock++;
          }
        } else if (write) {
          const n = result.count;
          assert.ok(Number.isInteger(n), 'SQL row count required');
          record[{ insert: 'inserts', update: 'updates', delete: 'deletes' }[kind]][table] += n;
          if (kind === 'update' && n === 0) record.zeroRowUpdates[table]++;
        }
        return result;
      } catch (error) {
        if (cteWrite) record.rejectedUpdates.stock++;
        else if (write) record[{ insert: 'rejectedInserts', update: 'rejectedUpdates', delete: 'rejectedDeletes' }[kind]][table]++;
        throw error;
      }
    }, { json: tx.json, array: tx.array, unsafe: tx.unsafe, savepoint: tx.savepoint });
  }
  const fixture = {
    sql, manifest,
    migration: () => sql.begin(async tx => tx.unsafe(await readFile(path.join(ROOT, 'migrations', MIGRATION), 'utf8'))),
    async transaction(callback) {
      assert.ok(active, 'Transactions must belong to a manifest operation');
      const record = active;
      try { return await sql.begin(tx => callback(instrument(tx, record.metrics))); }
      catch (error) { record.rollbacks++; throw error; }
    },
    async operation(name, callback) {
      assert.equal(active, null, 'Operations cannot overlap (transactions within one operation may race)');
      const op = OPERATIONS.find(item => item.name === name);
      assert.ok(op, `Undeclared operation ${name}`); assert.ok(!done.has(name), `Repeated operation ${name}`);
      const before = await rows(), sequenceBefore = await sequences();
      active = { metrics: metrics(), rollbacks: 0 };
      try {
        await callback(fixture);
        assert.deepEqual(active.metrics, expected(op), `${name}: exact executed writes/attempts`);
        assert.equal(active.rollbacks, op.transactionRollbacks ?? 0, `${name}: transaction rollbacks`);
        const after = await rows(), sequenceAfter = await sequences();
        for (const table of TABLES) assert.equal(after[table] - before[table], op.rollback ? 0 : (op.inserts?.[table] ?? 0) - (op.deletes?.[table] ?? 0), `${name}: persisted ${table}`);
        for (const seq of manifest.sequences) {
          const table = seq.name.includes('stock_movements') ? 'stock_movements' : 'order_items';
          assert.equal(sequenceAfter[seq.name] - sequenceBefore[seq.name], (op.inserts?.[table] ?? 0) + (op.rejectedInserts?.[table] ?? 0), `${name}: ${seq.name}`);
        }
        done.add(name);
      } finally { active = null; }
    },
    async assertCounts() {
      assert.equal(done.size, OPERATIONS.length, 'Every approved operation must execute exactly once');
      assert.deepEqual(await rows(), manifest.committed.inserts);
      const actual = await sequences();
      for (const seq of manifest.sequences) assert.equal(actual[seq.name], seq.totalAdvances, seq.name);
    },
    async close() {
      try { if (created) await sql.unsafe(`drop schema "${SCHEMA}" cascade`); }
      finally { await sql.end({ timeout: 1 }); }
    },
  };
  try {
    // No IF NOT EXISTS: a collision must never authorize cleanup of somebody else's schema.
    await sql.unsafe(`create schema "${SCHEMA}"`); created = true;
    const [pin] = await sql`select current_schema() as name,current_setting('search_path') as path`;
    assert.equal(pin.name, SCHEMA); assert.equal(pin.path, SCHEMA);
    await sql.begin(tx => tx.unsafe(BASE_DDL));
    await fixture.migration();
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}
