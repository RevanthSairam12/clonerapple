#!/usr/bin/env node
/**
 * Dedicated Phase 3 historical backfill. Default: a READ ONLY snapshot, no DDL,
 * temp tables, import jobs, or writes. Schema 0051 is always applied separately.
 *
 * node scripts/migrate-product-compatibility.mjs [--dry-run]
 *
 * APPLY IS NOT AUTHORISED by a dry-run. After a human approves the actual host
 * and fresh (post-0051) counts/digest, a store owner may explicitly invoke:
 * node scripts/migrate-product-compatibility.mjs --apply \
 *   --approved-host HOST[:PORT] --approved-digest SHA256 --staff-actor STAFF_ID
 * No implicit approval from env vars; no --force or automatic schema install.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { planProductMetadataBackfill, assertBackfillApproval, safeBackfillId } = await jiti.import(path.join(root, 'src/lib/catalog/product-metadata-backfill.ts'));

const NEW_TABLES = ['product_types', 'product_type_attributes', 'device_brands', 'device_models', 'product_device_models', 'product_attribute_history'];
const REQUIRED_COLUMNS = {
  product_types: ['id', 'category_id', 'name', 'requires_compatibility', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  product_type_attributes: ['product_type_id', 'attribute_id', 'is_required', 'sort_order', 'show_in_specs', 'show_in_filters', 'show_in_search', 'is_active', 'updated_at'],
  device_brands: ['id', 'name', 'sort_order', 'is_active', 'updated_at'],
  device_models: ['id', 'brand_id', 'name', 'sort_order', 'is_active', 'updated_at'],
  product_device_models: ['product_id', 'device_model_id', 'sort_order', 'archived_at', 'created_at', 'updated_at'],
  product_attribute_history: ['id', 'product_id', 'attribute_id', 'value_text', 'value_number', 'value_bool', 'option_value', 'archived_at', 'changed_at'],
  products: ['product_type_id', 'compatibility_reviewed_at'],
  product_attribute_values: ['archived_at', 'updated_at'],
};
const INSERT_COLUMNS = {
  product_types: ['id', 'category_id', 'name', 'requires_compatibility', 'sort_order', 'is_active'],
  product_type_attributes: ['product_type_id', 'attribute_id', 'is_required', 'sort_order', 'show_in_specs', 'show_in_filters', 'show_in_search', 'is_active'],
  device_brands: ['id', 'name', 'sort_order', 'is_active'],
  device_models: ['id', 'brand_id', 'name', 'sort_order', 'is_active'],
  product_device_models: ['product_id', 'device_model_id', 'sort_order'],
};

function parseArgs(args) {
  const result = { apply: false, approvedHost: '', approvedDigest: '', staffActor: '' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error('arguments');
    seen.add(arg);
    if (arg === '--apply') result.apply = true;
    else if (arg === '--dry-run') { /* default */ }
    else {
      const key = { '--approved-host': 'approvedHost', '--approved-digest': 'approvedDigest', '--staff-actor': 'staffActor' }[arg];
      if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
      result[key] = args[++i];
    }
  }
  if (seen.has('--apply') && seen.has('--dry-run')) throw new Error('arguments');
  if (!result.apply && (result.approvedHost || result.approvedDigest || result.staffActor)) throw new Error('arguments');
  if (result.apply && (!result.approvedHost || !/^[a-f0-9]{64}$/.test(result.approvedDigest) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(result.staffActor))) throw new Error('arguments');
  return result;
}

async function snapshotUsing(tx) {
  // Detect schema without ever referring to a missing column in SQL. This also
  // supports partial installs for planning, but apply refuses them wholesale.
  const columns = await tx`select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ${tx(Object.keys(REQUIRED_COLUMNS))}`;
  const has = (table, column) => columns.some(row => row.table_name === table && row.column_name === column);
  const missing = [];
  for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) for (const name of names) if (!has(table, name)) missing.push(`${table}.${name}`);
  const security = await tx`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ${tx(NEW_TABLES)}`;
  const rlsDisabled = security.filter(row => !row.relrowsecurity).map(row => row.relname);
  const [constraint] = await tx`select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname='products' and c.conname='products_type_category_fk' and c.convalidated`;
  if (!constraint) missing.push('products.products_type_category_fk');
  const [trigger] = await tx`select 1 from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname='product_attribute_values' and g.tgname='retain_product_attribute_value' and g.tgenabled in ('O','A')`;
  if (!trigger) missing.push('product_attribute_values.retain_product_attribute_value');
  const readNew = async table => {
    if (!has(table, REQUIRED_COLUMNS[table][0])) return [];
    // All identifiers come exclusively from the constants above.
    return [...await tx`select * from ${tx(table)}`];
  };
  const categories = [...await tx`select id,slug,is_active,deleted_at from categories`];
  const products = [...await tx`select id,category_id,deleted_at,updated_at,
    ${has('products', 'product_type_id') ? tx('product_type_id') : tx`null::text as product_type_id`},
    ${has('products', 'compatibility_reviewed_at') ? tx('compatibility_reviewed_at') : tx`null::timestamptz as compatibility_reviewed_at`}
    from products`];
  const attributes = [...await tx`select id,key,data_type,is_active,deleted_at from attributes`];
  const facetDefs = [...await tx`select category_id,facet_key,sort_order from facet_defs`];
  const facets = [...await tx`select product_id,facet_key,facet_value,sort_order from product_facets where facet_key='model'`];
  const values = [...await tx`select product_id,attribute_id,value_text,value_number,value_bool,option_value,
    ${has('product_attribute_values', 'archived_at') ? tx('archived_at') : tx`null::timestamptz as archived_at`}
    from product_attribute_values`];
  return { schema: { missing, rlsDisabled }, categories, products, attributes, facetDefs, facets, values,
    types: await readNew('product_types'), typeAttributes: await readNew('product_type_attributes'),
    brands: await readNew('device_brands'), models: await readNew('device_models'), joins: await readNew('product_device_models') };
}

