import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sharedListManifest, openSharedListFixture, loadSharedListServices, SCHEMA, ROOT } from './helpers/shared-list-fixture.mjs';

const offlineTarget = 'postgresql://fixture:offline@shared-list.invalid:5432/disposable';
const dbEnabled = process.env.RUN_SHARED_LIST_DB_TESTS === '1';
const sqlCode = code => error => error.code === code;

/**
 * Scalars where the two normalization engines are expected to disagree, because
 * their Unicode data versions differ — not because either is wrong.
 *
 * `shared_catalogue_key()` runs `normalize(value, NFKC)` using the PostgreSQL
 * server's Unicode tables; `normalizeSharedName()` runs `String.normalize('NFKC')`
 * + `toLowerCase()` using Node's ICU tables. Measured on this target:
 * PostgreSQL 17.6 reports `unicode_version() = 15.1`; Node 24 ships Unicode 17.0.
 *
 * Two scalars straddle that boundary, in opposite directions:
 *
 * 1. U+A7F1 (LATIN EPIGRAPHIC LETTER SIDEWAYS I) — Node is ahead. It gained an
 *    NFKC compatibility decomposition to 's' in Unicode 16.0, so Node 17.0 gives
 *    `normalizeSharedName('꟱') === 's'`, while PostgreSQL 15.1's `normalize()`
 *    leaves the scalar alone and the key returns '꟱'.
 *
 * 2. U+1CCD6 (the "A" of the Symbols for Legacy Computing Supplement, added in
 *    Unicode 16.0) — the two engines disagree in the other direction, and about
 *    the decomposition rather than the case mapping. Node 17.0 applies NFKC and
 *    gets 'A' → 'a', so `normalizeSharedName('𜳖') === 'a'`. PostgreSQL 15.1's
 *    `normalize()` does not know the block and hands '𜳖' back unchanged; the
 *    function's generated letter/number filter does not list the new block, so
 *    the character is stripped and `shared_catalogue_key('𜳖') === ''`.
 *
 * Measured on this target; both call shapes (a scalar `text` parameter and the
 * batched `unnest(text[])` the sweep uses) were checked and agree.
 *
 * The consequences are benign here: the key only groups names for duplicate
 * detection, so a name containing either scalar keys as itself (or as nothing)
 * and at worst fails to collide with the spelling a future engine would fold it
 * into. No production row uses either, and the fix — when it is wanted — belongs
 * in a new migration that raises one engine's Unicode data, never in a rewrite of
 * the applied 0058 function.
 *
 * Keep this list exact and tiny: these are the only scalars where a divergence is
 * allowed, and every entry is asserted against both engines by name below, so an
 * exclusion cannot silently swallow a future regression.
 */
const UNICODE_VERSION_BOUNDARY = new Map([
  ['꟱', { js: 's', pg: '꟱', since: 'Unicode 16.0', ahead: 'Node (NFKC decomposes the scalar; PostgreSQL 15.1 does not)' }],
  ['𜳖', { js: 'a', pg: '', since: 'Unicode 16.0', ahead: 'Node (NFKC decomposes to A→a; PostgreSQL 15.1 neither normalizes nor keeps the block)' }],
]);

