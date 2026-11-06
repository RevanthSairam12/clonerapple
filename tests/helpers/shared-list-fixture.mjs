import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHEMA = 'itest_shared_lists_v1';
export const MIGRATIONS = ['0057_catalog_edit_revision.sql', '0058_shared_catalogue_normalization.sql', '0059_shared_colours.sql'];
export const TABLES = ['store_admins','device_brands','device_models','products','product_variants','product_device_models','store_admin_audit','product_types','product_type_attributes','attributes','attribute_options','product_attribute_values','product_images','product_facets','product_specs','colours','product_variant_colours'];
const zeros = () => Object.fromEntries(TABLES.map(name => [name, 0]));
const operation = (name, inserts = {}, rest = {}) => ({ name, inserts, ...rest });
export const OPERATIONS = [
  operation('base seed', { store_admins: 1, device_brands: 2, device_models: 2, products: 2, product_variants: 3, product_device_models: 2 }, { updates: { products: 5 } }),
  operation('brand collision migration abort', { device_brands: 2 }, { rollback: true, migrationRejected: true }),
  operation('model collision migration abort', { device_models: 2 }, { rollback: true, migrationRejected: true }),
  operation('empty key migration abort', { device_brands: 1 }, { rollback: true, migrationRejected: true }),
  operation('apply actual 0058 and 0059'),
  operation('colour links seed', { colours: 2, product_variant_colours: 2 }, { updates: { products: 2 } }),
  ...[['brand normalized duplicate','device_brands'],['model scoped duplicate','device_models'],['model missing brand','device_models'],['colour normalized duplicate','colours'],['colour hex duplicate','colours'],['colour invalid hex','colours'],['link wrong parent','product_variant_colours'],['link missing colour','product_variant_colours'],['link missing product','product_variant_colours'],['link duplicate variant','product_variant_colours']].map(([name, table]) => operation(name, {}, { rollback: true, rejected: { [table]: 1 } })),
  operation('immutable link update', {}, { rollback: true, rejectedUpdates: 1 }),
  operation('immutable link delete', {}, { rollback: true, rejectedDeletes: 1 }),
  operation('colour import', { colours: 1, store_admin_audit: 1 }),
  operation('repeated import audited noop', { store_admin_audit: 1 }),
  operation('near match unacknowledged', {}, { rollback: true, serviceRejected: true }),
  operation('near match acknowledged', { colours: 1, store_admin_audit: 1 }),
  operation('model import', { device_models: 1, store_admin_audit: 1 }),
  operation('strict audit failure', { colours: 1 }, { rollback: true, rejected: { store_admin_audit: 1 } }),
  operation('caller rollback', { colours: 1, store_admin_audit: 1 }, { rollback: true }),
  operation('colour edit fanout', { store_admin_audit: 1 }, { updates: { colours: 1, products: 2 } }),
  operation('reference identical save noop'),
  operation('timestamp only noop', {}, { updates: { colours: 1 } }),
  operation('colour deactivate retains retired variant', { store_admin_audit: 1 }, { updates: { colours: 1, products: 2 } }),
  operation('model deactivate retains retired variant', { store_admin_audit: 1 }, { updates: { device_models: 1, products: 1 } }),
  operation('immutable audit update', {}, { rollback: true, rejectedUpdates: 1 }),
  operation('immutable audit delete', {}, { rollback: true, rejectedDeletes: 1 }),
];
export const RACE_OPERATION = operation('two concurrent duplicate imports', { colours: 1, store_admin_audit: 1 }, { concurrentTransactions: 2, serviceRejected: 1 });
const SOURCES = ['package-lock.json','tests/helpers/shared-list-fixture.mjs','tests/shared-list-integration.test.mjs','tests/shared-list-schema.test.mjs','tests/shared-list-service.test.mjs','scripts/shared-list-test-manifest.mjs','src/lib/store-admin/shared-lists.ts','src/lib/catalog/shared-list-rules.ts','src/lib/store-admin/product-metadata.ts','src/lib/catalog/product-metadata-rules.ts','src/lib/store-admin/catalog-rules.ts','src/lib/store-admin/audit.ts'];
const sha = value => createHash('sha256').update(value).digest('hex');

