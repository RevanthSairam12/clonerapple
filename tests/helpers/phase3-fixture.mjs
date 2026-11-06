import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHEMA = 'itest_phase3_metadata_approved';
export const MIGRATION = '0051_product_types_compatibility.sql';
export const TABLES = ['users', 'store_admins', 'categories', 'attributes', 'attribute_options', 'products', 'product_attribute_values', 'store_admin_audit', 'price_history', 'stock_levels', 'stock_movements', 'stock_reservations', 'product_types', 'product_type_attributes', 'device_brands', 'device_models', 'product_device_models', 'product_attribute_history', 'product_variants', 'product_images', 'product_variant_colours', 'colours', 'stock'];

/**
 * Local compatibility for the reduced fixture schema, which is hand-written
 * rather than migrated. `duplicateProductUsing` copies the product row through
 * these columns, added to the real table by migration 0060; without them the
 * duplicate path fails on a schema the fixture never grew. This is fixture
 * setup only — it never alters public, and the copy semantics stay the code's.
 */
export const PRODUCT_COLUMNS_FROM_0060 = `alter table products
  add column if not exists inventory_mode text not null default 'product' check (inventory_mode in ('product','variant')),
  add column if not exists sell_by text not null default 'single' check (sell_by in ('single','colour','model','model_colour','other')),
  add column if not exists sku_pattern text,
  add column if not exists short_description text,
  add column if not exists description_sections jsonb`;

/**
 * Tables `duplicateProductUsing` copies that the reduced fixture never declared.
 * `duplicateProductUsing` copies photos, saved options and their immutable colour
 * links (migrations 0011, 0052, 0055, 0059, 0060); the hand-written fixture schema
 * only carried the columns that the metadata service itself touches. Built to the
 * real shapes so the duplicate path exercises real copy semantics, not a trimmed
 * stand-in. Fixture setup only — it never alters public.
 */
export const DUPLICATE_COPY_TABLES_FROM_0052_0060 = `
create table if not exists colours (id text primary key, name text not null, hex text not null, sort_order integer not null default 0, is_active boolean not null default true);
alter table colours enable row level security;
-- The commerce-era stock table (0011), which productMetadataUsing joins to find
-- retained options. The fixture's own reduced stock_levels is separate and stays.
create table if not exists stock (id text primary key, product_id text not null references products(id), variant_id text, on_hand integer not null default 0, reserved integer not null default 0, low_stock_threshold integer not null default 0, track_inventory boolean not null default false);
alter table stock enable row level security;
-- Read-only in this fixture: the metadata service only joins it. Any write is a
-- regression, so it fails loudly like the other stock tables.
create trigger no_stock_write before insert or update or delete on stock for each statement execute function fixture_no_stock_write();
create table if not exists product_images (id text primary key, product_id text not null references products(id), url text not null, alt text not null default '', role text not null default 'gallery' check (role in ('primary','hover','gallery')), sort_order integer not null default 0, colour_id text references colours(id), is_active boolean not null default true, deleted_at timestamptz, created_at timestamptz not null default now());
alter table product_images enable row level security;
alter table product_variants
  add column if not exists sku text unique,
  add column if not exists option_name text not null default 'Colour',
  add column if not exists option_value text not null default '',
  add column if not exists option_hex text,
  add column if not exists price_paise_override integer,
  add column if not exists sale_price_paise integer,
  add column if not exists sort_order integer not null default 0,
  add column if not exists combination_key text,
  add column if not exists option_identity text,
  add column if not exists retired_at timestamptz;
-- The real schema's (product_id,id) unique index is what the composite colour FK
-- references (0052 idx_variants_product_identity), so the fixture needs it too.
create unique index if not exists idx_variants_product_identity on product_variants(product_id,id);
create table if not exists product_variant_colours (variant_id text primary key, product_id text not null references products(id), colour_id text not null references colours(id), created_at timestamptz not null default now(), foreign key (product_id,variant_id) references product_variants(product_id,id));
alter table product_variant_colours enable row level security;
`;
const zeros = () => Object.fromEntries(TABLES.map(table => [table, 0]));
const counts = sparse => ({ ...zeros(), ...sparse });

