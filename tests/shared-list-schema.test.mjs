import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { createJiti } from 'jiti';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { normalizeSharedName } = await jiti.import(path.join(root, 'src/lib/catalog/shared-list-rules.ts'));
const normalization = await read('migrations/0058_shared_catalogue_normalization.sql');
const colours = await read('migrations/0059_shared_colours.sql');
const stripComments = text => text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('new shared tables each enable RLS in creation file without public policies or seeded rows', () => {
  const sql = stripComments(colours);
  const tables = [...sql.matchAll(/create table if not exists (\w+)/gi)].map(match => match[1]);
  assert.deepEqual(tables, ['colours', 'product_variant_colours']);
  for (const table of tables) assert.match(sql, new RegExp(`alter table ${table} enable row level security`, 'i'));
  assert.doesNotMatch(sql, /create policy|insert into\s+(?:colours|device_brands|device_models)|\b(?:begin|commit)\s*;|concurrently/i);
  assert.match(sql, /hex ~ '\^#\[0-9A-F\]\{6\}\$'/);
  assert.match(sql, /unique index[^;]+colours\(shared_catalogue_key\(name\)\)/i);
  assert.match(sql, /unique index[^;]+colours\(hex\)/i);
  assert.doesNotMatch(sql, /unique index[^;]+where\s+is_active/i);
});

test('links enforce one colour per variant plus composite parent ownership and indexed FK coverage', () => {
  assert.match(colours, /variant_id text primary key/);
  assert.match(colours, /product_id text not null references products\(id\)/);
  assert.match(colours, /colour_id text not null references colours\(id\)/);
  assert.match(colours, /foreign key \(product_id,variant_id\) references product_variants\(product_id,id\)/);
  assert.match(colours, /on product_variant_colours\(colour_id,product_id,variant_id\)/);
  assert.match(colours, /on product_variant_colours\(product_id,variant_id\)/);
  assert.match(colours, /before update or delete on product_variant_colours/);
  assert.match(colours, /raise exception 'Saved variant colour links are immutable; archive and replace the option' using errcode='23514'/);
  assert.doesNotMatch(stripComments(colours), /(?:update|alter table) product_variants\b/i);
});

test('revision triggers are insert-only for links and sorted parent fanout for colour changes', async () => {
  assert.match(colours, /after insert on product_variant_colours[\s\S]+touch_catalog_revision_from_child/);
  assert.match(colours, /array_agg\(distinct product_id order by product_id\)/);
  assert.match(colours, /perform touch_product_catalog_revisions\(affected_ids\)/);
  assert.match(colours, /is not distinct from/);
  const revision = await read('migrations/0057_catalog_edit_revision.sql');
  assert.match(revision, /select distinct id from unnest\(product_ids\)[^\n]+order by id/);
  assert.match(revision, /loop\s+update products set catalog_revision = catalog_revision \+ 1 where id = product_id_to_touch/);
});

