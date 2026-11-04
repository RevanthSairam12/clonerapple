#!/usr/bin/env node
/** Read-only preflight, including inactive collisions. No env files, DDL, fixtures,
 * seeds or write-capable client. Missing pre-0059 tables are reported gracefully.
 * DATABASE_URL=... node scripts/inspect-shared-catalogue.mjs [--schema public]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { assertCatalogueTarget, catalogueSchemaUsing, REQUIRED_COLUMNS } from './reconcile-shared-colours.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { sharedNameCollisions, safeCatalogueId } = await jiti.import(path.join(root, 'src/lib/catalog/colour-reconciliation.ts'));
export async function inspectUsing(tx, schema) {
  const state = await catalogueSchemaUsing(tx, schema);
  const counts = {};
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    if (!state.has(table, REQUIRED_COLUMNS[table][0])) { counts[table] = null; continue; }
    const [row] = await tx`select count(*)::text as count from ${tx(`${schema}.${table}`)}`;
    counts[table] = row.count;
  }
  const references = async table => state.complete(table) ? [...await tx`select * from ${tx(`${schema}.${table}`)} order by id`] : [];
  const brands = await references('device_brands'), models = await references('device_models'), colours = await references('colours');
  return { schemaState: state.schema, counts, collisions: sharedNameCollisions(brands, models, colours),
    note: 'Includes active and inactive references. Names/hex values are withheld. Missing tables have null counts. No automatic resolution or migration is performed.',
    invalidModelParents: models.filter(model => !brands.some(brand => brand.id === model.brand_id)).map(model => safeCatalogueId(model.id)).sort() };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length && (argv.length !== 2 || argv[0] !== '--schema')) throw new Error('arguments');
  const schema = argv[1] ?? 'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || schema.startsWith('pg_') || schema === 'information_schema' || !process.env.DATABASE_URL) throw new Error('configuration');
  const url = new URL(process.env.DATABASE_URL);
  assertCatalogueTarget(url);
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require', onnotice: () => {},
    connection: { search_path: schema, default_transaction_read_only: 'on', statement_timeout: 30000, lock_timeout: 5000 } });
  try {
    const report = await sql.begin('isolation level repeatable read read only', async tx => {
      const [pin] = await tx`select current_schema() as schema`;
      const [state] = await tx`show transaction_read_only`;
      if (pin.schema !== schema || state.transaction_read_only !== 'on') throw new Error('readonly');
      return inspectUsing(tx, schema);
    });
    console.log(JSON.stringify({ host: url.host, schema, ...report }, null, 2));
  } finally { await sql.end({ timeout: 5 }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); }
  catch { console.error('Shared catalogue inspection refused or failed. Check the explicit target and schema; details withheld. No writes were attempted.'); process.exitCode = 1; }
}
