import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { assertCatalogueTarget, parseColourArgs, applyColourPlanUsing, colourManifest, colourSnapshotUsing } from '../scripts/reconcile-shared-colours.mjs';
import { inspectUsing } from '../scripts/inspect-shared-catalogue.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { planColourReconciliation: plan, assertColourApproval: approve, sharedNameCollisions, safeCatalogueId } = await jiti.import(path.join(root, 'src/lib/catalog/colour-reconciliation.ts'));
const target = 'explicit target identity';
const fixture = () => ({ schema: { missing: [], rlsDisabled: [] }, products: [{ id: 'p1', deleted_at: null, catalog_revision: 1 }],
  colours: [{ id: 'owner_colour', name: 'Space Black', hex: '#010203', is_active: true }],
  variants: [{ id: 'v1', product_id: 'p1', option_name: 'Colour', option_value: ' ＳＰＡＣＥ—Black ', option_hex: '#010203', is_active: true, retired_at: null, sku: 'immutable', price_paise_override: 123 }], links: [] });

test('only joint normalized name+hex evidence yields one append-only link, with no source mutation', () => {
  const snapshot = fixture(), before = structuredClone(snapshot), result = plan(snapshot, target);
  assert.deepEqual(result.inserts, [{ product_id: 'p1', variant_id: 'v1', colour_id: 'owner_colour' }]);
  assert.deepEqual(result.counts, { insertLinks: 1, existingLinks: 0, review: 0, affectedProducts: 1, audit: 1 });
  approve(result, result.digest); assert.deepEqual(snapshot, before);
  assert.equal(JSON.stringify(result).includes('immutable'), false);
});

test('name-only, hex-only, disagreements, inactive refs and normalization collisions never guessed', () => {
  for (const [modify, code] of [
    [s => { s.variants[0].option_hex = null; }, 'missing-name-or-hex'],
    [s => { s.variants[0].option_value = ''; }, 'missing-name-or-hex'],
    [s => { s.variants[0].option_hex = '#FFFFFF'; }, 'name-hex-disagreement-or-collision'],
    [s => { s.variants[0].option_value = 'Wrong'; }, 'name-hex-disagreement-or-collision'],
    [s => { s.colours[0].is_active = false; }, 'inactive-colour'],
    [s => { s.colours.push({ ...s.colours[0], id: 'inactive_duplicate', is_active: false }); }, 'name-hex-disagreement-or-collision'],
    [s => { s.colours = []; }, 'unmatched-colour'],
  ]) {
    const snapshot = fixture(); modify(snapshot); const result = plan(snapshot, target);
    assert.equal(result.inserts.length, 0); assert.equal(result.review[0].code, code);
  }
});

test('unrelated, inactive, retired and deleted options are not linked or rewritten', () => {
  for (const modify of [s => { s.variants[0].is_active = false; }, s => { s.variants[0].retired_at = '2025-01-01'; }, s => { s.products[0].deleted_at = '2025-01-01'; }, s => { s.variants[0].option_name = 'Size'; }]) {
    const snapshot = fixture(); modify(snapshot); assert.equal(plan(snapshot, target).inserts.length, 0);
  }
});

test('second plan has no inserts/audit, existing links are never replaced even after rename/deactivation', () => {
  const snapshot = fixture(), first = plan(snapshot, target); snapshot.links.push(...first.inserts);
  for (const change of [false, true]) {
    if (change) Object.assign(snapshot.colours[0], { name: 'Renamed', is_active: false });
    const next = plan(snapshot, target);
    assert.equal(next.inserts.length, 0); assert.equal(next.counts.audit, 0); assert.equal(next.counts.existingLinks, 1);
  }
  snapshot.links[0].product_id = 'foreign';
  assert.equal(plan(snapshot, target).review[0].code, 'existing-link-conflict');
});

test('digest binds complete hidden snapshot, target and schema, independent of ordering', () => {
  const snapshot = fixture(); snapshot.variants.push({ ...snapshot.variants[0], id: 'v2' });
  const original = plan(snapshot, target); snapshot.variants.reverse(); assert.deepEqual(plan(snapshot, target), original);
  assert.notEqual(plan(snapshot, 'another-target').digest, original.digest);
  snapshot.variants[0].sku = 'hidden'; assert.notEqual(plan(snapshot, target).digest, original.digest);
  assert.throws(() => approve(plan(snapshot, target), original.digest), /mismatch/);
  snapshot.schema.missing.push('colours.id'); const missing = plan(snapshot, target); assert.throws(() => approve(missing, missing.digest), /schema\/RLS/);
  snapshot.schema = { missing: [], rlsDisabled: ['colours'] }; const noRls = plan(snapshot, target); assert.throws(() => approve(noRls, noRls.digest), /schema\/RLS/);
});

