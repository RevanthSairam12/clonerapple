#!/usr/bin/env node
/** Read-only by default. Never loads .env files or installs schema.
 * --manifest prints a target/code-bound approval manifest WITHOUT connecting.
 * Dry-run: DATABASE_URL=... node scripts/reconcile-shared-colours.mjs --schema public
 * Apply requires ALL explicit flags: --apply --schema SCHEMA --approved-schema SCHEMA
 * --approved-host HOST:PORT --approved-digest SHA256 --approved-manifest SHA256 --staff-actor ID.
 * A manifest/dry-run is not authorization: obtain human approval of the exact target
 * and proposed counts first. Never use this command to create a fixture or colours.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { planColourReconciliation, assertColourApproval } = await jiti.import(path.join(root, 'src/lib/catalog/colour-reconciliation.ts'));
export const REQUIRED_COLUMNS = {
  colours: ['id', 'name', 'hex', 'is_active', 'sort_order', 'created_at', 'updated_at'],
  product_variant_colours: ['product_id', 'variant_id', 'colour_id', 'created_at'],
  product_variants: ['id', 'product_id', 'option_name', 'option_value', 'option_hex', 'is_active', 'retired_at'],
  products: ['id', 'deleted_at', 'catalog_revision'],
  device_brands: ['id', 'name', 'is_active'], device_models: ['id', 'name', 'brand_id', 'is_active'],
};
const RLS_TABLES = ['colours', 'product_variant_colours'];
const INDEXES = ['device_brands_shared_name_unique', 'device_models_shared_name_unique', 'colours_shared_name_unique', 'colours_hex_unique'];
const TRIGGERS = [['product_variant_colours', 'protect_variant_colour_reference'], ['product_variant_colours', 'catalog_revision_variant_colours'], ['colours', 'catalog_revision_shared_colour']];
const sha = value => createHash('sha256').update(value).digest('hex');
export function parseColourArgs(argv) {
  const args = { apply: false, manifest: false, schema: 'public', approvedSchema: '', approvedHost: '', approvedDigest: '', approvedManifest: '', staffActor: '' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('arguments'); seen.add(flag);
    if (flag === '--apply') args.apply = true;
    else if (flag === '--manifest') args.manifest = true;
    else if (flag === '--dry-run') { /* default */ }
    else {
      const field = { '--schema': 'schema', '--approved-schema': 'approvedSchema', '--approved-host': 'approvedHost', '--approved-digest': 'approvedDigest', '--approved-manifest': 'approvedManifest', '--staff-actor': 'staffActor' }[flag];
      if (!field || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('arguments');
      args[field] = argv[++i];
    }
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(args.schema) || args.schema.startsWith('pg_') || args.schema === 'information_schema') throw new Error('schema');
  if (args.apply && (args.manifest || seen.has('--dry-run') || !seen.has('--schema') || args.approvedSchema !== args.schema || !args.approvedHost || !/^[a-f0-9]{64}$/.test(args.approvedDigest) || !/^[a-f0-9]{64}$/.test(args.approvedManifest) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(args.staffActor))) throw new Error('approval');
  if (!args.apply && [args.approvedSchema, args.approvedHost, args.approvedDigest, args.approvedManifest, args.staffActor].some(Boolean)) throw new Error('arguments');
  return args;
}
export function assertCatalogueTarget(url) {
  // postgres.js URL query settings override connection options. Allow TLS hints
  // only, so search_path/read-only/timeout overrides cannot bypass these gates.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[A-Za-z0-9.:[\]-]+$/.test(url.hostname)
      || !url.username || url.pathname.length <= 1 || [...url.searchParams.keys()].some(key => !['sslmode', 'sslrootcert'].includes(key))) throw new Error('configuration');
}
export async function colourManifest(url, schema) {
  const files = ['scripts/reconcile-shared-colours.mjs', 'src/lib/catalog/colour-reconciliation.ts', 'src/lib/catalog/shared-list-rules.ts', 'src/lib/store-admin/product-metadata.ts', 'src/lib/store-admin/audit.ts', 'migrations/0058_shared_catalogue_normalization.sql', 'migrations/0059_shared_colours.sql'];
  const sourceSha256 = {};
  for (const file of files) sourceSha256[file] = sha(await readFile(path.join(root, file)));
  const content = { version: 1, host: url.host, schema, targetSha256: sha(JSON.stringify({ host: url.host, database: url.pathname, role: url.username, schema })), sourceSha256,
    maximumConnections: 1, writes: ['append product_variant_colours only for approved unambiguous matches', 'database revision trigger on affected parent products', 'one strict count-only store_admin_audit when links are inserted'],
    forbidden: ['create colours/brands/models', 'replace/delete links', 'rewrite variants/SKU/prices/stock/orders', 'DDL/fixtures/seeds'], noOpWrites: 0 };
  return { ...content, approvalSha256: sha(JSON.stringify(content)) };
}
export async function catalogueSchemaUsing(tx, schema) {
  const columns = await tx`select table_name,column_name from information_schema.columns where table_schema=${schema} and table_name in ${tx(Object.keys(REQUIRED_COLUMNS))}`;
  const has = (table, column) => columns.some(row => row.table_name === table && row.column_name === column);
  const complete = table => REQUIRED_COLUMNS[table].every(column => has(table, column));
  const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([table, names]) => names.filter(name => !has(table, name)).map(name => `${table}.${name}`));
  const security = await tx`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${schema} and c.relname in ${tx(RLS_TABLES)}`;
  const rlsDisabled = security.filter(row => !row.relrowsecurity).map(row => row.relname);
  const indexes = await tx`select c.relname from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=${schema} and c.relname in ${tx(INDEXES)} and i.indisvalid and i.indisunique`;
  for (const name of INDEXES) if (!indexes.some(row => row.relname === name)) missing.push(`index.${name}`);
  const triggers = await tx`select t.relname,g.tgname from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname=${schema} and g.tgenabled in ('O','A') and not g.tgisinternal`;
  for (const [table, trigger] of TRIGGERS) if (!triggers.some(row => row.relname === table && row.tgname === trigger)) missing.push(`${table}.${trigger}`);
  const constraints = await tx`select c.contype,c.conrelid::regclass::text as relation, pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname=${schema} and t.relname='product_variant_colours' and c.convalidated`;
  for (const definition of [/PRIMARY KEY \(variant_id\)/, /FOREIGN KEY \(product_id, variant_id\) REFERENCES .*product_variants\(product_id, id\)/, /FOREIGN KEY \(colour_id\) REFERENCES .*colours\(id\)/]) if (!constraints.some(row => definition.test(row.definition))) missing.push('product_variant_colours.ownership-or-key-constraint');
  return { schema: { missing: [...new Set(missing)].sort(), rlsDisabled: rlsDisabled.sort() }, has, complete };
}
export async function colourSnapshotUsing(tx, schema) {
  const state = await catalogueSchemaUsing(tx, schema);
  // Table names and columns are constants; absent pre-migration tables are never queried.
  const read = async table => state.complete(table) ? [...await tx`select * from ${tx(`${schema}.${table}`)} order by id`] : [];
  const colours = await read('colours'), products = await read('products'), variants = await read('product_variants');
  const links = state.complete('product_variant_colours') ? [...await tx`select * from ${tx(`${schema}.product_variant_colours`)} order by product_id,variant_id`] : [];
  return { schema: state.schema, colours, products, variants, links };
}
export async function applyColourPlanUsing(tx, args, targetIdentity, dependencies) {
  await dependencies.metadataGate(tx);
  const [actor] = await tx`select id from store_admins where id=${args.staffActor} and is_active and role='store_owner' for share`;
  if (!actor) throw new Error('actor');
  const initial = await colourSnapshotUsing(tx, args.schema);
  if (initial.schema.missing.length || initial.schema.rlsDisabled.length) throw new Error('schema');
  // Fence -> sorted parents -> variant children -> links. No product/variant UPDATE.
  const ids = initial.products.map(row => row.id).sort();
  if (ids.length) {
    await tx`select id from products where id in ${tx(ids)} order by id for update`;
    await tx`select id from product_variants where product_id in ${tx(ids)} order by product_id,id for update`;
    await tx`select variant_id from product_variant_colours where product_id in ${tx(ids)} order by product_id,variant_id for update`;
  }
  await tx`select id from colours order by id for share`;
  const fresh = planColourReconciliation(await colourSnapshotUsing(tx, args.schema), targetIdentity);
  assertColourApproval(fresh, args.approvedDigest);
  if (!fresh.inserts.length) return fresh; // No audit, timestamps, or revision writes on identical retry.
  let inserted = 0;
  for (const link of fresh.inserts) {
    const rows = await tx`insert into product_variant_colours(product_id,variant_id,colour_id) values(${link.product_id},${link.variant_id},${link.colour_id}) returning variant_id`;
    if (rows.length !== 1) throw new Error('insert-count'); inserted++;
  }
  if (inserted !== fresh.counts.insertLinks) throw new Error('insert-count');
  await dependencies.strictMetadataAudit(tx, { actorId: args.staffActor, action: 'catalog.shared.colours.reconcile', entity: 'catalog',
    after: { insertedLinks: inserted, affectedProducts: fresh.counts.affectedProducts, existingLinks: fresh.counts.existingLinks, review: fresh.counts.review }, route: 'script:reconcile-shared-colours' });
  return fresh;
}
export async function main(argv = process.argv.slice(2)) {
  const args = parseColourArgs(argv);
  if (!process.env.DATABASE_URL) throw new Error('configuration');
  const url = new URL(process.env.DATABASE_URL);
  assertCatalogueTarget(url);
  const manifest = await colourManifest(url, args.schema);
  if (args.manifest) { console.log(JSON.stringify(manifest, null, 2)); return; }
  // This gate precedes construction of ANY write-capable client. No env approvals.
  if (args.apply && (args.approvedHost !== url.host || args.approvedManifest !== manifest.approvalSha256)) throw new Error('approval');
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {},
    connection: { search_path: args.schema, default_transaction_read_only: args.apply ? 'off' : 'on', statement_timeout: 30000, lock_timeout: 5000 } });
  try {
    const dependencies = args.apply ? await jiti.import(path.join(root, 'src/lib/store-admin/product-metadata.ts')) : null;
    const plan = await sql.begin(args.apply ? 'isolation level read committed read write' : 'isolation level repeatable read read only', async tx => {
      const [pin] = await tx`select current_schema() as schema,current_database() as database,current_user as role`;
      if (pin.schema !== args.schema) throw new Error('schema');
      const identity = JSON.stringify({ host: url.host, ...pin, manifest: manifest.approvalSha256 });
      if (args.apply) return applyColourPlanUsing(tx, args, identity, dependencies);
      const [state] = await tx`show transaction_read_only`;
      if (state.transaction_read_only !== 'on') throw new Error('readonly');
      return planColourReconciliation(await colourSnapshotUsing(tx, args.schema), identity);
    });
    console.log(JSON.stringify({ mode: args.apply ? 'applied' : 'dry-run', host: url.host, schema: args.schema, manifest: manifest.approvalSha256, ...plan, note: 'Only proposed links may be appended. Review rows remain unchanged. Dry-run is not approval.' }, null, 2));
  } finally { await sql.end({ timeout: 5 }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); }
  catch { console.error('Colour reconciliation refused or failed; no partial changes committed. Check target approval, schema, owner and fresh dry-run. Details withheld.'); process.exitCode = 1; }
}
