/** Read-only, aggregate preflight. Deliberately no apply mode or migration runner. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedColumns = {
  products: ['id', 'slug', 'product_type_id', 'compatibility_reviewed_at', 'short_description', 'description_sections', 'inventory_mode', 'catalog_revision'],
  product_images: ['product_id', 'role', 'is_active', 'deleted_at'],
  product_variants: ['id', 'product_id', 'sku', 'option_name', 'option_value', 'is_active', 'is_purchasable', 'device_model_id', 'combination_key', 'option_identity', 'retired_at'],
  product_device_models: ['product_id', 'device_model_id', 'archived_at'],
  product_attribute_values: ['product_id', 'attribute_id', 'archived_at'],
  stock: ['product_id', 'variant_id', 'on_hand', 'reserved'],
};
const expectedUniqueIndexes = [
  'products_slug_key', 'product_variants_sku_key',
  'idx_product_images_one_primary', 'idx_product_images_one_hover',
  'idx_variants_commerce_combination', 'idx_variants_live_option', 'idx_variants_semantic_identity',
];
let sql;
try {
  if (process.argv.length > 2) throw new Error('No command-line modes are supported.');
  const env = {};
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const connection = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!connection) throw new Error('configuration');
  sql = postgres(connection, {
    max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5,
    ssl: (process.env.DATABASE_SSL || env.DATABASE_SSL) === 'false' ? undefined : 'require',
    onnotice: () => {},
    connection: { default_transaction_read_only: 'on', search_path: 'public', statement_timeout: 20000, lock_timeout: 3000 },
  });
  const report = await sql.begin('isolation level repeatable read read only', async tx => {
    const [state] = await tx`show transaction_read_only`;
    if (state.transaction_read_only !== 'on') throw new Error('readonly');
    const columns = await tx`select table_name,column_name,data_type,column_default,is_nullable
      from information_schema.columns where table_schema='public'
      and table_name in ('products','product_images','product_variants','product_device_models','product_attribute_values','stock')`;
    const has = (table, names) => names.every(name => columns.some(c => c.table_name === table && c.column_name === name));
    const columnStatus = Object.fromEntries(Object.entries(expectedColumns).map(([table, names]) => [table, {
      expected: names.length,
      present: names.filter(name => has(table, [name])).length,
      missing: names.filter(name => !has(table, [name])),
    }]));
    const indexes = await tx`select c.relname as name,i.indisunique,i.indisvalid,i.indisready
      from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'products_slug_key','idx_product_variants_option','product_variants_sku_key',
        'idx_product_images_one_primary','idx_product_images_one_hover','idx_variants_commerce_combination',
        'idx_variants_live_option','idx_variants_semantic_identity')`;
    const indexStatus = expectedUniqueIndexes.map(name => {
      const index = indexes.find(i => i.name === name);
      return { name, present: Boolean(index), usableUnique: Boolean(index?.indisunique && index?.indisvalid && index?.indisready) };
    });
    // Only aggregate counts leave the transaction. No product/customer IDs, copy,
    // host, connection string, raw SQL errors or catalog row samples are printed.
    const conflicts = {};
    if (has('product_variants', ['product_id','option_name','option_value','retired_at'])) {
      const [r] = await tx`select count(*)::int as groups from (select product_id,option_name,option_value from product_variants where retired_at is null group by product_id,option_name,option_value having count(*)>1) d`;
      conflicts.liveOptionLabels = r.groups;
    } else if (has('product_variants', ['product_id','option_name','option_value'])) {
      // The migration starts every existing row unretired; this is its exact
      // live-label conflict set before retired_at has been added.
      const [r] = await tx`select count(*)::int as groups from (select product_id,option_name,option_value from product_variants group by product_id,option_name,option_value having count(*)>1) d`;
      conflicts.liveOptionLabelsBeforeRetirementColumn = r.groups;
    }
    if (has('product_variants', ['product_id','device_model_id','option_name','option_identity','retired_at','is_purchasable'])) {
      const [r] = await tx`select count(*)::int as groups from (
        select product_id,coalesce(device_model_id,''),lower(btrim(regexp_replace(option_name,'\\s+',' ','g'))),option_identity
        from product_variants where retired_at is null and is_purchasable and option_identity is not null
        group by product_id,coalesce(device_model_id,''),lower(btrim(regexp_replace(option_name,'\\s+',' ','g'))),option_identity having count(*)>1
      ) d`;
      conflicts.semanticIdentities = r.groups;
    }
    if (has('products', ['slug'])) {
      const [r] = await tx`select count(*)::int as groups from (select slug from products group by slug having count(*)>1) d`;
      conflicts.productSlugs = r.groups;
    }
    if (has('product_variants', ['product_id','option_name','option_value'])) {
      const [r] = await tx`select count(*)::int as groups from (select product_id,option_name,option_value from product_variants group by product_id,option_name,option_value having count(*)>1) d`;
      conflicts.optionLabels = r.groups;
    }
    if (has('product_variants', ['sku'])) {
      const [r] = await tx`select count(*)::int as groups from (select sku from product_variants where sku is not null group by sku having count(*)>1) d`;
      conflicts.optionSkus = r.groups;
    }
    if (has('product_variants', ['product_id','combination_key','is_active','is_purchasable','sku'])) {
      const [r] = await tx`select count(*)::int as groups from (select product_id,combination_key from product_variants where is_purchasable group by product_id,combination_key having count(*)>1) d`;
      conflicts.commerceCombinations = r.groups;
      const [missing] = await tx`select count(*)::int as total from product_variants where is_active and is_purchasable and (sku is null or btrim(sku)='' or combination_key is null or btrim(combination_key)='')`;
      conflicts.activeOptionsMissingIdentity = missing.total;
    }
    if (has('product_images', expectedColumns.product_images)) {
      const [r] = await tx`select count(*)::int as groups from (select product_id,role from product_images where is_active and deleted_at is null and role in ('primary','hover') group by product_id,role having count(*)>1) d`;
      conflicts.liveImageRoles = r.groups;
    }
    const revision = columns.find(c => c.table_name === 'products' && c.column_name === 'catalog_revision');
    return {
      mode: 'read-only', proposedWrites: 0, columns: columnStatus, indexes: indexStatus, conflicts,
      legacyOptionIndexPresent: indexes.some(index => index.name === 'idx_product_variants_option'),
      revisionColumn: { present: Boolean(revision), integer: revision?.data_type === 'integer', notNull: revision?.is_nullable === 'NO', defaultZero: /^0(?:::integer)?$/.test(revision?.column_default ?? '') },
      variantColumnTypes: {
        optionIdentityText: columns.some(c => c.table_name === 'product_variants' && c.column_name === 'option_identity' && c.data_type === 'text'),
        retiredAtTimestamptz: columns.some(c => c.table_name === 'product_variants' && c.column_name === 'retired_at' && c.data_type === 'timestamp with time zone'),
      },
      note: 'Missing prerequisites omit the corresponding conflict count; zero is not inferred. No repairs or allocations are proposed.',
    };
  });
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('Read-only product preflight refused or failed; no writes attempted. Configuration and error details withheld.');
  process.exitCode = 1;
} finally {
  if (sql) {
    try { await sql.end({ timeout: 5 }); }
    catch {
      console.error('Read-only product preflight cleanup failed; details withheld.');
      process.exitCode = 1;
    }
  }
}