/** Pure calculation. No env files, driver import, connection or target probing. */
export async function sharedListManifest({ databaseUrl, race = false, ssl = 'require' } = {}) {
  let target;
  try { target = new URL(databaseUrl); } catch { throw new Error('Supply an explicit PostgreSQL target; details withheld'); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL target required');
  assert.ok(target.hostname && target.pathname.length > 1 && !target.search && !target.hash, 'Explicit database and no URL query overrides required');
  assert.notEqual(target.port, '6543', 'Use a session connection, not transaction pooling');
  assert.ok(ssl === 'require' || ssl === 'disable', 'Explicit TLS policy required');
  assert.equal(typeof race, 'boolean');
  const operations = [...OPERATIONS, ...(race ? [RACE_OPERATION] : [])];
  const committedInserts = zeros(), rolledBackInserts = zeros(), rejectedInsertAttempts = zeros(), committedUpdates = zeros();
  for (const op of operations) {
    for (const [table,n] of Object.entries(op.inserts)) (op.rollback ? rolledBackInserts : committedInserts)[table] += n;
    for (const [table,n] of Object.entries(op.rejected ?? {})) rejectedInsertAttempts[table] += n;
    for (const [table,n] of Object.entries(op.updates ?? {})) committedUpdates[table] += n;
  }
  const hashFiles = async names => Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await readFile(path.join(ROOT,name)))])));
  const plan = {
    version: 1, hostname: target.hostname, port: target.port || '5432', database: decodeURIComponent(target.pathname.slice(1)),
    // Bind exact credentials/role/target without emitting the URL, username or password.
    exactTargetSha256: sha(databaseUrl), schema: SCHEMA, ssl, maximumConnections: race ? 2 : 1, race,
    databasePrivilegeBudget: 'schema CREATE/DROP only; no role creation, grant changes, extension installation or public-object changes',
    runtime: { node: process.versions.node, unicode: process.versions.unicode, icu: process.versions.icu },
    sourceSha256: await hashFiles(SOURCES), migrationSha256: await hashFiles(MIGRATIONS.map(name => `migrations/${name}`)),
    initialSchema: 'must not exist; refusal is not adoption', initialRows: zeros(), operations,
    committedInserts, rolledBackInserts, rejectedInsertAttempts, committedUpdates,
    rejectedUpdates: operations.reduce((n, op) => n + (op.rejectedUpdates ?? 0), 0),
    rejectedDeletes: operations.reduce((n, op) => n + (op.rejectedDeletes ?? 0), 0), committedDeletes: 0,
    // Deferred FK/AFTER trigger ordering can touch a parent before a rejected
    // link insert rolls back; record the finite upper bound, not a claimed count.
    rolledBackUpdateUpperBounds: { products: 4, explanation: 'at most one child-revision touch in each of the four rejected link INSERT transactions; all roll back' },
    sequences: [{ name: `${SCHEMA}.fixture_audit_id_seq`, committedAdvances: committedInserts.store_admin_audit, rolledBackAdvances: rolledBackInserts.store_admin_audit, rejectedAdvances: rejectedInsertAttempts.store_admin_audit, totalAdvances: committedInserts.store_admin_audit + rolledBackInserts.store_admin_audit + rejectedInsertAttempts.store_admin_audit }],
    ddl: { createSchemas: 1, baseDdlTransactions: 1, revisionMigrationApplications: 1, normalizationMigrationApplications: 1, rejectedNormalizationApplications: 3, colourMigrationApplications: 1, auditFailureTriggersCreatedThenRolledBack: 1 },
    parity: 'all Unicode scalar values except PostgreSQL-unrepresentable NUL; 4096 scalar values per SELECT (272 scalar batches plus one mixed-vector batch); plus mixed NFKC vectors',
    publicBusinessDataReads: 0, publicWrites: 0, publicSequenceAdvances: 0,
    connectionPolicy: 'schema-only search_path; no app pool, env loading, URL options, notifications or external effects; race exactly two transactions once, no retries',
    cleanup: `DROP SCHEMA ${SCHEMA} CASCADE only with this run's ownership marker and created flag`,
    pendingProof: ['all PostgreSQL assertions until separately approved and executed', 'authenticated application/session isolation (not established by transaction-service integration)', 'full production-schema/privilege equivalence; minimal local base contracts and fixture audit immutability trigger'],
  };
  return { ...plan, approvalSha256: sha(JSON.stringify(plan)) };
}