test('normalization indexes fail closed on all active and inactive names, models scoped by brand', () => {
  assert.match(normalization, /group by shared_catalogue_key\(name\) having count\(\*\)>1/);
  assert.match(normalization, /group by brand_id,shared_catalogue_key\(name\) having count\(\*\)>1/);
  assert.match(normalization, /raise exception 'Shared catalogue normalization conflicts/);
  assert.match(normalization, /device_models\(brand_id,shared_catalogue_key\(name\)\)/);
  assert.doesNotMatch(stripComments(normalization), /where is_active|update device_|delete from|insert into device_/i);
  assert.match(normalization, /immutable strict parallel safe/);
});

// Parse the actual SQL's pinned mapping and allowed category ranges. This is an
// offline interpreter of those literals, NOT proof of PostgreSQL regexp/NFKC
// behavior. Engine/collation/Unicode-version parity remains a separate DB proof.
const sqlCase = new Map([...normalization.matchAll(/when '((?:''|[^'])*)' then '((?:''|[^'])*)'/gu)].map(([, from, to]) => [from.replace(/''/g, "'"), to.replace(/''/g, "'")]));
const allowedMatch = normalization.match(/return regexp_replace\(result, '(\[\^[^\n]+\])', '', 'g'\)/u);
assert.ok(allowedMatch, 'parse actual pinned SQL character ranges');
const sqlDisallowed = new RegExp(allowedMatch[1], 'gu');
const offlineSql = value => Array.from(value.normalize('NFKC'), c => sqlCase.get(c) ?? c).join('').replace(sqlDisallowed, '');
const vectors = [
  ['', ''], ['  Space—BLACK! ', 'spaceblack'], ['ＡＣＭＥ １２', 'acme12'], ['İ / I / ı', 'iiı'],
  ['ΟΣ', 'οσ'], ['Σςσ', 'σςσ'], ['É é', 'éé'], ['K Å ﬃ ①', 'kåffi1'],
  ['中文 日本語', '中文日本語'], ['हिन्दी', 'हनद'], ['العَرَبِيَّة ١٢٣', 'العربية١٢٣'],
  ['𐐀𐐨', '𐐨𐐨'], ['Ꭰꭰ', 'ꭰꭰ'], ['😀​\u0000_-', ''],
];

test('offline SQL literal interpreter and JS agree on static Unicode normalization vectors', () => {
  assert.ok(sqlCase.size > 1400);
  assert.match(normalization, /normalize\(value, NFKC\)/);
  assert.match(normalization, /foreach c in array regexp_split_to_array/);
  for (const [input, expected] of vectors) {
    assert.equal(normalizeSharedName(input), expected, `JS ${JSON.stringify(input)}`);
    assert.equal(offlineSql(input), expected, `SQL literals ${JSON.stringify(input)}`);
  }
});

test('every SQL lowercase mapping and Unicode category range matches the installed JS Unicode data', () => {
  for (const [from, to] of sqlCase) assert.equal(from.toLowerCase(), to, `case U+${from.codePointAt(0).toString(16)}`);
  const allowed = new RegExp(`^${allowedMatch[1]}$`, 'u');
  for (let point = 0; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const c = String.fromCodePoint(point);
    assert.equal(!allowed.test(c), /[\p{L}\p{N}]/u.test(c), `category U+${point.toString(16)}`);
    assert.equal(sqlCase.get(c) ?? c, c.toLowerCase(), `complete lowercase mapping U+${point.toString(16)}`);
  }
});

// Real engine/index/FK/trigger/RLS acceptance now lives in
// tests/shared-list-integration.test.mjs. It is opt-in and exact-target/code
// manifest guarded; these offline checks never stand in for a database pass.

test('legacy backfill cannot seed devices, while authorized owner insert services remain permitted', async () => {
  const backfill = await read('src/lib/catalog/product-metadata-backfill.ts');
  assert.doesNotMatch(backfill, /reference\(snapshot\.(?:brands|models)|inserts\.device_(?:brands|models)\.push/);
  assert.match(backfill, /owner-device-reference-missing-or-ambiguous/);
  const runner = await read('scripts/migrate-product-compatibility.mjs');
  assert.match(runner, /fresh\.inserts\.device_brands\.length \|\| fresh\.inserts\.device_models\.length/);
  const service = await read('src/lib/store-admin/shared-lists.ts');
  assert.match(service, /ownerUsing\(tx, actor\)/);
  assert.match(service, /insert into device_models/); // Explicit approved owner/admin creation is NOT a seed.
  for (const name of await readdir(path.join(root, 'scripts'))) {
    if (!/^(?:seed-|migrate).*\.mjs$/.test(name)) continue;
    const source = stripComments(await read(`scripts/${name}`));
    assert.doesNotMatch(source, /insert into\s+(?:public\.)?(?:device_brands|device_models)\b/i, `${name} must not seed device references`);
  }
  for (const name of await readdir(path.join(root, 'migrations'))) {
    if (!name.endsWith('.sql')) continue;
    const sql = stripComments(await read(`migrations/${name}`));
    assert.doesNotMatch(sql, /insert into\s+(?:public\.)?(?:device_brands|device_models)\b/i, `${name} must not seed device references`);
  }
});
