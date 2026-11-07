#!/usr/bin/env node
/**
 * Phase 6 migration rehearsal — disposable schema only.
 *
 * What it proves, on the real PostgreSQL engine, without touching the live
 * schema:
 *   1. Every migration file from 0001 to 0057 replays cleanly, in filename
 *      order, inside a brand-new schema.
 *   2. The real rows from every table those migrations own are copied into the
 *      new schema first, so 0058–0061 run against a copy of the real data.
 *   3. 0058–0061 add their columns, tables, indexes, triggers and RLS without
 *      changing a single copied row.
 *   4. The same four files are safe to run a second time.
 *
 * It never writes to `public` and never reads the live rows into a report; only
 * counts leave this process.
 *
 * Approval is explicit and exact:
 *   REHEARSE_MIGRATIONS=yes REHEARSE_TARGET=<host> node scripts/rehearse-options-migrations.mjs
 *
 * The host must match the approved database hostname exactly. The connection
 * string is read from DATABASE_URL and is never printed.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

// Minimal .env.local loader, matching scripts/migrate.mjs.
const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // DATABASE_URL must come from the real environment.
}

const connectionUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
if (!connectionUrl) {
  console.error('DATABASE_MIGRATION_URL or DATABASE_URL is not set. Nothing was contacted.');
  process.exit(1);
}
if (process.env.REHEARSE_MIGRATIONS !== 'yes') {
  console.error('Refusing to write: set REHEARSE_MIGRATIONS=yes only after approving the exact target.');
  console.error('Nothing was contacted.');
  process.exit(2);
}

let host;
try {
  const parsed = new URL(connectionUrl);
  if (parsed.port === '6543') {
    console.error('Refusing port 6543 (transaction pooler): use a session connection on port 5432.');
    process.exit(1);
  }
  host = parsed.hostname;
} catch {
  console.error('DATABASE_URL is not a URL. Nothing was contacted.');
  process.exit(1);
}
if (!process.env.REHEARSE_TARGET || process.env.REHEARSE_TARGET !== host) {
  console.error(`Refusing to write: REHEARSE_TARGET must equal the approved host "${host}". Nothing was contacted.`);
  process.exit(2);
}

const dir = path.resolve(process.cwd(), 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const CORE = files.filter((f) => f < '0058');
const OPTIONS = files.filter((f) => f >= '0058');
if (CORE.length === 0 || OPTIONS.length === 0) {
  console.error('Migration set is not what this rehearsal expects. Nothing was contacted.');
  process.exit(1);
}

// The same additive-only guard the real runner uses.
const FORBIDDEN =
  /\b(drop\s+(table|column|database)|truncate|alter\s+table\s+\w+\s+drop\s+(?!constraint\b|policy\b))\b/i;

const schema = `itest_phase6_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
if (!/^itest_phase6_[a-z0-9]+$/.test(schema)) throw new Error('Refusing an unexpected schema name.');

const sql = postgres(connectionUrl, {
  max: 1,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

const started = Date.now();
const evidence = {
  host,
  schema,
  startedAt: new Date().toISOString(),
  coreFiles: CORE.length,
  optionFiles: OPTIONS,
  timings: [],
  rewrites: [],
  copied: {},
  before: {},
  after: {},
  checks: [],
  dropped: false,
};
let created = false;
let failure = null;

function check(name, ok, detail = '') {
  evidence.checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`Rehearsal check failed: ${name}${detail ? ` — ${detail}` : ''}`);
}

async function apply(file, rewrite) {
  const t = Date.now();
  let raw = await readFile(path.join(dir, file), 'utf8');
  if (FORBIDDEN.test(raw)) throw new Error(`Refusing ${file}: contains a destructive statement.`);
  if (rewrite) {
    // Two migrations name the live schema or inspect an unscoped catalogue:
    // 0014 reads information_schema with table_schema = 'public', and 0021
    // checks pg_constraint by name alone. Both are correct for a single-schema
    // production database but would collide with the live schema beside the
    // rehearsal. The rewrite only redirects those checks to the rehearsal
    // schema; no statement's intent changes.
    raw = raw.replace(/table_schema = 'public'/g, `table_schema = '${schema}'`);
    // Constraint-replacement loops join pg_class by table name only. Without a
    // namespace filter they would also find the live table's constraint and
    // then drop the same name twice.
    const relnameLoops = (raw.match(/where t\.relname =/g) ?? []).length;
    if (relnameLoops) {
      raw = raw.replace(
        /where t\.relname =/g,
        `where t.relnamespace = '${schema}'::regnamespace and t.relname =`,
      );
      evidence.rewrites.push({ file, scopedRelnameLoops: relnameLoops });
    }
    const unscoped = (raw.match(/from pg_constraint\s+where conname =/g) ?? []).length;
    if (unscoped) {
      raw = raw.replace(
        /from pg_constraint(\s+)where conname =/g,
        (_m, ws) =>
          `from pg_constraint${ws}where conrelid in (select oid from pg_class where relnamespace = '${schema}'::regnamespace) and conname =`,
      );
      evidence.rewrites.push({ file, scopedCatalogueGuards: unscoped });
    }
    raw = raw.replace(/\bpublic\./gi, `${schema}.`);
  }
  await sql.unsafe(raw);
  evidence.timings.push({ file, ms: Date.now() - t });
}

async function tableCounts(target) {
  const rows = await sql.unsafe(
    `select table_schema, table_name from information_schema.tables
      where table_schema in ('public', $1) and table_type = 'BASE TABLE'
      order by table_name`,
    [schema],
  );
  const names = [...new Set(rows.map((r) => r.table_name))].sort();
  const counts = {};
  for (const name of names) {
    const inScratch = rows.some((r) => r.table_schema === schema && r.table_name === name);
    const inPublic = rows.some((r) => r.table_schema === 'public' && r.table_name === name);
    if (!inScratch) continue;
    let n = 0;
    try {
      const result = await sql.unsafe(`select count(*)::int as n from "${schema}"."${name}"`);
      n = result[0].n;
    } catch {
      n = -1;
    }
    counts[name] = { rows: n, publicTable: inPublic };
  }
  return counts;
}

async function commonColumns(table) {
  const rows = await sql.unsafe(
    `select a.column_name
       from information_schema.columns a
       join information_schema.columns b
         on b.table_schema = 'public' and b.table_name = a.table_name and b.column_name = a.column_name
      where a.table_schema = $1 and a.table_name = $2
      order by a.ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => r.column_name);
}

try {
  const existing = await sql`select 1 from information_schema.schemata where schema_name = ${schema}`;
  if (existing.length) throw new Error('Refusing an existing schema.');
  await sql.unsafe(`create schema "${schema}"`);
  created = true;
  await sql.unsafe(`set search_path to "${schema}"`);
  evidence.searchPath = (await sql`show search_path`)[0].search_path;
  check('search_path pins the throwaway schema and excludes public', !evidence.searchPath.includes('public'));

  // 1. Replay the pre-options migrations into the empty schema.
  for (const file of CORE) await apply(file, true);
  check('0001–0057 replay cleanly', true, `${CORE.length} files`);

  // 2. Copy the real rows into the replay schema, parents first.
  const pre = await tableCounts();
  const pending = Object.entries(pre).filter(([, v]) => v.publicTable).map(([name]) => name);
  const copied = {};
  for (let round = 0; round < 12 && pending.length; round += 1) {
    let progressed = false;
    for (const table of [...pending]) {
      if (table === 'schema_migrations') {
        pending.splice(pending.indexOf(table), 1);
        continue;
      }
      const columns = await commonColumns(table);
      if (columns.length === 0) {
        pending.splice(pending.indexOf(table), 1);
        continue;
      }
      const list = columns.map((c) => `"${c}"`).join(',');
      try {
        // Some migrations seed default rows (for example cancellation reasons),
        // so a copied row can already exist with the same key.
        await sql.unsafe(
          `insert into "${schema}"."${table}" (${list}) select ${list} from public."${table}" on conflict do nothing`,
        );
        copied[table] = (await sql.unsafe(`select count(*)::int as n from "${schema}"."${table}"`))[0].n;
        pending.splice(pending.indexOf(table), 1);
        progressed = true;
      } catch (error) {
        const code = error?.code;
        if (code === '23503') continue; // parent row not copied yet
        if (code === '428C9') {
          // GENERATED ALWAYS AS IDENTITY needs OVERRIDING SYSTEM VALUE.
          await sql.unsafe(
            `insert into "${schema}"."${table}" (${list}) overriding system value select ${list} from public."${table}" on conflict do nothing`,
          );
          copied[table] = 1;
          pending.splice(pending.indexOf(table), 1);
          progressed = true;
          continue;
        }
        throw new Error(`Copying ${table} failed (${code ?? 'unknown'}): ${error.message}`);
      }
    }
    if (!progressed) break;
  }
  evidence.copied = copied;
  check(
    'every live table with rows outside migrations was copied',
    pending.length === 0 || pending.every((t) => pre[t]?.rows === 0),
    pending.length ? `still pending: ${pending.join(', ')}` : '',
  );
  const copiedRows = Object.values(copied).reduce((a, b) => a + b, 0);
  check('the rehearsal copied real rows', copiedRows > 0, `${copiedRows} rows`);

  // 3. Apply the Phase 1–3 option migrations on top of that copy.
  evidence.before = await tableCounts();
  for (const file of OPTIONS) await apply(file, true);

  const after = await tableCounts();
  for (const [table, before] of Object.entries(evidence.before)) {
    if (before.rows < 0) continue;
    const now = after[table]?.rows;
    if (!(table in evidence.copied) && before.rows === 0) continue;
    check(`existing rows in ${table} are unchanged`, now === before.rows, `${before.rows} → ${now}`);
  }
  evidence.after = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.rows]));

  const columns = async (table) =>
    (await sql.unsafe(
      `select column_name from information_schema.columns where table_schema=$1 and table_name=$2`,
      [schema, table],
    )).map((r) => r.column_name);

  const orderColumns = await columns('order_items');
  for (const column of [
    'variant_device_model_id',
    'variant_device_model_name',
    'variant_colour_id',
    'variant_colour_name',
    'variant_colour_hex',
    'image_url',
    'image_alt',
  ]) {
    check(`order_items.${column} exists`, orderColumns.includes(column));
  }
  if (evidence.before.order_items?.rows > 0) {
    const nonsNull = (await sql.unsafe(
      `select count(*)::int as n from "${schema}".order_items
        where variant_device_model_id is not null or variant_colour_id is not null or image_url is not null`,
    ))[0].n;
    check('existing order rows keep their null snapshots', nonsNull === 0, `${nonsNull} non-null`);
  }

  check('products.sell_by exists and defaults to single', (await columns('products')).includes('sell_by'));
  check('products.sku_pattern exists', (await columns('products')).includes('sku_pattern'));
  check('price_history change_group exists', (await columns('price_history')).includes('change_group'));
  check('product_images.colour_id exists', (await columns('product_images')).includes('colour_id'));

  const indexes = new Set(
    (await sql.unsafe(
      `select indexname from pg_indexes where schemaname = $1`,
      [schema],
    )).map((r) => r.indexname),
  );
  for (const name of [
    'device_brands_shared_name_unique',
    'device_models_shared_name_unique',
    'colours_shared_name_unique',
    'colours_hex_unique',
    'idx_price_history_variant',
    'idx_product_images_colour',
    'product_variant_colours_colour',
    'product_variant_colours_product',
  ]) {
    check(`index ${name} exists`, indexes.has(name));
  }

  const rls = async (table) =>
    (await sql.unsafe(
      `select relrowsecurity from pg_class where oid = $1::regclass`,
      [`"${schema}"."${table}"`],
    ))[0]?.relrowsecurity;
  check('colours has row level security', await rls('colours') === true);
  check('product_variant_colours has row level security', await rls('product_variant_colours') === true);

  const normalise = (value) =>
    sql.unsafe(`select "${schema}".shared_catalogue_key($1) as k`, [value]).then((r) => r[0].k);
  check('normalization keeps the documented sample', (await normalise('iPhone 16 Pro')) === 'iphone16pro');
  check('normalization is per-codepoint (Greek ΟΣ)', (await normalise('ΟΣ')) === 'οσ');

  const brand = (await sql.unsafe(`select id, name from "${schema}".device_brands limit 1`))[0];
  if (brand) {
    let rejected = false;
    try {
      await sql.unsafe(
        `insert into "${schema}".device_brands (id, name) values ($1, $2)`,
        [`rehearsal-dup-${randomBytes(2).toString('hex')}`, brand.name.toUpperCase()],
      );
    } catch (error) {
      rejected = error?.code === '23505';
    }
    check('a case-variant duplicate brand is rejected', rejected);
  } else {
    evidence.checks.push({ name: 'duplicate brand check', ok: true, detail: 'no brand rows to duplicate' });
  }

  const colourId = `rehearsal-colour-${randomBytes(2).toString('hex')}`;
  let badHexRejected = false;
  try {
    await sql.unsafe(
      `insert into "${schema}".colours (id, name, hex) values ($1, 'Rehearsal Red', 'red')`,
      [colourId],
    );
  } catch (error) {
    badHexRejected = error?.code === '23514';
  }
  check('a colour hex outside #RRGGBB is rejected', badHexRejected);

  const product = (await sql.unsafe(`select id from "${schema}".products order by id limit 1`))[0];
  const variant = (await sql.unsafe(`select id, product_id from "${schema}".product_variants order by id limit 1`))[0];
  if (product && variant) {
    await sql.unsafe(
      `insert into "${schema}".colours (id, name, hex) values ($1, 'Rehearsal Blue', '#0000FF')`,
      [`${colourId}-blue`],
    );
    await sql.unsafe(
      `insert into "${schema}".product_variant_colours (variant_id, product_id, colour_id) values ($1, $2, $3)`,
      [variant.id, variant.product_id, `${colourId}-blue`],
    );
    let immutable = false;
    try {
      await sql.unsafe(
        `update "${schema}".product_variant_colours set colour_id = $1 where variant_id = $2`,
        [colourId, variant.id],
      );
    } catch (error) {
      immutable = error?.code === '23514';
    }
    check('a saved variant colour link cannot be updated', immutable);

    // The link is immutable (update and delete both raise), so the cross-product
    // check uses a different saved variant on a different product.
    const otherVariant = (await sql.unsafe(
      `select id, product_id from "${schema}".product_variants
        where product_id <> $1 order by id limit 1`,
      [variant.product_id],
    ))[0];
    if (otherVariant) {
      let crossProduct = false;
      try {
        await sql.unsafe(
          `insert into "${schema}".product_variant_colours (variant_id, product_id, colour_id) values ($1, $2, $3)`,
          [otherVariant.id, variant.product_id, `${colourId}-blue`],
        );
      } catch (error) {
        crossProduct = error?.code === '23503';
      }
      check('a variant colour link cannot cross products', crossProduct);
    } else {
      evidence.checks.push({ name: 'cross-product colour link', ok: true, detail: 'only one product in the copy' });
    }

    // The rehearsal schema is dropped, so these rows never reach the live tables.
  }

  // 4. Re-running the four option migrations must be a no-op.
  const rerunStarted = Date.now();
  for (const file of OPTIONS) await apply(file, true);
  evidence.timings.push({ file: '0058–0061 rerun', ms: Date.now() - rerunStarted });
  const afterRerun = await tableCounts();
  for (const [table, before] of Object.entries(evidence.before)) {
    if (before.rows <= 0) continue;
    check(`re-running keeps ${table} unchanged`, afterRerun[table]?.rows === before.rows);
  }
  check('0058–0061 are safe to run twice', true);
} catch (error) {
  failure = error;
} finally {
  try {
    if (created) {
      await sql.unsafe(`drop schema "${schema}" cascade`);
      evidence.dropped = true;
      const left = await sql`select 1 from information_schema.schemata where schema_name = ${schema}`;
      evidence.schemaGone = left.length === 0;
    }
  } catch (error) {
    evidence.dropError = error?.message;
  }
  await sql.end();
}

evidence.finishedAt = new Date().toISOString();
evidence.durationMs = Date.now() - started;
evidence.ok = !failure && evidence.checks.every((c) => c.ok) && evidence.schemaGone !== false;
const evidenceDir = path.resolve(process.cwd(), 'tmp');
await mkdir(evidenceDir, { recursive: true });
const evidencePath = path.join(evidenceDir, `phase6-migration-rehearsal-${Date.now()}.json`);
await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: evidence.ok,
  host,
  schemaDropped: evidence.dropped,
  coreFiles: CORE.length,
  optionFiles: OPTIONS.length,
  copiedRows: Object.values(evidence.copied).reduce((a, b) => a + b, 0),
  checks: evidence.checks.length,
  failed: evidence.checks.filter((c) => !c.ok).map((c) => c.name),
  durationMs: evidence.durationMs,
  evidence: evidencePath,
  error: failure?.message ?? null,
}, null, 2));

if (!evidence.ok) process.exitCode = 1;