// Minimal contracts, never LIKE public tables or public FKs/defaults/sequences.
const BASE_DDL = `
create table store_admins(id text primary key,role text not null,is_active boolean not null default true);
create table device_brands(id text primary key,name text not null,is_active boolean not null default true,sort_order integer not null default 0,updated_at timestamptz default now());
create table device_models(id text primary key,brand_id text not null references device_brands(id),name text not null,is_active boolean not null default true,sort_order integer not null default 0,updated_at timestamptz default now());
create table products(id text primary key,name text not null,is_active boolean not null default false,product_type_id text,deleted_at timestamptz,updated_at timestamptz default now());
create table product_variants(id text primary key,product_id text not null references products(id),device_model_id text references device_models(id),sku text not null,combination_key text not null,option_value text not null,is_active boolean not null,is_purchasable boolean not null,retired_at timestamptz,unique(product_id,id));
create table product_device_models(product_id text references products(id),device_model_id text references device_models(id),archived_at timestamptz,primary key(product_id,device_model_id));
create table product_types(id text primary key);
create table attributes(id text primary key,key text,label text,data_type text,is_active boolean,deleted_at timestamptz);
create table product_type_attributes(product_type_id text references product_types(id),attribute_id text references attributes(id),is_active boolean,sort_order integer);
create table attribute_options(attribute_id text references attributes(id),value text,sort_order integer);
${['product_attribute_values','product_images','product_facets','product_specs'].map(table => `create table ${table}(product_id text references products(id));`).join('\n')}
create sequence fixture_audit_id_seq;
create table store_admin_audit(id bigint primary key default nextval('${SCHEMA}.fixture_audit_id_seq'::regclass),actor_id text references store_admins(id),actor_email text,action text,entity text,entity_id text,before jsonb,after jsonb,request_id text,route text,status text,reason text,ip_hash text,user_agent_hash text);
create function fixture_immutable_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture immutable audit' using errcode='23514'; end $$;
create trigger fixture_immutable_audit before update or delete on store_admin_audit for each row execute function fixture_immutable_audit();
${TABLES.filter(name => !['colours','product_variant_colours'].includes(name)).map(name => `alter table ${name} enable row level security;`).join('\n')}
`;

/** Evaluate the real service and its pure dependencies, blocking app-pool/Next imports. */
export async function loadSharedListServices() {
  const { default: ts } = await import('typescript');
  const crypto = await import('node:crypto');
  const cache = new Map();
  async function load(name, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(await readFile(path.join(ROOT,name),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module, exports: module.exports, Buffer, Request, Response, TextEncoder, TextDecoder, URL, Date, console,
        require(id) { if (id in dependencies) return dependencies[id]; throw new Error(`Unapproved fixture import: ${id}`); } }, { filename: name });
    cache.set(name, module.exports); return module.exports;
  }
  const noPool = { getSql() { throw new Error('Fixture forbids the application database pool'); } };
  const rules = await load('src/lib/catalog/shared-list-rules.ts', {});
  const catalog = await load('src/lib/store-admin/catalog-rules.ts', {});
  const metadataRules = await load('src/lib/catalog/product-metadata-rules.ts', { '@/lib/store-admin/catalog-rules': catalog });
  const audit = await load('src/lib/store-admin/audit.ts', { 'node:crypto': crypto, '@/lib/platform/db': noPool, '@/lib/platform/client-ip': { clientIpFromHeaders: () => '' } });
  const metadata = await load('src/lib/store-admin/product-metadata.ts', { 'node:crypto': crypto, '@/lib/platform/db': noPool, './audit': audit, './catalog-rules': catalog, '@/lib/catalog/shared-list-rules': rules, '@/lib/catalog/product-metadata-rules': metadataRules });
  const service = await load('src/lib/store-admin/shared-lists.ts', { 'node:crypto': crypto, 'next/headers': { cookies() { throw new Error('Authenticated app acceptance is separate'); } }, '@/lib/platform/db': noPool, '@/lib/catalog/shared-list-rules': rules, './product-metadata': metadata });
  return { service, rules };
}

