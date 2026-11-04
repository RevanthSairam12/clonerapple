import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCHEMA = 'itest_phase2_catalog_approved';
export const MIGRATIONS = ['0055_variant_identity_retirement.sql', '0056_product_content_revisions.sql', '0057_catalog_edit_revision.sql'];
export const TABLES = ['store_admins', 'categories', 'attributes', 'product_types', 'product_type_attributes', 'device_brands', 'device_models', 'products', 'product_variants', 'product_images', 'product_device_models', 'product_attribute_values', 'product_facets', 'product_specs', 'stock', 'order_items', 'store_admin_audit', 'price_history', 'product_content_revisions'];
const SOURCES = ['tests/helpers/phase2-catalog-fixture.mjs', 'tests/phase2-catalog-integration.test.mjs', 'src/lib/store-admin/product-content.ts', 'src/lib/store-admin/product-duplicate.ts', 'src/lib/store-admin/catalog-revision.ts', 'src/lib/store-admin/product-metadata.ts', 'src/lib/store-admin/audit.ts', 'src/lib/catalog/product-description.ts', 'src/lib/platform/db.ts'];
/** Pure preflight: no .env loading, SQL client construction or connection. */
export async function phase2CatalogManifest(databaseUrl = process.env.DATABASE_URL) {
  let target = null;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    target = { hostname: url.hostname, port: url.port || '5432', databaseSha256: createHash('sha256').update(url.pathname).digest('hex'), roleSha256: createHash('sha256').update(url.username).digest('hex') };
  }
  const hash = async name => createHash('sha256').update(await readFile(path.join(ROOT, name))).digest('hex');
  const plan = {
    version: 1, target, schemas: [SCHEMA], maximumConnections: 2,
    connectionPolicy: 'Two independent max:1 session clients; no app pool, env loading or public search_path fallback; no superuser/BYPASSRLS role',
    publicBusinessDataReads: 0, publicTableWrites: 0, publicSequenceAdvances: 0,
    migrationSha256: Object.fromEntries(await Promise.all(MIGRATIONS.map(async name => [name, await hash(`migrations/${name}`)]))),
    sourceSha256: Object.fromEntries(await Promise.all(SOURCES.map(async name => [name, await hash(name)]))),
    tables: TABLES,
    operations: [
      'create owned schema; local contracts with original variant label index, global SKU/combination uniqueness, local stock/order variant FKs and RLS',
      'seed owner/category/type/device/source/old commerce variant/stock/order; apply real 0055 transaction then rollback; verify original index restored',
      'apply actual 0055,0056,0057 bytes in individual transactions; assert migration did not rewrite seeded business rows',
      'retire old variant, insert same-label replacement, reject saved identity/SKU/combination reuse and wrong-owner stock FK',
      'editorial/child/reference catalog version increments; stock/in_stock/timestamps excluded; reject token rewind',
      'two independent concurrent stale-version writers: exactly one commit and one conflict',
      'two independent duplicate service callers: one source->same target, exactly one product/opening-price/audit, no stock/lineage',
      'content write, no-op, null-vs-empty, canonical-only before-snapshot restore, strict-audit rollback',
      'history UPDATE/DELETE rejected; FORCE RLS owner probe transaction reads zero rows, then rollback',
      'assert local FKs, no policies, all local tables RLS; drop only schema created by this invocation',
    ],
    writeBounds: { productsCommitted: 2, variantsCommitted: 2, contentRevisionsCommittedMaximum: 4, genericAuditCommittedMaximum: 5, priceHistoryCommittedMaximum: 1, fixtureStockRows: 1, fixtureOrderItems: 1, totalCommittedRowsMaximum: 40, sequenceAdvancesMaximumEach: 20 },
    sequencePolicy: 'Only disposable schema local bigserial/identity sequences; rejected/rolled-back statements can advance them; bounded live assertion, not production sequences',
    cleanup: `DROP SCHEMA ${SCHEMA} CASCADE only after CREATE SCHEMA succeeded; existing schema refused, never adopted`,
    externalEffects: 'none: injected transaction helpers only; no cache, public storefront, SMTP, notifications, PayU, auth session or app startup',
    excluded: ['not all historical migrations or production row distributions', 'no app/HTTP/browser test', 'no pooler deployment, role-grant or query-plan proof', 'no full aggregate draft/CSV transaction integration; own services tested by main'],
  };
  return { ...plan, approvalSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}
