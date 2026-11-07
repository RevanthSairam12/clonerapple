/**
 * Real SQL tests, OFF by default. No .env loading and no app pool replacement.
 * Preflight: node scripts/phase3-test-manifest.mjs --configured-hostname
 * Request separate consent before setting RUN_PHASE3_DB_TESTS=1 and the exact
 * PHASE3_APPROVED_MANIFEST. This file alone does not authorize DB writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createJiti } from 'jiti';
import { ROOT, SCHEMA, TABLES, OPERATIONS, phase3Manifest, openPhase3Fixture } from './helpers/phase3-fixture.mjs';

const skip = process.env.RUN_PHASE3_DB_TESTS !== '1' ? 'Phase3 database writes require separate manifest approval' : false;

test('Phase3 manifest is deterministic, source-bound and rejects approval before client construction (no DB)', async () => {
  const target = 'postgres://fixture:withheld@fixture.example.test/test';
  const first = await phase3Manifest(target);
  assert.deepEqual(first, await phase3Manifest(target));
  assert.equal(first.hostname, 'fixture.example.test');
  assert.doesNotMatch(JSON.stringify(first), /withheld|postgres:\/\//);
  assert.deepEqual(first.schemas, [SCHEMA]);
  assert.equal(first.maximumConnections, 1);
  for (const key of ['publicBusinessDataReads', 'publicTableWrites', 'publicSequenceAdvances', 'stockWrites']) assert.equal(first[key], 0);
  for (const key of ['committedInserts', 'rolledBackInserts', 'rejectedInsertAttempts']) assert.deepEqual(Object.keys(first[key]).sort(), [...TABLES].sort());
  assert.equal(new Set(OPERATIONS.map(op => op.name)).size, OPERATIONS.length);
  for (const sequence of first.sequences) {
    assert.ok(sequence.name.startsWith(`${SCHEMA}.`));
    assert.equal(sequence.totalAdvances, sequence.committedAdvances + sequence.rolledBackAdvances + sequence.rejectedAdvances);
  }
  for (const [name, digest] of Object.entries(first.sourceSha256)) assert.equal(createHash('sha256').update(await readFile(path.join(ROOT, name))).digest('hex'), digest);
  const { approvalSha256, ...approved } = first;
  assert.equal(approvalSha256, createHash('sha256').update(JSON.stringify(approved)).digest('hex'));
  const helper = await readFile(path.join(ROOT, 'tests/helpers/phase3-fixture.mjs'), 'utf8');
  assert.doesNotMatch(helper, /like\s+public\.|search_path:\s*['"]public/i);
  assert.doesNotMatch(helper, /readFile\([^\n]*\.env/);
  assert.ok(helper.indexOf('process.env.PHASE3_APPROVED_MANIFEST, manifest.approvalSha256') < helper.indexOf("await import('postgres')"));
  assert.ok(helper.indexOf("await import('postgres')") < helper.indexOf('const sql = postgres('));
  const keys = ['RUN_PHASE3_DB_TESTS', 'PHASE3_APPROVED_MANIFEST', 'DATABASE_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.DATABASE_URL = target;
    delete process.env.RUN_PHASE3_DB_TESTS;
    await assert.rejects(openPhase3Fixture(), /explicit write approval/);
    process.env.RUN_PHASE3_DB_TESTS = '1';
    process.env.PHASE3_APPROVED_MANIFEST = 'not-approved';
    await assert.rejects(openPhase3Fixture(), /Generate and approve the exact Phase3 write manifest/);
  } finally {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

test('Phase3 actual migration and metadata/duplicate service transactions in private approved schema', { skip, concurrency: false }, async t => {
  // Open verifies approval BEFORE loading services (which import the db module).
  const fixture = await openPhase3Fixture();
  const { sql } = fixture;
  try {
    const jiti = createJiti(import.meta.url, { alias: { '@': path.join(ROOT, 'src') } });
    const { saveProductMetadataUsing, productMetadataUsing, metadataReferencesUsing } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/product-metadata.ts'));
    const { duplicateProductUsing } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/product-duplicate.ts'));
    const save = (input, id = 'source', options = {}) => sql.begin(tx => saveProductMetadataUsing(tx, id, input, 'phase3_owner', options));
    const opSave = (name, input) => fixture.operation(name, () => save(input));
    const state = (id = 'source') => productMetadataUsing(sql, id);
    const duplicate = (tx, slug) => duplicateProductUsing(tx, 'source', { name: 'Draft copy', slug }, 'phase3_owner');
    const denied = (input, pattern, id = 'source') => assert.rejects(save(input, id), pattern);

    await t.test('actual migration leaves legacy products unassigned; all RLS/FKs/defaults are local', async () => {
      const [legacy] = await sql`select product_type_id,compatibility_reviewed_at from products where id='legacy'`;
      assert.equal(legacy.product_type_id, null); assert.equal(legacy.compatibility_reviewed_at, null);
      assert.equal((await sql`select count(*)::int n from product_device_models`)[0].n, 0);
      assert.equal((await sql`select count(*)::int n from product_attribute_history`)[0].n, 0);
      const tables = await sql`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='r'`;
      assert.deepEqual(tables.map(row => row.relname).sort(), [...TABLES].sort());
      assert.ok(tables.every(row => row.relrowsecurity));
      assert.equal((await sql`select count(*)::int n from pg_policies where schemaname=${SCHEMA}`)[0].n, 0);
      assert.equal((await sql`select count(*)::int n from pg_constraint k join pg_class a on a.oid=k.conrelid join pg_namespace an on an.oid=a.relnamespace join pg_class b on b.oid=k.confrelid join pg_namespace bn on bn.oid=b.relnamespace where k.contype='f' and an.nspname=${SCHEMA} and bn.nspname<>${SCHEMA}`)[0].n, 0);
      const sequences = await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='S'`;
      assert.deepEqual(sequences.map(row => `${SCHEMA}.${row.relname}`).sort(), fixture.manifest.sequences.map(row => row.name).sort());
      const defaults = await sql`select column_default from information_schema.columns where table_schema=${SCHEMA} and column_default like 'nextval(%'`;
      assert.equal(defaults.length, 2);
      for (const row of defaults) assert.doesNotMatch(row.column_default, /public\./);
    });
    await t.test('seed explicit type scopes and active/inactive device references', async () => {
      await fixture.operation('reference seed', client => client.begin(async tx => {
        await tx`insert into product_types(id,category_id,name,requires_compatibility,is_active) values ('type_a','cat_a','Case',true,true),('type_b','cat_b','Other case',false,true),('type_off','cat_a','Inactive',false,false)`;
        await tx`insert into product_type_attributes(product_type_id,attribute_id,is_required) values ('type_a','flag',true),('type_a','quantity',true),('type_a','colour',true),('type_a','model',true),('type_a','hidden',true)`;
        await tx`insert into device_brands(id,name,is_active) values ('brand_on','Active brand',true),('brand_off','Inactive brand',false)`;
        await tx`insert into device_models(id,brand_id,name,is_active) values ('device_on','brand_on','Active device',true),('device_off','brand_on','Inactive device',false),('device_brand_off','brand_off','Inactive brand device',true)`;
      }));
      const refs = await metadataReferencesUsing(sql);
      assert.deepEqual(refs.types.find(row => row.id === 'type_a').attributes.map(row => row.attributeId).sort(), ['colour', 'flag', 'quantity']);
      assert.deepEqual(refs.models.filter(row => row.isActive).map(row => row.id), ['device_on']);
      await fixture.operation('archive legacy model value', client => client`update product_attribute_values set archived_at=now() where product_id='source' and attribute_id='model'`);
    });
    await t.test('real migration constraints reject category mismatch, invalid ranges and missing references', async () => {
      await fixture.rejectInsert('product_types', () => sql`insert into product_types(id,category_id,name) values ('bad_category','missing','Missing')`, /foreign key/i);
      await fixture.rejectInsert('product_types', () => sql`insert into product_types(id,category_id,name) values ('bad_name','cat_a',' ')`, /check constraint/i);
      await fixture.rejectInsert('product_types', () => sql`insert into product_types(id,category_id,name,sort_order) values ('bad_sort','cat_a','Sort',-1)`, /check constraint/i);
      await fixture.rejectInsert('product_types', () => sql`insert into product_types(id,category_id,name) values ('duplicate_name','cat_a',' CASE ')`, /unique constraint/i);
      await fixture.rejectInsert('product_type_attributes', () => sql`insert into product_type_attributes(product_type_id,attribute_id) values ('type_a','missing')`, /foreign key/i);
      await fixture.rejectInsert('device_models', () => sql`insert into device_models(id,brand_id,name) values ('bad_device','missing','Missing')`, /foreign key/i);
      await fixture.rejectInsert('product_attribute_values', () => sql`insert into product_attribute_values(product_id,attribute_id) values ('missing','flag')`, /foreign key/i);
      await fixture.rejectInsert('product_attribute_values', () => sql`insert into product_attribute_values(product_id,attribute_id) values ('source','missing')`, /foreign key/i);
      await fixture.rejectInsert('product_device_models', () => sql`insert into product_device_models(product_id,device_model_id) values ('source','missing')`, /foreign key/i);
      await fixture.rejectInsert('product_device_models', () => sql`insert into product_device_models(product_id,device_model_id) values ('missing','device_on')`, /foreign key/i);
      await assert.rejects(sql`update products set category_id='missing' where id='legacy'`, /foreign key/i);
    });
    await t.test('service rejects undefined enum and unknown/inactive/out-of-scope selections without writes', async () => {
      await denied({ productTypeId: 'missing' }, /active type/);
      await denied({ productTypeId: 'type_b' }, /active type/);
      await denied({ productTypeId: 'type_off' }, /active type/);
      await denied({}, /Product not found/, 'missing');
      for (const id of ['missing', 'device_off', 'device_brand_off', 'all']) await denied({ deviceModelIds: [id] }, /unknown or inactive/);
      for (const id of ['model', 'hidden', 'unmapped', 'missing']) await denied({ productTypeId: 'type_a', attributeValues: { [id]: 'bad' } }, /not applicable/);
      await denied({ productTypeId: 'type_a', attributeValues: { colour: 'green' } }, /defined option/);
      await denied({ productTypeId: 'type_a', attributeValues: { quantity: 'not a number' } }, /number/i);
      assert.equal((await state()).productTypeId, null);
      assert.equal((await state()).reviewed, false);
    });
    await t.test('deliberate classification, PAV archive/restore and no-op preserve actual trigger history', async () => {
      await opSave('classify source deliberately', { productTypeId: 'type_a', deviceModelIds: ['device_on'] });
      await opSave('archive enum', { attributeValues: { colour: null } });
      assert.equal((await state()).attributes.find(row => row.attributeId === 'colour').archived, true);
      await opSave('restore enum', { attributeValues: { colour: 'blue' } });
      await opSave('same value retry', { attributeValues: { colour: 'blue' } });
      const history = await sql`select attribute_id,option_value,value_text,archived_at from product_attribute_history order by id`;
      assert.deepEqual(history.map(row => [row.attribute_id, row.option_value, row.value_text, row.archived_at !== null]), [
        ['model', null, 'Historical model', false], ['colour', 'red', null, false], ['colour', 'red', null, true],
      ]);
      assert.equal((await state()).attributes.find(row => row.attributeId === 'model').value, 'Historical model');
      assert.equal((await state()).attributes.find(row => row.attributeId === 'model').applicable, false);
      assert.deepEqual((await state()).deviceModelIds, ['device_on']);
      assert.equal((await state()).reviewed, true);
      assert.deepEqual((await state()).problems, []);
    });
    await t.test('composite FK rejects separate category move; atomic paired moves preserve PAV data', async () => {
      await assert.rejects(sql`update products set category_id='cat_b' where id='source'`, /products_type_category_fk/);
      await fixture.operation('move category and type together', client => client.begin(async tx => {
        await tx`update products set category_id='cat_b',product_type_id='type_b' where id='source'`;
        await saveProductMetadataUsing(tx, 'source', { productTypeId: 'type_b' }, 'phase3_owner');
      }));
      assert.ok((await state()).attributes.every(row => !row.applicable));
      await fixture.operation('restore category and type', client => client.begin(async tx => {
        await tx`update products set category_id='cat_a',product_type_id='type_a' where id='source'`;
        await saveProductMetadataUsing(tx, 'source', { productTypeId: 'type_a' }, 'phase3_owner');
      }));
      assert.deepEqual((await state()).problems, []);
    });
    await t.test('publication accepts required false/0 and rejects missing required values, devices and type atomically', async () => {
      const before = await state();
      assert.equal(before.attributes.find(row => row.attributeId === 'flag').value, false);
      assert.equal(before.attributes.find(row => row.attributeId === 'quantity').value, 0);
      await fixture.operation('publish complete false and zero', client => client.begin(async tx => {
        await tx`update products set is_active=true where id='source'`;
        await saveProductMetadataUsing(tx, 'source', {}, 'phase3_owner', { enforcePublication: true });
      }));
      await fixture.operation('reject required value removal', tx => saveProductMetadataUsing(tx, 'source', { attributeValues: { flag: null } }, 'phase3_owner'), /Flag is required/);
      await fixture.operation('reject active device removal', tx => saveProductMetadataUsing(tx, 'source', { deviceModelIds: [] }, 'phase3_owner'), /active compatible device/);
      // Verify optional classification without committing an extra business edit
      // or changing this separately approved fixture's write bounds.
      await fixture.operation('untyped publication is valid (rollback probe)', async tx => {
        await saveProductMetadataUsing(tx, 'source', { productTypeId: null }, 'phase3_owner');
        assert.deepEqual((await productMetadataUsing(tx, 'source')).problems, []);
        throw new Error('intentional optional type probe rollback');
      }, /intentional optional type probe rollback/);
      assert.deepEqual(await state(), before);
      await fixture.operation('reject inactive brand publication', async tx => {
        await tx`update device_brands set is_active=false where id='brand_on'`;
        await saveProductMetadataUsing(tx, 'source', {}, 'phase3_owner', { enforcePublication: true });
      }, /active compatible device/);
      await fixture.operation('reject inactive model publication', async tx => {
        await tx`update device_models set is_active=false where id='device_on'`;
        await saveProductMetadataUsing(tx, 'source', {}, 'phase3_owner', { enforcePublication: true });
      }, /active compatible device/);
      // Reactivating the model restores *selectability* (metadataReferencesUsing
      // drops inactive models, so a still-inactive one would fail the save with
      // 'A selected device model is unknown or inactive.'). Publication is then
      // accepted because the save itself stamps compatibility_reviewed_at, and
      // with no live commerce options and an is_active-only membership the
      // remaining review conditions are all false. Runs inside one transaction
      // that restores the inactive model: the cases after it, and the manifest's
      // accepted insert totals, are written against the deactivated state.
      await fixture.operation('publish under review', async tx => {
        await tx`update device_models set is_active=true where id='device_on'`;
        await saveProductMetadataUsing(tx, 'source', { deviceModelIds: ['device_on'] }, 'phase3_owner', { enforcePublication: true });
        const state = await productMetadataUsing(tx, 'source');
        assert.deepEqual(state.problems, []);
        assert.equal(state.reviewed, true);
        assert.equal(state.needsCompatibilityReview, false);
        await tx`update device_models set is_active=false where id='device_on'`;
        throw new Error('intentional review-state probe rollback');
      }, /intentional review-state probe rollback/);
      await fixture.operation('reject inactive type publication', async tx => {
        await tx`update product_types set is_active=false where id='type_a'`;
        await saveProductMetadataUsing(tx, 'source', {}, 'phase3_owner', { enforcePublication: true });
      }, /active type/);
      assert.deepEqual(await state(), before);
      await fixture.operation('retain explicit inactive draft type', async tx => {
        await tx`update products set is_active=false where id='source'`;
        await tx`update product_types set is_active=false where id='type_a'`;
        await saveProductMetadataUsing(tx, 'source', { productTypeId: 'type_a' }, 'phase3_owner');
        assert.equal((await productMetadataUsing(tx, 'source')).productTypeId, 'type_a');
      });
    });
    await t.test('strict audit error and caller failure roll back PAV/history/audit together', async () => {
      await sql.unsafe("alter table store_admin_audit add constraint phase3_reject_audit check(action<>'catalog.product.metadata') not valid");
      try {
        await fixture.operation('strict audit failure', tx => saveProductMetadataUsing(tx, 'source', { attributeValues: { colour: 'red' } }, 'phase3_owner'), /audit could not be saved/);
      } finally { await sql.unsafe('alter table store_admin_audit drop constraint phase3_reject_audit'); }
      await fixture.operation('caller rollback', tx => saveProductMetadataUsing(tx, 'source', { attributeValues: { colour: 'red' } }, 'phase3_owner'));
      assert.equal((await state()).attributes.find(row => row.attributeId === 'colour').value, 'blue');
      assert.equal((await sql`select count(*)::int n from product_attribute_history`)[0].n, 3);
    });
    await t.test('duplicate makes one draft with no price history; repeated slug has no effects or stock writes', async () => {
      await fixture.operation('duplicate draft once', client => client.begin(async tx => {
        assert.equal(await duplicate(tx, 'copy'), 'copy');
      }));
      const [copy] = await sql`select is_active,product_type_id,compatibility_reviewed_at,price_paise from products where id='copy'`;
      assert.equal(copy.is_active, false); assert.equal(copy.product_type_id, 'type_a');
      assert.ok(copy.compatibility_reviewed_at); assert.equal(Number(copy.price_paise), 10000);
      assert.deepEqual(await state('copy'), await state());
      // A duplicate starts with no price history at all.
      assert.equal((await sql`select count(*)::int n from price_history where product_id='copy'`)[0].n, 0);
      const before = await sql`select id,action,after from store_admin_audit order by id`;
      await assert.rejects(sql.begin(tx => duplicate(tx, 'copy')), /already exists/);
      assert.deepEqual([...await sql`select id,action,after from store_admin_audit order by id`], [...before]);
      await fixture.operation('duplicate caller rollback', tx => duplicate(tx, 'rolled-back-copy'));
      assert.equal((await sql`select count(*)::int n from products where id='rolled-back-copy'`)[0].n, 0);
      for (const table of ['stock_levels', 'stock_movements', 'stock_reservations']) assert.equal((await sql.unsafe(`select count(*)::int n from "${table}"`))[0].n, 0);
      const [audit] = await sql`select after from store_admin_audit where action='catalog.product.duplicate'`;
      assert.deepEqual(audit.after, { sourceId: 'source', draft: true, stockCopied: false, priceHistoryCopied: false });
    });
    await t.test('final rows and all committed/rolled-back/rejected sequence advances match approval', async () => {
      await fixture.assertCounts();
      assert.equal((await state('legacy')).productTypeId, null);
      assert.deepEqual((await state('legacy')).deviceModelIds, []);
      await assert.rejects(sql`update store_admin_audit set reason='changed'`, /immutable/);
      await assert.rejects(sql`delete from store_admin_audit`, /immutable/);
    });
  } finally { await fixture.close(); }
});