export async function openSharedListFixture(env = process.env) {
  // Approval must precede even driver import. Dedicated variables cannot fall back
  // to DATABASE_URL or any previous fixture's approval.
  assert.equal(env.RUN_SHARED_LIST_DB_TESTS, '1', 'Separate explicit database write approval required');
  assert.ok(env.SHARED_LIST_RACE === undefined || ['0','1'].includes(env.SHARED_LIST_RACE), 'Race must be explicitly 0 or 1');
  const manifest = await sharedListManifest({ databaseUrl: env.SHARED_LIST_DATABASE_URL, race: env.SHARED_LIST_RACE === '1', ssl: env.SHARED_LIST_SSL ?? 'require' });
  assert.equal(env.SHARED_LIST_APPROVED_MANIFEST, manifest.approvalSha256, 'Approve the exact target/code/operation manifest first');
  const migrations = Object.fromEntries(await Promise.all(MIGRATIONS.map(async name => [name, await readFile(path.join(ROOT,'migrations',name),'utf8')])));
  const services = await loadSharedListServices();
  const { default: postgres } = await import('postgres');
  const sql = postgres(env.SHARED_LIST_DATABASE_URL, { max: manifest.maximumConnections, prepare: false, ssl: manifest.ssl === 'require' ? 'require' : undefined, onnotice() {}, connection: { search_path: SCHEMA, statement_timeout: 15000, lock_timeout: 5000, idle_in_transaction_session_timeout: 15000 } });
  let created = false;
  const marker = `shared-list-fixture:${randomUUID()}`;
  const done = new Set();
  const snapshot = async tx => {
    const result = zeros();
    for (const table of TABLES) {
      const [exists] = await tx`select to_regclass(${`${SCHEMA}.${table}`}) as name`;
      if (exists.name) result[table] = (await tx.unsafe(`select count(*)::int n from "${SCHEMA}"."${table}"`))[0].n;
    }
    return result;
  };
  const sequence = async () => {
    const [row] = await sql.unsafe(`select last_value::int n,is_called from "${SCHEMA}".fixture_audit_id_seq`);
    return row.is_called ? row.n : 0;
  };
  const fixture = { sql, manifest, ...services, migrations, snapshot,
    async operation(name, callback, rejection) {
      const op = manifest.operations.find(item => item.name === name);
      assert.ok(op && !done.has(name), `Undeclared or repeated operation: ${name}`);
      const before = await snapshot(sql), seqBefore = await sequence();
      if (op.concurrentTransactions) await callback();
      else if (op.rollback) {
        if (rejection) await assert.rejects(sql.begin(callback), rejection);
        else await assert.rejects(sql.begin(async tx => {
          await callback(tx);
          const inside = await snapshot(tx);
          for (const table of TABLES) assert.equal(inside[table] - before[table], op.inserts[table] ?? 0, `${name}: staged ${table}`);
          throw new Error('fixture intentional caller rollback');
        }), /fixture intentional caller rollback/);
      } else await sql.begin(async tx => {
        const result = await callback(tx);
        const inside = await snapshot(tx);
        for (const table of TABLES) assert.equal(inside[table] - before[table], op.inserts[table] ?? 0, `${name}: staged ${table}`);
        return result;
      });
      const after = await snapshot(sql);
      for (const table of TABLES) assert.equal(after[table] - before[table], op.rollback ? 0 : op.inserts[table] ?? 0, `${name}: committed ${table}`);
      assert.equal(await sequence() - seqBefore, (op.inserts.store_admin_audit ?? 0) + (op.rejected?.store_admin_audit ?? 0), `${name}: sequence effects`);
      done.add(name);
    },
    async assertCounts() {
      assert.equal(done.size, manifest.operations.length, 'Every declared operation must run once');
      assert.deepEqual(await snapshot(sql), manifest.committedInserts);
      assert.equal(await sequence(), manifest.sequences[0].totalAdvances);
    },
    async close() {
      try {
        if (created) {
          const [row] = await sql`select obj_description(oid,'pg_namespace') as marker from pg_namespace where nspname=${SCHEMA}`;
          assert.equal(row?.marker, marker, 'Refuse cleanup without this run ownership marker');
          await sql.unsafe(`drop schema "${SCHEMA}" cascade`); created = false;
        }
      } finally { await sql.end({ timeout: 5 }); }
    },
  };
  try {
    // Refuse automatic pg_temp lookup ahead of the pinned schema. A newly
    // constructed dedicated client must not inherit session temporary objects.
    const [temporary] = await sql`select pg_my_temp_schema() as oid`;
    assert.equal(Number(temporary.oid), 0, 'Refuse a session with an existing temporary schema');
    // Deliberately no IF NOT EXISTS: never adopt somebody else's schema.
    await sql.begin(async tx => { await tx.unsafe(`create schema "${SCHEMA}"`); await tx.unsafe(`comment on schema "${SCHEMA}" is '${marker}'`); }); created = true;
    const [pin] = await sql`select current_schema() as name,current_setting('search_path') as path,current_setting('server_encoding') as encoding`;
    assert.equal(pin.name, SCHEMA); assert.equal(pin.path, SCHEMA); assert.equal(pin.encoding, 'UTF8');
    await sql.begin(tx => tx.unsafe(BASE_DDL));
    assert.deepEqual(await snapshot(sql), manifest.initialRows);
    await sql.begin(tx => tx.unsafe(migrations['0057_catalog_edit_revision.sql']));
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}