test('reports withhold labels, hex values and unsafe IDs', () => {
  const snapshot = fixture(); snapshot.variants[0].option_value = 'person@example.com'; snapshot.variants[0].id = 'secret@example.com';
  const report = JSON.stringify(plan(snapshot, target)); assert.doesNotMatch(report, /person@|secret@|#010203/);
  assert.equal(safeCatalogueId('secret\nvalue'), '[redacted-id]');
});

test('preflight collisions include inactive rows and model brand scope without leaking names', () => {
  const brands = [{ id: 'b1', name: 'Acme', is_active: true }, { id: 'b2', name: 'ＡＣＭＥ', is_active: false }];
  const models = [{ id: 'm1', name: 'Model A', brand_id: 'b1' }, { id: 'm2', name: 'model-a', brand_id: 'b1' }, { id: 'm3', name: 'Model A', brand_id: 'b2' }];
  const collisions = sharedNameCollisions(brands, models);
  assert.equal(collisions.brands.length, 1); assert.equal(collisions.models[0].length, 2);
  assert.doesNotMatch(JSON.stringify(collisions), /Acme|Model A/);
});

test('apply and target manifest approval flags are explicit, not inferred from configured env', async () => {
  assertCatalogueTarget(new URL('postgres://role:secret@host/db?sslmode=require'));
  for (const suffix of ['?search_path=other', '?default_transaction_read_only=off', '?options=unsafe', '?statement_timeout=0']) assert.throws(() => assertCatalogueTarget(new URL(`postgres://role:secret@host/db${suffix}`)));
  for (const value of ['postgres://host/db', 'postgres://role@host/', 'postgres://role@host%2Cother/db']) assert.throws(() => assertCatalogueTarget(new URL(value)));
  assert.equal(parseColourArgs([]).apply, false);
  assert.equal(parseColourArgs(['--manifest']).manifest, true);
  for (const args of [['--apply'], ['--apply', '--dry-run'], ['--schema', 'public,evil'], ['--schema', 'pg_catalog'], ['--approved-host', 'configured-live']]) assert.throws(() => parseColourArgs(args));
  const approved = ['--apply', '--schema', 'test_schema', '--approved-schema', 'test_schema', '--approved-host', 'host:5432', '--approved-digest', 'a'.repeat(64), '--approved-manifest', 'b'.repeat(64), '--staff-actor', 'owner_1'];
  assert.equal(parseColourArgs(approved).apply, true);
  assert.throws(() => parseColourArgs(approved.filter((_, i) => i !== 1 && i !== 2)));
  const first = await colourManifest(new URL('postgres://role:secret@host/db'), 'public');
  const second = await colourManifest(new URL('postgres://role:changed-password@host/db'), 'public');
  assert.equal(first.approvalSha256, second.approvalSha256);
  assert.notEqual((await colourManifest(new URL('postgres://role:secret@host/other_db'), 'public')).approvalSha256, first.approvalSha256);
  assert.doesNotMatch(JSON.stringify(first), /secret|postgres:\/\//);
});

// SQL is modeled in memory only. No postgres client or fixture is constructed.
function fakeTx(snapshot, { missing = false, owner = true, insertFailure = false } = {}) {
  const calls = [];
  const tx = (strings, ...values) => {
    if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw')) return strings;
    const query = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push(query);
    if (query.includes('information_schema.columns')) {
      if (missing) return [];
      return Object.entries({ colours: ['id','name','hex','is_active','sort_order','created_at','updated_at'], product_variant_colours: ['product_id','variant_id','colour_id','created_at'], product_variants: ['id','product_id','option_name','option_value','option_hex','is_active','retired_at'], products: ['id','deleted_at','catalog_revision'], device_brands: ['id','name','is_active'], device_models: ['id','name','brand_id','is_active'] }).flatMap(([table_name, cols]) => cols.map(column_name => ({ table_name, column_name })));
    }
    if (query.includes('pg_class c join pg_namespace')) return missing ? [] : ['colours','product_variant_colours'].map(relname => ({ relname, relrowsecurity: true }));
    if (query.includes('pg_index')) return ['device_brands_shared_name_unique','device_models_shared_name_unique','colours_shared_name_unique','colours_hex_unique'].map(relname => ({ relname }));
    if (query.includes('pg_trigger')) return [['product_variant_colours','protect_variant_colour_reference'],['product_variant_colours','catalog_revision_variant_colours'],['colours','catalog_revision_shared_colour']].map(([relname,tgname]) => ({ relname,tgname }));
    if (query.includes('pg_constraint')) return ['PRIMARY KEY (variant_id)', 'FOREIGN KEY (product_id, variant_id) REFERENCES product_variants(product_id, id)', 'FOREIGN KEY (colour_id) REFERENCES colours(id)'].map(definition => ({ definition }));
    if (query.startsWith('select id from store_admins')) return owner ? [{ id: 'owner' }] : [];
    if (query.startsWith('select * from')) return snapshot[{ colours: 'colours', products: 'products', product_variants: 'variants', product_variant_colours: 'links', device_brands: 'brands', device_models: 'models' }[values[0].split('.').at(-1)]] ?? [];
    if (query.startsWith('insert into')) {
      if (insertFailure) throw new Error('forced insert failure');
      snapshot.links.push({ product_id: values[0], variant_id: values[1], colour_id: values[2] }); return [{ variant_id: values[1] }];
    }
    return [];
  };
  return { tx, calls };
}
async function transaction(snapshot, callback) { const working = structuredClone(snapshot); const result = await callback(working); Object.assign(snapshot, working); return result; }
const argsFor = snapshot => ({ schema: 'public', staffActor: 'owner', approvedDigest: plan(snapshot, target).digest });

test('apply freshly replans under fence, locks sorted parents before children/links, strict single count audit', async () => {
  const snapshot = fixture(), calls = [], audits = [];
  await transaction(snapshot, async working => {
    const fake = fakeTx(working);
    await applyColourPlanUsing(fake.tx, argsFor(working), target, { metadataGate: async () => calls.push('gate'), strictMetadataAudit: async (_tx, audit) => audits.push(audit) });
    calls.push(...fake.calls);
  });
  assert.equal(calls[0], 'gate');
  const parent = calls.findIndex(q => q.includes('order by id for update'));
  const variant = calls.findIndex(q => q.includes('order by product_id,id for update'));
  const links = calls.findIndex(q => q.includes('order by product_id,variant_id for update'));
  assert.ok(parent >= 0 && parent < variant && variant < links);
  assert.equal(audits.length, 1); assert.deepEqual(audits[0].after, { insertedLinks: 1, affectedProducts: 1, existingLinks: 0, review: 0 });
  const fake = fakeTx(snapshot);
  await applyColourPlanUsing(fake.tx, argsFor(snapshot), target, { metadataGate: async () => {}, strictMetadataAudit: async () => assert.fail('no-op audit') });
  assert.equal(fake.calls.some(q => q.startsWith('insert') || q.startsWith('update')), false);
});

test('owner, stale digest, insert and audit failures roll back the entire modeled transaction', async () => {
  for (const failure of ['owner', 'stale', 'insert', 'audit']) {
    const snapshot = fixture(), before = structuredClone(snapshot), args = argsFor(snapshot);
    if (failure === 'stale') args.approvedDigest = '0'.repeat(64);
    await assert.rejects(transaction(snapshot, async working => {
      const fake = fakeTx(working, { owner: failure !== 'owner', insertFailure: failure === 'insert' });
      return applyColourPlanUsing(fake.tx, args, target, { metadataGate: async () => {}, strictMetadataAudit: async () => { if (failure === 'audit') throw new Error('forced audit failure'); } });
    }));
    assert.deepEqual(snapshot, before);
  }
});

test('missing pre-migration tables are detected without querying absent colours/links', async () => {
  const fake = fakeTx(fixture(), { missing: true });
  const snapshot = await colourSnapshotUsing(fake.tx, 'public');
  assert.deepEqual(snapshot.colours, []); assert.deepEqual(snapshot.links, []);
  assert.ok(snapshot.schema.missing.includes('colours.id'));
  const report = await inspectUsing(fake.tx, 'public'); assert.equal(report.counts.colours, null);
  assert.equal(fake.calls.some(q => q.startsWith('select *')), false);
});

test('script safety contracts: max one, read-only default, no env loading/DDL/identity writes/secrets', async () => {
  const reconciliation = await readFile(path.join(root, 'scripts/reconcile-shared-colours.mjs'), 'utf8');
  const inspect = await readFile(path.join(root, 'scripts/inspect-shared-catalogue.mjs'), 'utf8');
  for (const source of [reconciliation, inspect]) {
    assert.match(source, /max: 1/); assert.match(source, /isolation level repeatable read read only/); assert.match(source, /show transaction_read_only/);
    assert.doesNotMatch(source, /readFile\([^\n]*\.env|console\.(?:error|log)\([^\n]*(?:error\.message|DATABASE_URL)|(?:update|delete from|insert into)\s+(?:colours|products|product_variants|orders|stock)\b/i);
  }
  assert.match(reconciliation, /approvedHost !== url.host/); assert.match(reconciliation, /approvedManifest !== manifest.approvalSha256/);
  assert.match(reconciliation, /default_transaction_read_only: args.apply \? 'off' : 'on'/);
  assert.match(inspect, /default_transaction_read_only: 'on'/);
  assert.doesNotMatch(inspect, /\binsert into\b|\bupdate\s+\w+\s+set\b/i);
});