// Each operation is asserted against live row/sequence deltas, not just a guessed
// final total. ON CONFLICT updates are not new PAV rows; their trigger inserts
// ARE new history rows. Rejected SQL INSERTs are counted separately below.
export const OPERATIONS = [
  { name: 'base seed', inserts: { store_admins: 1, categories: 2, attributes: 6, attribute_options: 2, products: 2, product_attribute_values: 4 } },
  { name: 'reference seed', inserts: { product_types: 3, product_type_attributes: 5, device_brands: 2, device_models: 3 } },
  { name: 'archive legacy model value', inserts: { product_attribute_history: 1 } },
  { name: 'classify source deliberately', inserts: { product_device_models: 1, store_admin_audit: 1 } },
  { name: 'archive enum', inserts: { product_attribute_history: 1, store_admin_audit: 1 } },
  { name: 'restore enum', inserts: { product_attribute_history: 1, store_admin_audit: 1 } },
  { name: 'same value retry', inserts: { store_admin_audit: 1 } },
  { name: 'move category and type together', inserts: { store_admin_audit: 1 } },
  { name: 'restore category and type', inserts: { store_admin_audit: 1 } },
  { name: 'publish complete false and zero', inserts: {} },
  // Clears the product's type to prove an unclassified product still publishes
  // cleanly, then reverts it inside the same transaction. The audit row the
  // metadata save writes is the only net insert.
  { name: 'untyped publication is valid (rollback probe)', rollback: true, inserts: { store_admin_audit: 1 } },
  { name: 'reject required value removal', rollback: true, inserts: { product_attribute_history: 1 } },
  { name: 'reject active device removal', rollback: true, inserts: {} },
  // An acceptance probe, not a rejection: it re-enables the device model the
  // cases above deactivated, saves with publication enforced, and proves the
  // save is accepted and stamps the compatibility review. The transaction then
  // re-deactivates the model and reverts, so the save's audit row is rolled back
  // with it and the later cases see the deactivated state they expect.
  { name: 'publish under review', rollback: true, inserts: { store_admin_audit: 1 } },
  { name: 'reject inactive brand publication', rollback: true, inserts: {} },
  { name: 'reject inactive model publication', rollback: true, inserts: {} },
  { name: 'reject inactive type publication', rollback: true, inserts: {} },
  { name: 'retain explicit inactive draft type', rollback: true, inserts: { store_admin_audit: 1 } },
  { name: 'strict audit failure', rollback: true, inserts: { product_attribute_history: 1 }, rejected: { store_admin_audit: 1 } },
  { name: 'caller rollback', rollback: true, inserts: { product_attribute_history: 1, store_admin_audit: 1 } },
  // A duplicate copies prices as settings and never writes price history, so
  // neither duplicate operation advances price_history_id_seq.
  { name: 'duplicate draft once', inserts: { products: 1, product_attribute_values: 4, product_device_models: 1, store_admin_audit: 1 } },
  { name: 'duplicate caller rollback', rollback: true, inserts: { products: 1, product_attribute_values: 4, product_device_models: 1, store_admin_audit: 1 } },
];
export const REJECTED_INSERTS = counts({ product_types: 4, product_type_attributes: 1, device_models: 1, product_attribute_values: 2, product_device_models: 2, store_admin_audit: 1 });
const SOURCE_FILES = ['tests/helpers/phase3-fixture.mjs', 'tests/phase3-metadata-integration.test.mjs', 'scripts/phase3-test-manifest.mjs', 'src/lib/store-admin/product-metadata.ts', 'src/lib/catalog/product-metadata-rules.ts', 'src/lib/store-admin/product-duplicate.ts', 'src/lib/store-admin/catalog-rules.ts', 'src/lib/store-admin/audit.ts', 'src/lib/platform/db.ts'];

