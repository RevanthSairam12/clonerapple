/** Real DB writes OFF by default. Approval manifest is mandatory before postgres import. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import { ROOT, SCHEMA, MIGRATIONS, TABLES, openPhase2CatalogFixture } from './helpers/phase2-catalog-fixture.mjs';
const skip = process.env.RUN_PHASE2_CATALOG_DB_TESTS !== '1' ? 'Separate explicit target/manifest write approval required' : false;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('actual 0055-57 migrations, independent races and private history in owned disposable schema', { skip, concurrency: false, timeout: 120000 }, async t => {
  const fixture = await openPhase2CatalogFixture();
  const { sql, peer } = fixture;
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(ROOT, 'src') } });
  try {
    const { assertCatalogRevision } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/catalog-revision.ts'));
    const { duplicateProductUsing } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/product-duplicate.ts'));
    const { writeProductContentUsing, restoreProductContentUsing, productContentHistoryUsing } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/product-content.ts'));
    const revision = async () => Number((await sql`select catalog_revision from products where id='source'`)[0].catalog_revision);
    await sql.begin(async tx => {
      await tx`insert into store_admins(id) values('owner')`;
      await tx`insert into categories(id) values('category')`;
      await tx`insert into attributes(id) values('attribute')`;
      await tx`insert into product_types(id,category_id,name) values('type','category','Type')`;
      await tx`insert into device_brands(id,name) values('brand','Brand')`;
      await tx`insert into device_models(id,brand_id,name) values('model','brand','Model')`;
      await tx`insert into products(id,slug,name,category_id,product_type_id,description,highlights,in_the_box) values('source','source','Source','category','type','Persisted fallback','[{"title":"Old","desc":"Claim"}]','["Cable"]')`;
      await tx`insert into product_variants(id,product_id,sku,option_name,option_value,is_purchasable,device_model_id,combination_key) values('old','source','SKU-OLD','Colour','Black',true,'model','old-key')`;
      await tx`insert into stock(id,product_id,variant_id,on_hand) values('stock','source','old',7)`;
      await tx`insert into order_items(id,product_id,variant_id) values('order','source','old')`;
    });
    const beforeMigration = await sql`select * from products order by id`;
    await t.test('actual 0055 transactional rollback restores original label index before new model is exercised', async () => {
      const bytes = await readFile(path.join(ROOT, 'migrations', MIGRATIONS[0]), 'utf8');
      assert.ok((await sql`select to_regclass(${`${SCHEMA}.idx_product_variants_option`}) as relation`)[0].relation);
      await assert.rejects(sql.begin(async tx => { await tx.unsafe(bytes); throw new Error('intentional migration rollback'); }), /intentional migration rollback/);
      assert.ok((await sql`select to_regclass(${`${SCHEMA}.idx_product_variants_option`}) as relation`)[0].relation);
      await assert.rejects(sql`insert into product_variants(id,product_id,option_value) values('before-duplicate','source','Black')`, error => error.code === '23505');
    });
    for (const migration of MIGRATIONS) await sql.begin(async tx => tx.unsafe(await readFile(path.join(ROOT, 'migrations', migration), 'utf8')));
    await t.test('migration installation preserves content and stock; RLS/FKs/defaults remain local', async () => {
      const [after] = await sql`select * from products where id='source'`;
      const { catalog_revision, ...rest } = after;
      assert.equal(catalog_revision, 0); assert.deepEqual(rest, beforeMigration[0]);
      assert.equal((await sql`select count(*)::int n from product_content_revisions`)[0].n, 0);
      assert.equal((await sql`select on_hand from stock where id='stock'`)[0].on_hand, 7);
      assert.equal((await sql`select to_regclass(${`${SCHEMA}.idx_product_variants_option`}) as relation`)[0].relation, null);
      const tables = await sql`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='r'`;
      assert.deepEqual(tables.map(row => row.relname).sort(), [...TABLES].sort()); assert.ok(tables.every(row => row.relrowsecurity));
      assert.equal((await sql`select count(*)::int n from pg_policies where schemaname=${SCHEMA}`)[0].n, 0);
      assert.equal((await sql`select count(*)::int n from pg_constraint k join pg_class a on a.oid=k.conrelid join pg_namespace an on an.oid=a.relnamespace join pg_class b on b.oid=k.confrelid join pg_namespace bn on bn.oid=b.relnamespace where k.contype='f' and an.nspname=${SCHEMA} and bn.nspname<>${SCHEMA}`)[0].n, 0);
      for (const row of await sql`select column_default from information_schema.columns where table_schema=${SCHEMA} and column_default like 'nextval(%'`) assert.doesNotMatch(row.column_default, /public\./);
    });
    await t.test('retirement frees display label, not historical commerce identity, SKU or stock/order references', async () => {
      await sql`update product_variants set is_active=false,retired_at=now() where id='old'`;
      await sql`insert into product_variants(id,product_id,sku,option_name,option_value,is_purchasable,device_model_id,combination_key,option_identity) values('replacement','source','SKU-NEW','Colour','Black',true,'model','new-key','black')`;
      assert.equal((await sql`select variant_id from order_items where id='order'`)[0].variant_id, 'old');
      assert.equal((await sql`select variant_id,on_hand from stock where id='stock'`)[0].variant_id, 'old');
      await assert.rejects(sql`update product_variants set option_value='Changed' where id='old'`, error => error.code === '23514');
      await assert.rejects(sql`update product_variants set sku='NEW-SKU' where id='replacement'`, error => error.code === '23514');
      await assert.rejects(sql`insert into product_variants(id,product_id,sku,option_value) values('sku-conflict','source','SKU-OLD','White')`, error => error.code === '23505');
      await assert.rejects(sql`insert into product_variants(id,product_id,sku,option_value,is_purchasable,combination_key) values('key-conflict','source','SKU-KEY','White',true,'old-key')`, error => error.code === '23505');
      await assert.rejects(sql`insert into product_variants(id,product_id,sku,option_name,option_value,is_purchasable,device_model_id,combination_key,option_identity) values('semantic-conflict','source','SKU-SEMANTIC',' colour ','BLACK',true,'model','semantic-key','black')`, error => error.code === '23505');
      await assert.rejects(sql`update stock set product_id='missing' where id='stock'`, error => error.code === '23503');
    });
    await t.test('catalog trigger tracks editorial/child/reference writes, excludes inventory and rejects token rewind', async () => {
      let token = await revision();
      await sql`update products set in_stock=false,updated_at=now(),updated_by='owner' where id='source'`;
      await sql`update stock set on_hand=8,reserved=1 where id='stock'`;
      assert.equal(await revision(), token);
      await sql`update products set name='Editorial' where id='source'`; assert.equal(await revision(), ++token);
      await sql`insert into product_images(id,product_id,url) values('image','source','/image.jpg')`; assert.equal(await revision(), ++token);
      await sql`update product_images set updated_at=now() where id='image'`; assert.equal(await revision(), token);
      await sql`insert into product_device_models(product_id,device_model_id) values('source','model')`; assert.equal(await revision(), ++token);
      await sql.begin(async tx => { await tx`select pg_advisory_xact_lock(513031,3)`; await tx`update device_models set name='Renamed' where id='model'`; }); assert.equal(await revision(), ++token);
      await assert.rejects(sql`update products set catalog_revision=0 where id='source'`, error => error.code === '23514');
    });
    await t.test('independent connections serialize stale product token checks: exactly one editor wins', async () => {
      const expected = await revision(), locked = deferred(), launched = deferred();
      const winner = sql.begin(async tx => {
        const [row] = await tx`select catalog_revision from products where id='source' for update`;
        assertCatalogRevision(row, expected); locked.resolve(); await launched.promise;
        await tx`update products set subtitle='winner' where id='source'`;
      });
      await locked.promise;
      const loser = peer.begin(async tx => {
        const pending = tx`select catalog_revision from products where id='source' for update`;
        // Start wire I/O before releasing winner; no timer/polling needed.
        const result = pending.then(rows => rows); launched.resolve();
        const [row] = await result; assertCatalogRevision(row, expected);
        await tx`update products set subtitle='loser' where id='source'`;
      });
      const outcomes = await Promise.allSettled([winner, loser]);
      assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
      assert.equal(outcomes[1].reason.code, 'CATALOG_REVISION_CONFLICT');
      assert.equal((await sql`select subtitle from products where id='source'`)[0].subtitle, 'winner');
    });
    await t.test('independent duplicate callers create one draft and never copy stock or content lineage', async () => {
      // Give source real lineage before copying; null canonical content remains an
      // intentional current value after this explicit empty->null pair of edits.
      await sql.begin(tx => writeProductContentUsing(tx, 'source', { descriptionSections: [] }, 'owner'));
      await sql.begin(tx => writeProductContentUsing(tx, 'source', { descriptionSections: null }, 'owner'));
      const results = await Promise.allSettled([sql.begin(tx => duplicateProductUsing(tx, 'source', { name: 'Copy', slug: 'copy' }, 'owner')), peer.begin(tx => duplicateProductUsing(tx, 'source', { name: 'Copy', slug: 'copy' }, 'owner'))]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter(result => result.status === 'rejected').length, 1);
      const [copy] = await sql`select is_active,short_description,description_sections from products where id='copy'`;
      assert.equal(copy.is_active, false); assert.equal(copy.short_description, null); assert.equal(copy.description_sections, null);
      assert.equal((await sql`select count(*)::int n from price_history where product_id='copy'`)[0].n, 1);
      assert.equal((await sql`select count(*)::int n from store_admin_audit where entity_id='copy'`)[0].n, 1);
      assert.equal((await sql`select count(*)::int n from stock where product_id='copy'`)[0].n, 0);
      assert.equal((await sql`select count(*)::int n from product_content_revisions where product_id='copy'`)[0].n, 0);
      // Both products and old variant exist: this specifically exercises the
      // composite owner FK, rather than merely rejecting a missing product.
      await assert.rejects(sql`update stock set product_id='copy' where id='stock'`, error => error.code === '23503' && error.constraint_name === 'stock_variant_owner');
      await assert.rejects(sql`update order_items set product_id='copy' where id='order'`, error => error.code === '23503' && error.constraint_name === 'order_item_variant_owner');
    });
    await t.test('real content revisions preserve null/empty, old fallback, canonical-only restore and strict audit atomicity', async () => {
      const first = await sql.begin(tx => writeProductContentUsing(tx, 'source', { descriptionSections: [] }, 'owner'));
      const history = await productContentHistoryUsing(sql, 'source');
      assert.equal(history.latestRevision, first.revisionId);
      assert.equal(history.revisions[0].before_snapshot.descriptionSections, null);
      assert.equal(history.revisions[0].before_snapshot.legacyFallback.description, 'Persisted fallback');
      const noOp = await sql.begin(tx => writeProductContentUsing(tx, 'source', { descriptionSections: [] }, 'owner'));
      assert.equal(noOp.changed, false);
      await sql`update products set description='New fallback' where id='source'`;
      await sql.begin(tx => restoreProductContentUsing(tx, 'source', first.revisionId, 'owner', { snapshot: 'before', expectedRevision: first.revisionId }));
      const [restored] = await sql`select description,description_sections from products where id='source'`;
      assert.equal(restored.description_sections, null); assert.equal(restored.description, 'New fallback');
      await sql.unsafe("alter table store_admin_audit add constraint fixture_refuse_content_audit check(action<>'catalog.product.content.write') not valid");
      try { await assert.rejects(sql.begin(tx => writeProductContentUsing(tx, 'source', { shortDescription: 'must roll back' }, 'owner')), /audit could not be saved/); }
      finally { await sql.unsafe('alter table store_admin_audit drop constraint fixture_refuse_content_audit'); }
      assert.equal((await sql`select short_description from products where id='source'`)[0].short_description, null);
      assert.equal((await sql`select count(*)::int n from product_content_revisions`)[0].n, 4);
      const audits = await sql`select before,after from store_admin_audit where entity_id='source'`;
      assert.doesNotMatch(JSON.stringify(audits), /Persisted fallback|New fallback|must roll back/);
      await assert.rejects(sql`update product_content_revisions set source='restore'`, /immutable/);
      await assert.rejects(sql`delete from product_content_revisions`, /immutable/);
      // Owner normally bypasses RLS. FORCE inside a rollback-only transaction proves
      // no-policy denial using an already-verified non-BYPASSRLS owner, no role DDL.
      await assert.rejects(sql.begin(async tx => {
        await tx.unsafe('alter table product_content_revisions force row level security');
        assert.equal((await tx`select count(*)::int n from product_content_revisions`)[0].n, 0);
        throw new Error('intentional RLS probe rollback');
      }), /intentional RLS probe rollback/);
      assert.equal((await sql`select count(*)::int n from product_content_revisions`)[0].n, 4);
    });
    let total = 0;
    const counts = {};
    for (const table of TABLES) {
      counts[table] = Number((await sql.unsafe(`select count(*)::int n from "${SCHEMA}"."${table}"`))[0].n);
      total += counts[table];
    }
    assert.equal(counts.products, fixture.manifest.writeBounds.productsCommitted);
    assert.equal(counts.product_variants, fixture.manifest.writeBounds.variantsCommitted);
    assert.equal(counts.stock, fixture.manifest.writeBounds.fixtureStockRows);
    assert.equal(counts.order_items, fixture.manifest.writeBounds.fixtureOrderItems);
    assert.ok(counts.product_content_revisions <= fixture.manifest.writeBounds.contentRevisionsCommittedMaximum);
    assert.ok(counts.store_admin_audit <= fixture.manifest.writeBounds.genericAuditCommittedMaximum);
    assert.ok(counts.price_history <= fixture.manifest.writeBounds.priceHistoryCommittedMaximum);
    assert.ok(total <= fixture.manifest.writeBounds.totalCommittedRowsMaximum);
    const sequences = await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='S'`;
    for (const sequence of sequences) assert.ok(Number((await sql.unsafe(`select last_value from "${SCHEMA}"."${sequence.relname}"`))[0].last_value) <= fixture.manifest.writeBounds.sequenceAdvancesMaximumEach);
  } finally { await fixture.close(); }
});