const BASE_DDL = `
create table store_admins(id text primary key);
create table categories(id text primary key);
create table attributes(id text primary key);
create table product_types(id text primary key,category_id text references categories(id),name text,is_active boolean default true);
create table product_type_attributes(product_type_id text references product_types(id),attribute_id text references attributes(id),is_required boolean default false,primary key(product_type_id,attribute_id));
create table device_brands(id text primary key,name text,is_active boolean default true);
create table device_models(id text primary key,brand_id text references device_brands(id),name text,is_active boolean default true);
create table products(id text primary key,slug text not null unique,name text not null,category_id text references categories(id),product_type_id text references product_types(id),subtitle text default '',price_paise integer default 10000,compare_at_paise integer,sale_price_paise integer,currency text default 'INR',material text default '',brand text default '',brand_id text,condition_id text,description text default '',short_description text,description_sections jsonb,badge text,highlights jsonb default '[]',in_the_box jsonb default '[]',seo_title text default '',seo_description text default '',in_stock boolean default true,is_active boolean default false,updated_by text references store_admins(id),updated_at timestamptz default now(),created_at timestamptz default now(),deleted_at timestamptz,compatibility_reviewed_at timestamptz);
create table product_variants(id text primary key,product_id text not null references products(id) on delete cascade,sku text unique,option_name text not null default 'Colour',option_value text not null,option_hex text,price_paise_override integer check(price_paise_override is null or price_paise_override>=0),is_active boolean not null default true,sort_order integer not null default 0,is_purchasable boolean not null default false,device_model_id text references device_models(id),combination_key text,updated_at timestamptz default now(),constraint variant_commerce_identity check(not is_purchasable or (sku is not null and btrim(sku)<>'' and combination_key is not null and btrim(combination_key)<>'')));
create unique index idx_product_variants_option on product_variants(product_id,option_name,option_value);
create unique index idx_variants_product_identity on product_variants(product_id,id);
create unique index idx_variants_commerce_combination on product_variants(product_id,combination_key) where is_purchasable;
create table product_images(id text primary key,product_id text references products(id),url text,updated_at timestamptz default now());
create table product_device_models(product_id text references products(id),device_model_id text references device_models(id),sort_order integer default 0,archived_at timestamptz,primary key(product_id,device_model_id));
create table product_attribute_values(product_id text references products(id),attribute_id text references attributes(id),value_text text,value_number numeric,value_bool boolean,option_value text,archived_at timestamptz,primary key(product_id,attribute_id));
create table product_facets(id text primary key,product_id text references products(id),value text);
create table product_specs(id text primary key,product_id text references products(id),label text,value text);
create table stock(id text primary key,product_id text not null references products(id),variant_id text,on_hand integer,reserved integer default 0,constraint stock_variant_owner foreign key(product_id,variant_id) references product_variants(product_id,id));
create table order_items(id text primary key,product_id text not null references products(id),variant_id text,constraint order_item_variant_owner foreign key(product_id,variant_id) references product_variants(product_id,id));
create table store_admin_audit(id bigserial primary key,actor_id text references store_admins(id),actor_email text,action text,entity text,entity_id text,before jsonb,after jsonb,request_id text,route text,status text,reason text,ip_hash text,user_agent_hash text);
create table price_history(id bigserial primary key,product_id text references products(id),variant_id text references product_variants(id),old_price_paise integer,new_price_paise integer,currency text,reason text,source text,changed_by text references store_admins(id));
create function fixture_immutable() returns trigger language plpgsql as $$ begin raise exception 'fixture history immutable'; end $$;
create trigger fixture_audit_immutable before update or delete on store_admin_audit for each row execute function fixture_immutable();
create trigger fixture_price_immutable before update or delete on price_history for each row execute function fixture_immutable();
${TABLES.filter(table => table !== 'product_content_revisions').map(table => `alter table ${table} enable row level security;`).join('\n')}
`;
export async function openPhase2CatalogFixture() {
  assert.equal(process.env.RUN_PHASE2_CATALOG_DB_TESTS, '1', 'Explicit fixture write approval required');
  const manifest = await phase2CatalogManifest();
  assert.ok(manifest.target, 'Supply DATABASE_URL explicitly; no env files loaded');
  assert.equal(process.env.PHASE2_CATALOG_APPROVED_MANIFEST, manifest.approvalSha256, 'Approve the exact catalog fixture manifest before execution');
  const target = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.notEqual(target.port, '6543', 'Session connections required for independent races');
  const { default: postgres } = await import('postgres');
  const options = { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {}, connection: { search_path: SCHEMA, statement_timeout: 20000, lock_timeout: 10000 } };
  const sql = postgres(process.env.DATABASE_URL, options), peer = postgres(process.env.DATABASE_URL, options);
  let created = false;
  const fixture = { sql, peer, manifest,
    async close() {
      // Close race peer first so cleanup cannot wait on its locks.
      try { await peer.end({ timeout: 5 }); }
      finally { try { if (created) await sql.unsafe(`drop schema "${SCHEMA}" cascade`); } finally { await sql.end({ timeout: 5 }); } }
    },
  };
  try {
    const [role] = await sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
    assert.ok(!role.rolsuper && !role.rolbypassrls, 'Fixture requires a non-superuser, non-BYPASSRLS role for effective owner FORCE RLS test');
    await sql.unsafe(`create schema "${SCHEMA}"`); created = true;
    for (const client of [sql, peer]) {
      const [pin] = await client`select current_schema() as schema,current_setting('search_path') as path,pg_backend_pid() as pid`;
      assert.equal(pin.schema, SCHEMA); assert.equal(pin.path, SCHEMA);
    }
    const [a] = await sql`select pg_backend_pid() as pid`, [b] = await peer`select pg_backend_pid() as pid`;
    assert.notEqual(a.pid, b.pid, 'Races must use independent PostgreSQL backend connections');
    await sql.begin(tx => tx.unsafe(BASE_DDL));
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}
// Printing a manifest is a read-only local operation. This branch never opens SQL.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--manifest')) {
  try { console.log(JSON.stringify(await phase2CatalogManifest(), null, 2)); }
  catch { console.error('Manifest generation failed; configuration details withheld. No connection made.'); process.exitCode = 1; }
}