/** Pure approval calculation: no env file loading, client import or connection. */
export async function phase3Manifest(databaseUrl = process.env.DATABASE_URL) {
  let hostname = null;
  if (databaseUrl) {
    try { hostname = new URL(databaseUrl).hostname; }
    catch { throw new Error('Invalid database target; details withheld'); }
  }
  const hash = async name => createHash('sha256').update(await readFile(path.join(ROOT, name))).digest('hex');
  const committedInserts = zeros(), rolledBackInserts = zeros();
  for (const op of OPERATIONS) for (const [table, count] of Object.entries(op.inserts)) (op.rollback ? rolledBackInserts : committedInserts)[table] += count;
  const plan = {
    version: 1, hostname, schemas: [SCHEMA], maximumConnections: 1,
    connectionPolicy: 'one max:1 session; no races, app pool, environment loading or public search_path fallback',
    publicBusinessDataReads: 0, publicTableWrites: 0, publicSequenceAdvances: 0,
    migrationSha256: { [MIGRATION]: await hash(`migrations/${MIGRATION}`) },
    sourceSha256: Object.fromEntries(await Promise.all(SOURCE_FILES.map(async name => [name, await hash(name)]))),
    operations: OPERATIONS, committedInserts, rolledBackInserts, rejectedInsertAttempts: REJECTED_INSERTS,
    sequences: [
      { name: `${SCHEMA}.phase3_audit_id_seq`, committedAdvances: committedInserts.store_admin_audit, rolledBackAdvances: rolledBackInserts.store_admin_audit, rejectedAdvances: REJECTED_INSERTS.store_admin_audit, totalAdvances: 13 },
      { name: `${SCHEMA}.product_attribute_history_id_seq`, committedAdvances: committedInserts.product_attribute_history, rolledBackAdvances: rolledBackInserts.product_attribute_history, rejectedAdvances: 0, totalAdvances: 6 },
      { name: `${SCHEMA}.price_history_id_seq`, committedAdvances: committedInserts.price_history, rolledBackAdvances: rolledBackInserts.price_history, rejectedAdvances: 0, totalAdvances: 0 },
    ],
    updates: ['PAV archive/restore/no-op (real history trigger)', 'product type/category in a single FK-safe UPDATE', 'draft to published with false/zero required values', 'compatibility selections and review timestamp'],
    rejectedUpdates: ['category/type composite FK mismatch', 'missing category FK', 'immutable local audit UPDATE/DELETE'],
    serviceRejectionsWithoutInserts: ['invalid enum/type/attribute/device/product references', 'duplicate slug retry (no second product/price/audit/stock insert)'],
    stockWrites: 0, cleanup: `DROP SCHEMA ${SCHEMA} CASCADE only if created by this run; existing schema is refused, never adopted`,
    excluded: ['owner saveMetadataReference and updateProductMetadata wrappers have no injected transaction seam; never replace getSql/global pool', 'role/origin route tests are mocked elsewhere', 'no race tests'],
    externalEffects: 'none: transaction seams only, no notifications, cache, SMTP, PayU or app pool',
  };
  return { ...plan, approvalSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

// Minimal local contracts only. Never LIKE production tables, never a public FK
// or default. Each new base table enables RLS in this same DDL transaction.
const BASE_DDL = `
create table users (id text primary key);
create table store_admins (id text primary key);
create table categories (id text primary key, deleted_at timestamptz);
create table attributes (id text primary key, key text not null unique, label text not null, data_type text not null check(data_type in ('text','number','boolean','enum')), sort_order integer not null default 0, is_active boolean not null default true, deleted_at timestamptz);
create table attribute_options (attribute_id text not null references attributes(id), value text not null, sort_order integer not null default 0, primary key(attribute_id,value));
create table products (id text primary key, slug text not null unique, name text not null, category_id text not null references categories(id), subtitle text, price_paise bigint not null default 10000, compare_at_paise bigint, sale_price_paise bigint, currency text not null default 'INR', material text, brand text, brand_id text, condition_id text, description text, badge text, highlights jsonb, in_the_box jsonb, seo_title text, seo_description text, in_stock boolean not null default true, is_active boolean not null default false, updated_by text references store_admins(id), updated_at timestamptz not null default now(), deleted_at timestamptz);
create table product_attribute_values (product_id text not null references products(id), attribute_id text not null references attributes(id), value_text text, value_number numeric(18,6), value_bool boolean, option_value text, primary key(product_id,attribute_id));
create sequence phase3_audit_id_seq;
create table store_admin_audit (id bigint primary key default nextval('${SCHEMA}.phase3_audit_id_seq'::regclass), actor_id text references store_admins(id), actor_email text not null, action text not null, entity text not null, entity_id text not null, before jsonb, after jsonb, request_id text, route text not null, status text not null, reason text not null, ip_hash text, user_agent_hash text, created_at timestamptz not null default now());
create table price_history (id bigserial primary key, product_id text not null references products(id), variant_id text, old_price_paise bigint, new_price_paise bigint not null, currency text not null, reason text not null, source text not null check(source in ('seed','store_admin','bulk_import','api')), changed_by text references store_admins(id));
create table product_variants (id text primary key, product_id text not null references products(id), device_model_id text, is_active boolean not null default true, is_purchasable boolean not null default false);
alter table product_variants enable row level security;
create table stock_levels (product_id text primary key references products(id), on_hand integer not null default 0);
create table stock_movements (id text primary key, product_id text references products(id));
create table stock_reservations (id text primary key, product_id text references products(id));
create function fixture_immutable() returns trigger language plpgsql as $$ begin raise exception 'fixture audit is immutable'; end $$;
create trigger audit_immutable before update or delete on store_admin_audit for each row execute function fixture_immutable();
create trigger price_history_immutable before update or delete on price_history for each row execute function fixture_immutable();
create function fixture_no_stock_write() returns trigger language plpgsql as $$ begin raise exception 'Phase3 fixture forbids stock writes'; end $$;
create trigger no_stock_levels_write before insert or update or delete on stock_levels for each statement execute function fixture_no_stock_write();
create trigger no_stock_movements_write before insert or update or delete on stock_movements for each statement execute function fixture_no_stock_write();
create trigger no_stock_reservations_write before insert or update or delete on stock_reservations for each statement execute function fixture_no_stock_write();
${TABLES.slice(0, 12).map(table => `alter table ${table} enable row level security;`).join('\n')}
`;

export async function openPhase3Fixture() {
  // Must precede even the postgres module import/client constructor.
  assert.equal(process.env.RUN_PHASE3_DB_TESTS, '1', 'Phase3 DB tests require explicit write approval');
  const manifest = await phase3Manifest();
  assert.ok(manifest.hostname, 'Supply DATABASE_URL explicitly; no env files are loaded');
  assert.equal(process.env.PHASE3_APPROVED_MANIFEST, manifest.approvalSha256, 'Generate and approve the exact Phase3 write manifest before execution');
  const target = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'Requires a PostgreSQL target');
  assert.notEqual(target.port, '6543', 'Requires a session connection');
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {}, connection: { search_path: SCHEMA, statement_timeout: 15000, lock_timeout: 10000 } });
  let created = false;
  const done = new Set(), rejected = zeros();
  const localCount = async (tx, table) => (await tx.unsafe(`select count(*)::int n from "${SCHEMA}"."${table}"`))[0].n;
  async function snapshot(tx) {
    const result = zeros();
    for (const table of TABLES) {
      const [row] = await tx`select to_regclass(${`${SCHEMA}.${table}`}) as name`;
      if (row.name) result[table] = await localCount(tx, table);
    }
    return result;
  }
  async function sequenceSnapshot(tx) {
    const result = {};
    for (const sequence of manifest.sequences) {
      const [exists] = await tx`select to_regclass(${sequence.name}) as name`;
      if (!exists.name) { result[sequence.name] = 0; continue; }
      const [row] = await tx.unsafe(`select last_value::int n,is_called from ${sequence.name}`);
      result[sequence.name] = row.is_called ? row.n : 0;
    }
    return result;
  }
  const fixture = {
    sql, manifest,
    async operation(name, callback, rejection) {
      const op = OPERATIONS.find(item => item.name === name);
      assert.ok(op, `Undeclared operation: ${name}`); assert.ok(!done.has(name), `Repeated operation: ${name}`);
      const before = await snapshot(sql);
      const sequencesBefore = await sequenceSnapshot(sql);
      if (op.rollback) {
        // Failed service transactions cannot be inspected after abort. Their
        // nontransactional sequence deltas independently prove attempted history
        // and audit inserts; caller rollback counts are also inspected inside.
        if (rejection) await assert.rejects(sql.begin(callback), rejection);
        else await assert.rejects(sql.begin(async tx => {
          await callback(tx);
          const inside = await snapshot(tx);
          for (const table of TABLES) assert.equal(inside[table] - before[table], op.inserts[table] ?? 0, `${name}: rollback ${table}`);
          throw new Error('phase3 intentional caller rollback');
        }), /phase3 intentional caller rollback/);
      } else {
        await callback(sql);
      }
      const after = await snapshot(sql);
      const sequencesAfter = await sequenceSnapshot(sql);
      const sequenceTables = { phase3_audit_id_seq: 'store_admin_audit', product_attribute_history_id_seq: 'product_attribute_history', price_history_id_seq: 'price_history' };
      for (const sequence of manifest.sequences) {
        const table = sequenceTables[sequence.name.split('.').at(-1)];
        assert.equal(sequencesAfter[sequence.name] - sequencesBefore[sequence.name], (op.inserts[table] ?? 0) + (op.rejected?.[table] ?? 0), `${name}: ${sequence.name} advances`);
      }
      for (const table of TABLES) assert.equal(after[table] - before[table], op.rollback ? 0 : op.inserts[table] ?? 0, `${name}: committed ${table}`);
      for (const [table, n] of Object.entries(op.rejected ?? {})) rejected[table] += n;
      done.add(name);
    },
    async rejectInsert(table, callback, pattern) {
      await assert.rejects(callback(), pattern); rejected[table]++;
    },
    async assertCounts() {
      assert.equal(done.size, OPERATIONS.length, 'Every manifest operation ran exactly once');
      assert.deepEqual(rejected, manifest.rejectedInsertAttempts);
      const actual = await snapshot(sql); assert.deepEqual(actual, manifest.committedInserts);
      for (const sequence of manifest.sequences) {
        const [row] = await sql.unsafe(`select last_value::int n,is_called from ${sequence.name}`);
        // Normalized the same way sequenceSnapshot does: an uncalled sequence
        // reports last_value 1 but has advanced 0 times, so it must read as 0.
        // A sequence that should never have advanced must not have been called
        // (price_history is never written by these paths); one that advanced must
        // have been. Demanding a call for a zero-advance sequence would itself be
        // the bug.
        assert.equal(row.is_called, sequence.totalAdvances > 0, `${sequence.name} called state`);
        assert.equal(row.is_called ? row.n : 0, sequence.totalAdvances, sequence.name);
      }
    },
    async close() {
      try { if (created) await sql.unsafe(`drop schema "${SCHEMA}" cascade`); }
      finally { await sql.end({ timeout: 5 }); }
    },
  };
  try {
    await sql.unsafe(`create schema "${SCHEMA}"`); created = true;
    const [pin] = await sql`select current_schema() as name,current_setting('search_path') as path`;
    assert.equal(pin.name, SCHEMA); assert.equal(pin.path, SCHEMA);
    await sql.begin(tx => tx.unsafe(BASE_DDL));
    await fixture.operation('base seed', async client => client.begin(async tx => {
      await tx`insert into store_admins(id) values ('phase3_owner')`;
      await tx`insert into categories(id) values ('cat_a'),('cat_b')`;
      await tx`insert into attributes(id,key,label,data_type,is_active) values ('flag','flag','Flag','boolean',true),('quantity','quantity','Quantity','number',true),('colour','colour','Colour','enum',true),('model','model','Legacy model','text',true),('hidden','hidden','Inactive','text',false),('unmapped','unmapped','Unmapped','text',true)`;
      await tx`insert into attribute_options(attribute_id,value) values ('colour','red'),('colour','blue')`;
      await tx`insert into products(id,slug,name,category_id) values ('legacy','legacy','Unclassified legacy','cat_a'),('source','source','Source','cat_a')`;
      await tx`insert into product_attribute_values(product_id,attribute_id,value_bool,value_number,option_value,value_text) values ('source','flag',false,null,null,null),('source','quantity',null,0,null,null),('source','colour',null,null,'red',null),('source','model',null,null,null,'Historical model')`;
    }));
    // Apply the actual, hash-bound file, not a copied approximation.
    const migration = await readFile(path.join(ROOT, 'migrations', MIGRATION), 'utf8');
    await sql.begin(tx => tx.unsafe(migration));
    // Then the reduced fixture catches up to the columns and copied tables the
    // code under test uses, exactly as the real schema has them after 0060.
    await sql.begin(tx => tx.unsafe(PRODUCT_COLUMNS_FROM_0060));
    await sql.begin(tx => tx.unsafe(DUPLICATE_COPY_TABLES_FROM_0052_0060));
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}