function report(plan, host, mode) {
  // No raw DB names, facet/PAV values, actor identity, connection strings, or
  // error objects. Reference names below are only the hardcoded allowlist.
  return {
    mode, host, digest: plan.digest, schema: plan.schema, counts: plan.counts,
    proposedReferences: {
      types: plan.inserts.product_types.map(row => ({ id: row.id, categoryId: safeBackfillId(row.category_id), name: row.name, requiresCompatibility: row.requires_compatibility })),
      typeAttributes: plan.inserts.product_type_attributes.map(row => ({ typeId: row.product_type_id, attributeId: safeBackfillId(row.attribute_id), required: false })),
      brands: plan.inserts.device_brands.map(row => ({ id: row.id, name: row.name })),
      models: plan.inserts.device_models.map(row => ({ id: row.id, name: row.name })),
    },
    productChanges: plan.updates,
    compatibilityJoins: plan.inserts.product_device_models,
    conflicts: plan.conflicts, needsReview: plan.review,
    unrelatedPavPreserved: plan.unrelatedValues,
    applyPermitted: mode === 'applied',
    note: 'Dry-run never authorises apply. Obtain explicit host + counts + digest approval after independent schema 0051 installation. Existing values and joins are never rewritten. Exact supplied mapping has 7 distinct models and 7 joins.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) {
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
    }
  } catch { /* real environment is also supported */ }
  if (!process.env.DATABASE_URL) throw new Error('configuration');
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('configuration');
  if (args.apply && args.approvedHost !== url.host) throw new Error('approval');
  const identity = JSON.stringify({ host: url.host, database: url.pathname, role: url.username });
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    connection: { default_transaction_read_only: args.apply ? 'off' : 'on', search_path: 'public', statement_timeout: 30000, lock_timeout: 5000 },
    onnotice: () => {},
  });
  try {
    if (!args.apply) {
      const plan = await sql.begin('isolation level repeatable read read only', async tx => {
        const [state] = await tx`show transaction_read_only`;
        if (state.transaction_read_only !== 'on') throw new Error('readonly');
        return planProductMetadataBackfill(await snapshotUsing(tx), identity);
      });
      console.log(JSON.stringify(report(plan, url.host, 'dry-run'), null, 2));
      return;
    }
    // This code path is deliberately never entered by default or tests. It
    // requires explicit command-line approval, a matching target, and an active
    // store_owner (not the legacy CMS identity store).
    // READ COMMITTED is intentional: after waiting for the gate/table locks,
    // the digest must see the latest committed state, not a pre-lock snapshot.
    // The table locks then hold that state stable through the audited commit.
    const plan = await sql.begin('isolation level read committed read write', async tx => {
      await tx`select pg_advisory_xact_lock(513031,3)`;
      // Table locks cover non-service writers too; the recheck and mutations
      // cannot race reference edits, new products, legacy facets or PAV changes.
      await tx`lock table categories,products,attributes,facet_defs,product_facets,product_attribute_values,product_types,product_type_attributes,device_brands,device_models,product_device_models in share row exclusive mode`;
      const [actor] = await tx`select id from store_admins where id=${args.staffActor} and is_active and role='store_owner' for share`;
      if (!actor) throw new Error('actor');
      const fresh = planProductMetadataBackfill(await snapshotUsing(tx), identity);
      assertBackfillApproval(fresh, args.approvedDigest);
      if (fresh.inserts.device_brands.length || fresh.inserts.device_models.length) throw new Error('Owner-entered device references only.');
      const changed = Object.values(fresh.inserts).some(rows => rows.length) || fresh.updates.length > 0;
      if (!changed) return fresh;
      for (const table of Object.keys(INSERT_COLUMNS)) for (const row of fresh.inserts[table]) {
        // Never ON CONFLICT UPDATE/DO NOTHING: a collision must roll back.
        await tx`insert into ${tx(table)} ${tx(row, INSERT_COLUMNS[table])}`;
      }
      for (const row of fresh.updates) {
        const updated = await tx`update products set
          product_type_id=coalesce(${row.product_type_id ?? null},product_type_id),
          compatibility_reviewed_at=case when ${row.review_compatibility} then now() else compatibility_reviewed_at end,
          updated_at=now(),updated_by=${args.staffActor}
          where id=${row.product_id} returning id`;
        if (updated.length !== 1) throw new Error('drift');
      }
      const { writeAudit } = await jiti.import(path.join(root, 'src/lib/store-admin/audit.ts'));
      if (!await writeAudit({ actorId: args.staffActor, action: 'catalog.metadata.historical-backfill', entity: 'catalog', entityId: fresh.digest,
        after: { digest: fresh.digest, counts: fresh.counts }, route: 'script:migrate-product-compatibility' }, tx)) throw new Error('audit');
      return fresh;
    });
    console.log(JSON.stringify(report(plan, url.host, 'applied'), null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Catch without inspecting or printing the error: driver messages can contain
// connection strings, raw SQL values, identifiers supplied by staff, or PII.
try { await main(); }
catch {
  console.error('Historical metadata operation refused or failed. No partial changes committed. Check configuration, schema, conflicts, actor and approval; obtain a fresh dry-run before retrying.');
  process.exitCode = 1;
}