test('shared-list manifest is deterministic, target/code bound, bounded and secret-free (offline)', async () => {
  const one = await sharedListManifest({ databaseUrl: offlineTarget });
  const two = await sharedListManifest({ databaseUrl: offlineTarget, race: true });
  assert.deepEqual(one, await sharedListManifest({ databaseUrl: offlineTarget }));
  assert.equal(one.schema, 'itest_shared_lists_v1'); assert.equal(one.maximumConnections, 1);
  assert.equal(two.maximumConnections, 2); assert.notEqual(one.approvalSha256, two.approvalSha256);
  assert.equal(two.operations.at(-1).concurrentTransactions, 2);
  assert.equal(two.committedInserts.colours - one.committedInserts.colours, 1);
  assert.notEqual(one.approvalSha256, (await sharedListManifest({ databaseUrl: offlineTarget.replace('offline@','changed@') })).approvalSha256);
  assert.doesNotMatch(JSON.stringify(one), /fixture:offline|postgresql:\/\//);
  assert.equal(one.publicWrites, 0); assert.equal(one.publicSequenceAdvances, 0);
  assert.equal(one.sequences[0].totalAdvances, one.committedInserts.store_admin_audit + one.rolledBackInserts.store_admin_audit + one.rejectedInsertAttempts.store_admin_audit);
  assert.equal(one.rejectedInsertAttempts.product_variant_colours, 4);
  assert.ok(Object.keys(one.sourceSha256).includes('src/lib/store-admin/shared-lists.ts'));
  for (const databaseUrl of [undefined, 'not-a-target', offlineTarget + '?options=-csearch_path=public', offlineTarget.replace('5432','6543')]) {
    await assert.rejects(sharedListManifest({ databaseUrl }));
  }
});

test('fixture approval guards reject before postgres import/client and never use old approval or DATABASE_URL (offline)', async () => {
  await assert.rejects(openSharedListFixture({}), /Separate explicit/);
  await assert.rejects(openSharedListFixture({ RUN_SHARED_LIST_DB_TESTS: '1', DATABASE_URL: offlineTarget, PHASE3_APPROVED_MANIFEST: 'old' }), /explicit PostgreSQL target/);
  await assert.rejects(openSharedListFixture({ RUN_SHARED_LIST_DB_TESTS: '1', SHARED_LIST_DATABASE_URL: offlineTarget, SHARED_LIST_APPROVED_MANIFEST: 'wrong' }), /exact target\/code/);
  const source = await readFile(path.join(ROOT, 'tests/helpers/shared-list-fixture.mjs'),'utf8');
  assert.ok(source.indexOf('assert.equal(env.SHARED_LIST_APPROVED_MANIFEST') < source.indexOf("await import('postgres')"));
  assert.doesNotMatch(source, /\.env(?:\.local)?['"]|LIKE\s+public\.|search_path:\s*[^,\n]+public/i);
});

test('real transaction service loader blocks application-pool and authenticated-app entry points (offline)', async () => {
  const { service, rules } = await loadSharedListServices();
  assert.equal(rules.normalizeSharedName('Ａ—B'), 'ab');
  await assert.rejects(service.loadSharedSnapshot(), /application database pool/);
  await assert.rejects(service.sharedSessionBinding(), /Authenticated app acceptance is separate/);
  for (const name of ['previewSharedImportUsing','applySharedImportUsing','saveSharedReferenceUsing']) assert.equal(typeof service[name], 'function');
});

// Genuine finite opt-in acceptance: enabling it with missing/wrong approval FAILS,
// never skips or falls back to the application's configured database.
test('PostgreSQL shared lists: actual migrations, engine parity, constraints, services and bounded optional race', {
  skip: !dbEnabled && 'Pending separate exact-target/code approval; no PostgreSQL client constructed', timeout: 1_800_000,
}, async t => {
  const f = await openSharedListFixture();
  const { sql, service, rules } = f;
  const owner = 'fixture-owner', session = 'fixture-session';
  const request = new Request('https://fixture.invalid/api/store-admin/catalog/shared/colours', { headers: { 'x-forwarded-for': '192.0.2.1', 'user-agent': 'shared-list-fixture' } });
  const preview = raw => sql.begin('isolation level repeatable read read only', tx => service.previewSharedImportUsing(tx, raw, owner, session));
  const apply = (tx, raw, token, acknowledged = []) => service.applySharedImportUsing(tx, raw, token, acknowledged, owner, session, request);
  const colourInput = text => ({ kind: 'colours', format: 'paste', text });
  const revisions = async () => (await sql`select id,catalog_revision from products order by id`).map(row => ({ id: row.id, revision: row.catalog_revision }));
  const assertAdvanced = async before => assert.deepEqual(await revisions(), before.map(row => ({ ...row, revision: row.revision + 1 })));
  try {
    await t.test('seed only local minimal contracts; retain saved and retired variant identities', async () => {
      await f.operation('base seed', async tx => {
        await tx`insert into store_admins(id,role) values (${owner},'store_owner')`;
        await tx`insert into device_brands(id,name) values ('b1','Acme'),('b2','Orbit')`;
        await tx`insert into device_models(id,brand_id,name) values ('m1','b1','Legacy'),('m2','b2','Legacy')`;
        await tx`insert into products(id,name) values ('p1','Local first'),('p2','Local second')`;
        await tx`insert into product_variants(id,product_id,device_model_id,sku,combination_key,option_value,is_active,is_purchasable,retired_at) values ('v1','p1','m1','fixture-live','saved-live','Legacy',true,true,null),('v2','p2','m2','fixture-retired','saved-retired','Historical option',false,false,'2020-01-01Z'),('v3','p1','m1','fixture-unlinked','saved-unlinked','Unlinked',false,false,null)`;
        await tx`insert into product_device_models(product_id,device_model_id) values ('p1','m1'),('p2','m2')`;
      });
    });
    assert.deepEqual(await revisions(), [{ id: 'p1', revision: 3 }, { id: 'p2', revision: 2 }]);
    const identities = await sql`select * from product_variants order by id`;

    await t.test('0058 aborts whole migration for inactive brand/model collisions and empty keys', async () => {
      for (const [name, seed] of [
        ['brand collision migration abort', tx => tx`insert into device_brands(id,name,is_active) values ('collision1','Collision—Brand',true),('collision2','Ｃollision Brand',false)`],
        ['model collision migration abort', tx => tx`insert into device_models(id,brand_id,name,is_active) values ('collision1','b1','Collision—Model',true),('collision2','b1','Ｃollision Model',false)`],
        ['empty key migration abort', tx => tx`insert into device_brands(id,name,is_active) values ('empty','😀',false)`],
      ]) {
        await f.operation(name, async tx => {
          await seed(tx);
          // Savepoint proves seed cardinality before the real file aborts the TX.
          const staged = await f.snapshot(tx);
          assert.equal(staged[name.startsWith('model') ? 'device_models' : 'device_brands'], name.startsWith('empty') ? 3 : 4);
          await tx.unsafe(f.migrations['0058_shared_catalogue_normalization.sql']);
        }, /Shared catalogue normalization conflicts/);
        const [row] = await sql`select to_regprocedure(${`${SCHEMA}.shared_catalogue_key(text)`}) as fn,to_regclass(${`${SCHEMA}.device_brands_shared_name_unique`}) as idx`;
        assert.equal(row.fn, null); assert.equal(row.idx, null);
      }
      await f.operation('apply actual 0058 and 0059', async tx => {
        await tx.unsafe(f.migrations['0058_shared_catalogue_normalization.sql']);
        await tx.unsafe(f.migrations['0059_shared_colours.sql']);
      });
    });

    await t.test('PostgreSQL normalization agrees with JS on all representable Unicode scalars and mixed NFKC vectors', async () => {
      const check = async batch => {
        const rows = await sql`select value,shared_catalogue_key(value) as key from unnest(${batch}::text[]) as inputs(value)`;
        assert.equal(rows.length, batch.length);
        for (const row of rows) assert.equal(row.key, rules.normalizeSharedName(row.value), `engine parity ${JSON.stringify(row.value)}`);
      };
      let batch = [];
      for (let point = 1; point <= 0x10ffff; point++) {
        if (point >= 0xd800 && point <= 0xdfff) continue;
        const scalar = String.fromCodePoint(point);
        // Only the documented Unicode-version-boundary scalars are excluded, and
        // only while both engines still disagree about them. If a future server
        // or Node version closes the gap, the guard stops matching and the scalar
        // is swept again — so an exclusion cannot outlive the reason for it.
        const boundary = UNICODE_VERSION_BOUNDARY.get(scalar);
        if (boundary) {
          const [probe] = await sql`select shared_catalogue_key(${scalar}) as key`;
          const js = rules.normalizeSharedName(scalar);
          // This scalar is a *documented divergence*: skip it only while the two
          // engines really do disagree. If they agree, the reason for the
          // exclusion is gone, so fall through and sweep it like any other scalar.
          if (probe.key !== js) continue;
        }
        batch.push(scalar);
        if (batch.length === 4096) { await check(batch); batch = []; }
      }
      if (batch.length) await check(batch);
      await check(['', '  Space—BLACK! ', 'ＡＣＭＥ １２', 'İ / I / ı', 'ΟΣ', 'Σςσ', 'É é', 'K Å ﬃ ①', '中文 日本語', 'हिन्दी', 'العَرَبِيَّة ١٢٣', '𐐀𐐨', 'Ꭰꭰ', '😀​_-']);

      // The documented boundary scalars stay covered: each is asserted against
      // BOTH engines by name — and against the live sweep, which must still be
      // excluding them — so an accidental change on either side, or an exclusion
      // that has quietly become unnecessary, fails here instead of disappearing.
      for (const [scalar, expected] of UNICODE_VERSION_BOUNDARY) {
        const [row] = await sql`select shared_catalogue_key(${scalar}) as key`;
        assert.equal(row.key, expected.pg, `PostgreSQL key for ${JSON.stringify(scalar)} (${expected.since})`);
        assert.equal(rules.normalizeSharedName(scalar), expected.js, `JS key for ${JSON.stringify(scalar)} (${expected.since})`);
        // The divergence is real, not a stale expectation that happens to match.
        assert.notEqual(expected.pg, expected.js, `${JSON.stringify(scalar)} must be an actual divergence`);
        // The sweep-time guard must still fire: exclusion and assertion agree.
        const swept = UNICODE_VERSION_BOUNDARY.has(scalar) && row.key !== rules.normalizeSharedName(scalar);
        assert.ok(swept, `${JSON.stringify(scalar)} (${expected.ahead}) is still excluded from the exhaustive sweep`);
      }
    });

    await t.test('real constraints, RLS flags, triggers, FK and sequence dependencies are schema local', async () => {
      const tables = await sql`select c.relname,c.relrowsecurity,c.relowner=current_user::regrole as owned from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='r' order by c.relname`;
      assert.equal(tables.length, f.manifest.initialRows && Object.keys(f.manifest.initialRows).length);
      assert.ok(tables.every(row => row.relrowsecurity && row.owned));
      // The owner intentionally bypasses RLS. Catalogue flag proof is NOT an
      // authenticated/non-owner access test; no role/grant creation is approved.
      assert.equal((await sql`select count(*)::int n from pg_policies where schemaname=${SCHEMA}`)[0].n, 0);
      const fks = await sql`select cn.nspname as child,pn.nspname as parent from pg_constraint c join pg_class ch on ch.oid=c.conrelid join pg_namespace cn on cn.oid=ch.relnamespace join pg_class p on p.oid=c.confrelid join pg_namespace pn on pn.oid=p.relnamespace where c.contype='f' and cn.nspname=${SCHEMA}`;
      assert.ok(fks.length > 10); assert.ok(fks.every(row => row.child === SCHEMA && row.parent === SCHEMA));
      const triggerTargets = await sql`select p.proname,n.nspname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace cn on cn.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where cn.nspname=${SCHEMA} and not t.tgisinternal`;
      assert.ok(triggerTargets.some(row => row.proname === 'protect_variant_colour_reference'));
      assert.ok(triggerTargets.every(row => row.nspname === SCHEMA));
      const sequenceDefaults = await sql`select sn.nspname from pg_attrdef a join pg_class c on c.oid=a.adrelid join pg_namespace n on n.oid=c.relnamespace join pg_depend d on d.classid='pg_attrdef'::regclass and d.objid=a.oid join pg_class s on s.oid=d.refobjid and s.relkind='S' join pg_namespace sn on sn.oid=s.relnamespace where n.nspname=${SCHEMA}`;
      assert.equal(sequenceDefaults.length,1); assert.equal(sequenceDefaults[0].nspname,SCHEMA);
      const beforeLinks = await revisions();
      await f.operation('colour links seed', async tx => {
        await tx`insert into colours(id,name,hex,is_active) values ('c1','Ocean','#111111',false),('c2','Desert','#222222',true)`;
        await tx`insert into product_variant_colours(variant_id,product_id,colour_id) values ('v1','p1','c1'),('v2','p2','c1')`;
      });
      await assertAdvanced(beforeLinks);
      const attempts = [
        ['brand normalized duplicate', '23505', tx => tx`insert into device_brands(id,name,is_active) values ('bad','Ａcme',false)`],
        ['model scoped duplicate', '23505', tx => tx`insert into device_models(id,brand_id,name,is_active) values ('bad','b1','Le—gacy',false)`],
        ['model missing brand', '23503', tx => tx`insert into device_models(id,brand_id,name) values ('bad','absent','Unknown')`],
        ['colour normalized duplicate', '23505', tx => tx`insert into colours(id,name,hex) values ('bad','Ｏcean','#333333')`],
        ['colour hex duplicate', '23505', tx => tx`insert into colours(id,name,hex) values ('bad','Unique','#111111')`],
        ['colour invalid hex', '23514', tx => tx`insert into colours(id,name,hex) values ('bad','Unique','#abcdef')`],
        ['link wrong parent', '23503', tx => tx`insert into product_variant_colours(variant_id,product_id,colour_id) values ('v3','p2','c1')`],
        ['link missing colour', '23503', tx => tx`insert into product_variant_colours(variant_id,product_id,colour_id) values ('v3','p1','absent')`],
        ['link missing product', '23503', tx => tx`insert into product_variant_colours(variant_id,product_id,colour_id) values ('v3','absent','c1')`],
        ['link duplicate variant', '23505', tx => tx`insert into product_variant_colours(variant_id,product_id,colour_id) values ('v1','p1','c2')`],
        ['immutable link update', '23514', tx => tx`update product_variant_colours set colour_id='c2' where variant_id='v1'`],
        ['immutable link delete', '23514', tx => tx`delete from product_variant_colours where variant_id='v2'`],
      ];
      const before = await revisions();
      for (const [name,code,run] of attempts) await f.operation(name, run, sqlCode(code));
      assert.deepEqual(await revisions(), before);
    });

    await t.test('real transaction services: import, audit, noop, near confirmation, rollback', async () => {
      const raw = colourInput('Glacier #345678');
      let approved = await preview(raw);
      await f.operation('colour import', async tx => { const result = await apply(tx, raw, approved.token); assert.equal(result.created,1); });
      approved = await preview(raw);
      await f.operation('repeated import audited noop', async tx => { const result = await apply(tx, raw, approved.token); assert.equal(result.created,0); assert.equal(result.noop,true); });
      const near = colourInput('Oceam #456789'); const nearPreview = await preview(near);
      assert.equal(nearPreview.plan.counts.near,1);
      await f.operation('near match unacknowledged', tx => apply(tx,near,nearPreview.token), error => error.status === 409);
      await f.operation('near match acknowledged', async tx => { assert.equal((await apply(tx,near,nearPreview.token,[1])).created,1); });
      const model = { kind: 'models', format: 'paste', brandId: 'b1', text: 'Future device' }; const modelPreview = await preview(model);
      await f.operation('model import', async tx => { assert.equal((await apply(tx,model,modelPreview.token)).created,1); });
      const failing = colourInput('Will rollback #567890'); const failPreview = await preview(failing);
      await f.operation('strict audit failure', async tx => {
        await tx.unsafe(`create function fixture_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture rejects audit' using errcode='23514'; end $$; create trigger fixture_reject_audit before insert on store_admin_audit for each row execute function fixture_reject_audit();`);
        await apply(tx,failing,failPreview.token);
      }, /audit could not be saved/);
      await f.operation('caller rollback', tx => apply(tx,failing,failPreview.token));
      const rows = await sql`select action,before,after,actor_email,ip_hash,user_agent_hash from store_admin_audit order by id`;
      assert.equal(rows.length,4);
      assert.ok(rows.every(row => row.actor_email === '' && /^[a-f0-9]{64}$/.test(row.ip_hash) && /^[a-f0-9]{64}$/.test(row.user_agent_hash)));
      assert.doesNotMatch(JSON.stringify(rows), /Glacier|Oceam|Future device|192\.0\.2\.1|#345678/);
    });

    await t.test('colour fanout revisions, timestamp/identical noops, retired preservation, immutable audit', async () => {
      const value = { id: 'c1', name: 'Ocean renamed', hex: '#111111', isActive: true };
      let before = await revisions();
      await f.operation('colour edit fanout', tx => service.saveSharedReferenceUsing(tx,'colours',value,owner,request));
      await assertAdvanced(before);
      before = await revisions();
      await f.operation('reference identical save noop', tx => service.saveSharedReferenceUsing(tx,'colours',value,owner,request));
      assert.deepEqual(await revisions(),before);
      await f.operation('timestamp only noop', tx => tx`update colours set updated_at=now() where id='c1'`);
      assert.deepEqual(await revisions(),before);
      await f.operation('colour deactivate retains retired variant', tx => service.saveSharedReferenceUsing(tx,'colours',{ ...value, isActive: false, confirmDeactivation: true },owner,request));
      await assertAdvanced(before);
      assert.deepEqual(await sql`select * from product_variants order by id`,identities);
      assert.equal((await sql`select colour_id from product_variant_colours where variant_id='v2'`)[0].colour_id,'c1');
      before = await revisions();
      await f.operation('model deactivate retains retired variant', tx => service.saveSharedReferenceUsing(tx,'models',{ id: 'm2', name: 'Legacy', brandId: 'b2', isActive: false, confirmDeactivation: true },owner,request));
      assert.deepEqual(await revisions(),before.map(row => ({ ...row, revision: row.revision + (row.id === 'p2' ? 1 : 0) })));
      assert.deepEqual(await sql`select * from product_variants order by id`,identities);
      await f.operation('immutable audit update', tx => tx`update store_admin_audit set reason='not allowed'`, sqlCode('23514'));
      await f.operation('immutable audit delete', tx => tx`delete from store_admin_audit`, sqlCode('23514'));
    });

    if (f.manifest.race) await t.test('exactly two simultaneous duplicate imports: one commit, one stale rejection, one audit', async () => {
      const raw = colourInput('Race unique #678901'); const approved = await preview(raw);
      await f.operation('two concurrent duplicate imports', async () => {
        let arrived = 0, release;
        const barrier = new Promise(resolve => { release = resolve; });
        const timer = setTimeout(release, 4000);
        const pids = [];
        try {
          const run = () => sql.begin(async tx => {
            pids.push((await tx`select pg_backend_pid() as pid`)[0].pid);
            if (++arrived === 2) release();
            await barrier;
            assert.equal(arrived,2,'Both bounded race transactions must arrive');
            return apply(tx,raw,approved.token);
          });
          const results = await Promise.allSettled([run(),run()]);
          assert.equal(new Set(pids).size,2,'Race uses exactly two distinct simultaneous backends');
          assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
          const failed = results.find(result => result.status === 'rejected');
          assert.equal(failed?.reason.status,409);
          assert.match(failed.reason.message,/catalogue changed/);
        } finally { clearTimeout(timer); }
      });
    });
    await f.assertCounts();
  } finally { await f.close(); }
});
