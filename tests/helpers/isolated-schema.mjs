/** Test-only schema lifecycle. This module never opens a database connection. */
const ownedSchemas = new WeakMap();

function fixtureSchema(schema) {
  if (!/^(?:itest_|fs_)[a-z0-9_]+$/.test(schema) || schema.length > 63) {
    throw new Error('Expected a temporary itest_ or fs_ schema name (at most 63 characters)');
  }
  return `"${schema}"`;
}

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * LIKE INCLUDING ALL copies serial defaults pointing at the source sequence.
 * Rebind every nextval default before any seed or application insert can run.
 * Identity sequences are already copied independently by PostgreSQL.
 */
export async function isolateCopiedTables(sql, schema, tables) {
  const namespace = fixtureSchema(schema);
  const serialDefaults = await sql`
    select table_name, column_name from information_schema.columns
    where table_schema = ${schema} and column_default like '%nextval(%'
    order by table_name, ordinal_position
  `;
  for (const [index, { table_name, column_name }] of serialDefaults.entries()) {
    if (!tables.includes(table_name)) throw new Error('Serial default outside copied fixture tables');
    const sequence = `${namespace}.${identifier(`fixture_serial_${index}_seq`)}`;
    const column = `${namespace}.${identifier(table_name)}`;
    await sql.unsafe(`create sequence ${sequence}`);
    await sql.unsafe(`alter sequence ${sequence} owned by ${column}.${identifier(column_name)}`);
    await sql.unsafe(`alter table ${column} alter column ${identifier(column_name)} set default nextval('${sequence}'::regclass)`);
  }
  for (const table of tables) {
    await sql.unsafe(`alter table ${namespace}.${identifier(table)} enable row level security`);
  }
}

/** Local compatibility for tests cloned from a deployment preceding Phase 4.
 * This is fixture setup, not migration/FK/trigger proof, and never alters public.
 */
export async function addFixtureInventoryColumns(sql, schema, tables) {
  const namespace = fixtureSchema(schema);
  if (tables.includes('products')) await sql.unsafe(`alter table ${namespace}.products add column if not exists inventory_mode text not null default 'product'`);
  if (tables.includes('order_items')) await sql.unsafe(`alter table ${namespace}.order_items add column if not exists variant_id text, add column if not exists variant_sku text, add column if not exists variant_label text`);
  if (tables.includes('product_variants')) await sql.unsafe(`alter table ${namespace}.product_variants add column if not exists is_purchasable boolean not null default false, add column if not exists device_model_id text, add column if not exists combination_key text`);
}

/**
 * Track ownership only after CREATE succeeds: a collision must never authorize
 * dropping an existing schema. On partial setup failure, callers can still
 * safely call dropFixtureSchema. The process-wide DB slot is pinned too, so an
 * implicit getSql() cannot create an application pool pointing at public.
 */
export async function createFixtureSchema(sql, schema, tables) {
  const namespace = fixtureSchema(schema);
  if (ownedSchemas.has(sql)) throw new Error('Connection already owns a fixture schema');
  await sql.unsafe(`create schema ${namespace}`);
  ownedSchemas.set(sql, { schema, previous: globalThis.__gadzioSql, installed: false });
  for (const table of tables) {
    await sql.unsafe(`create table ${namespace}.${identifier(table)} (like public.${identifier(table)} including all)`);
  }
  await isolateCopiedTables(sql, schema, tables);
  await addFixtureInventoryColumns(sql, schema, tables);
  await sql.unsafe(`set search_path to ${namespace}`);
  const pinned = await sql`select current_schema() as schema`;
  if (pinned[0]?.schema !== schema) throw new Error('Fixture connection is not pinned');
  const owned = ownedSchemas.get(sql);
  globalThis.__gadzioSql = sql;
  owned.installed = true;
}

/** Never reset search_path to public, even on a failed setup or teardown. */
export async function dropFixtureSchema(sql, schema) {
  const owned = ownedSchemas.get(sql);
  if (!owned || owned.schema !== schema) return;
  try {
    // Fail closed for any accidentally issued statement after teardown.
    await sql.unsafe('set search_path to pg_catalog');
    await sql.unsafe(`drop schema ${fixtureSchema(schema)} cascade`);
  } finally {
    if (owned.installed) globalThis.__gadzioSql = owned.previous;
    ownedSchemas.delete(sql);
  }
}

/**
 * Run `fn` after creating `schema` on `sql`, always dropping `schema` in a
 * `finally` block even when `fn` (or setup) throws.
 */
export async function withFixtureSchema(sql, schema, tables, fn) {
  try {
    await createFixtureSchema(sql, schema, tables);
    return await fn(sql, schema);
  } finally {
    await dropFixtureSchema(sql, schema);
  }
}
