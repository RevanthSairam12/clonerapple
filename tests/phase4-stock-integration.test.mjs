/** Real SQL proof only after separate source-bound write approval. No env auto-load. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
import { ROOT, SCHEMA, TABLES, openPhase4Fixture } from './helpers/phase4-fixture.mjs';

const skip = process.env.RUN_PHASE4_DB_TESTS !== '1' ? 'Phase4 SQL writes require separate manifest approval; not SQL proof' : false;

test('Phase4 actual migration and injected stock helpers in owned schema', { skip, concurrency: false }, async () => {
  const fixture = await openPhase4Fixture();
  const { sql } = fixture;
  try {
    const jiti = createJiti(import.meta.url, { alias: { '@': path.join(ROOT, 'src') } });
    const engine = await jiti.import(path.join(ROOT, 'src/lib/payu/stock.ts'));
    const { planStockClaim } = await jiti.import(path.join(ROOT, 'src/lib/checkout/stock-rules.ts'));
    const line = (variantId, quantity = 1) => ({ productId: 'p', variantId, quantity });
    const a = line('a'), b = line('b');
    const operation = (name, callback) => fixture.operation(name, callback);
    const transaction = callback => fixture.transaction(callback);
    const stock = async (id, client = sql) => {
      const [row] = await client`select on_hand,reserved,track_inventory from stock where id=${id}`;
      return row;
    };
    const claim = async (tx, orderId, lines) => {
      // Match the engine's caller contract: existing order before exact stock locks.
      await tx`select id from orders where id=${orderId} for update`;
      const rows = await engine.lockStockIdentities(tx, lines);
      const plan = planStockClaim(lines, rows);
      assert.equal(plan.ok, true);
      await engine.claimPlannedStock(tx, orderId, plan.claims);
    };
    await operation('seed', () => transaction(async tx => {
      await tx`insert into products(id,inventory_mode) values ('p','variant'),('legacy','product'),('untracked','product')`;
      await tx`insert into device_models(id) values ('device')`;
      await tx`insert into product_variants(id,product_id,sku,is_purchasable,combination_key,device_model_id) values ('a','p','SKU-A',true,'a','device'),('b','p','SKU-B',true,'b','device'),('race','p','SKU-RACE',true,'race','device'),('free','p','SKU-FREE',true,'free','device'),('missing','p','SKU-MISSING',true,'missing','device')`;
      await tx`insert into orders(id) values ('lifecycle'),('race1'),('race2'),('sibling1'),('sibling2'),('returns'),('legacy'),('rollback'),('failed'),('spare')`;
      await tx`insert into order_items(order_id,product_id,variant_id) values ('lifecycle','p','a'),('lifecycle','p','b')`;
      await tx`insert into stock(id,product_id,variant_id,on_hand,track_inventory) values ('a','p','a',4,true),('b','p','b',4,true),('race','p','race',1,true),('parent','p',null,9,true),('legacy','legacy',null,7,true),('free','p','free',0,false)`;
    }));

    const definition = () => sql`select c.relname,k.conname,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} order by c.relname,k.conname`;
    const beforeMigrationRepeat = [...await definition()];
    await operation('migration repeat', () => fixture.migration());
    assert.deepEqual([...await definition()], beforeMigrationRepeat);
    const tables = await sql`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='r'`;
    assert.deepEqual(tables.map(row => row.relname).sort(), [...TABLES].sort());
    assert.ok(tables.every(row => row.relrowsecurity));
    assert.equal((await sql`select count(*)::int n from pg_policies where schemaname=${SCHEMA}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int n from pg_constraint k join pg_class a on a.oid=k.conrelid join pg_namespace an on an.oid=a.relnamespace join pg_class b on b.oid=k.confrelid join pg_namespace bn on bn.oid=b.relnamespace where k.contype='f' and an.nspname=${SCHEMA} and bn.nspname<>${SCHEMA}`)[0].n, 0);
    const sequenceOwners = await sql`select s.relname,t.relname as owner from pg_class s join pg_namespace n on n.oid=s.relnamespace join pg_depend d on d.objid=s.oid and d.deptype='a' join pg_class t on t.oid=d.refobjid where n.nspname=${SCHEMA} and s.relkind='S'`;
    assert.deepEqual(sequenceOwners.map(row => [row.relname, row.owner]).sort(), [['order_items_id_seq', 'order_items'], ['stock_movements_id_seq', 'stock_movements']]);
    const defaults = await sql`select column_default from information_schema.columns where table_schema=${SCHEMA} and column_default like 'nextval(%'`;
    assert.equal(defaults.length, 2);
    for (const row of defaults) assert.doesNotMatch(row.column_default, /public\./);

    await operation('claim two variants', () => transaction(tx => claim(tx, 'lifecycle', [b, line('a', 2)])));
    assert.equal((await stock('a')).on_hand, 2); assert.equal((await stock('b')).on_hand, 3);
    await operation('release two variants', () => transaction(async tx => assert.equal(await engine.releaseClaimedStock(tx, 'lifecycle'), true)));
    await operation('duplicate release', () => transaction(async tx => assert.equal(await engine.releaseClaimedStock(tx, 'lifecycle'), false)));
    await operation('late reclaim two variants', () => transaction(async tx => {
      const released = await engine.releasedClaimLines(tx, 'lifecycle');
      assert.deepEqual(released, [line('a', 2), b]);
      assert.equal((await engine.reclaimReleasedStock(tx, 'lifecycle', [...released].reverse())).ok, true);
    }));
    await operation('return two variants', () => transaction(async tx => assert.deepEqual(await engine.restoreSoldStock(tx, 'lifecycle', [b, a]), [a, b])));
    await operation('cap remaining return', () => transaction(async tx => assert.deepEqual(await engine.restoreSoldStock(tx, 'lifecycle', [line('a', 99), line('b', 99)]), [a])));
    await operation('settled release no-op', () => transaction(async tx => assert.equal(await engine.releaseClaimedStock(tx, 'lifecycle'), false)));
    assert.equal((await stock('a')).on_hand, 4); assert.equal((await stock('b')).on_hand, 4);

    await operation('same variant race', async () => {
      let arrivals = 0, release;
      const ready = new Promise(resolve => { release = resolve; });
      const pids = new Set();
      const contenders = ['race1', 'race2'].map(orderId => transaction(async tx => {
        const [session] = await tx`select pg_backend_pid() as pid,current_setting('search_path') as path`;
        assert.equal(session.path, SCHEMA); pids.add(session.pid);
        if (++arrivals === 2) release();
        await ready;
        await tx`select id from orders where id=${orderId} for update`;
        await engine.lockStockIdentities(tx, [line('race')]);
        // Exercise the guarded engine UPDATE on both contenders, not a mock planner rejection.
        await engine.claimPlannedStock(tx, orderId, [line('race')]);
      }));
      const results = await Promise.allSettled(contenders);
      assert.equal(pids.size, 2, 'Actual independent SQL sessions must contend');
      assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
      const loser = results.find(item => item.status === 'rejected');
      assert.ok(loser.reason instanceof engine.InsufficientStockError);
    });
    assert.equal((await stock('race')).on_hand, 0);

    await operation('independent sibling race', async () => {
      let locked, siblingFinished;
      const hasLock = new Promise(resolve => { locked = resolve; });
      const finished = new Promise(resolve => { siblingFinished = resolve; });
      let timer;
      try {
        await Promise.all([
          transaction(async tx => {
            await claim(tx, 'sibling1', [a]); locked();
            // B must commit while A's row lock is still held. A parent/sibling
            // lock regression times out rather than passing after serialization.
            await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sibling variant was blocked')), 5000); })]);
          }),
          (async () => { await hasLock; await transaction(tx => claim(tx, 'sibling2', [b])); siblingFinished(); })(),
        ]);
      } finally { clearTimeout(timer); }
    });
    await operation('claim for concurrent returns', () => transaction(tx => claim(tx, 'returns', [line('a', 2)])));
    await operation('concurrent capped returns', async () => {
      let arrivals = 0, release;
      const ready = new Promise(resolve => { release = resolve; });
      const results = await Promise.all([1, 2].map(() => transaction(async tx => {
        await tx`select pg_backend_pid()`;
        if (++arrivals === 2) release();
        await ready;
        return engine.restoreSoldStock(tx, 'returns', [line('a', 99)]);
      })));
      assert.deepEqual(results.map(lines => lines.reduce((n, item) => n + item.quantity, 0)).sort(), [0, 2]);
    });
    await operation('legacy claim', () => transaction(tx => claim(tx, 'legacy', [{ productId: 'legacy', quantity: 2 }])));
    await operation('legacy release', () => transaction(tx => engine.releaseClaimedStock(tx, 'legacy')));
    assert.equal((await stock('legacy')).on_hand, 7);
    assert.equal((await stock('parent')).on_hand, 9, 'Retained parent bucket never funds a variant');
    await operation('caller rollback', () => assert.rejects(transaction(async tx => {
      await claim(tx, 'rollback', [b, a]);
      throw new Error('intentional phase4 rollback');
    }), /intentional phase4 rollback/));
    assert.equal((await stock('a')).on_hand, 3); assert.equal((await stock('b')).on_hand, 3);

    await operation('claim before failed reclaim', () => transaction(tx => claim(tx, 'failed', [b, a])));
    await operation('release before failed reclaim', () => transaction(tx => engine.releaseClaimedStock(tx, 'failed')));
    await operation('reserve competing units', () => transaction(tx => tx`update stock set reserved=3 where id='b'`));
    await operation('late reclaim all-or-none refusal', () => transaction(async tx => {
      assert.equal((await engine.reclaimReleasedStock(tx, 'failed', [a, b])).ok, false);
    }));
    assert.equal((await stock('a')).on_hand, 3, 'Failed later key must not partially reclaim earlier key');
    assert.equal((await stock('b')).on_hand, 3);
    await operation('clear competing reservation', () => transaction(tx => tx`update stock set reserved=0 where id='b'`));
    await operation('untracked and missing plans', () => transaction(async tx => {
      await claim(tx, 'spare', [line('free', 100), { productId: 'untracked', quantity: 100 }]);
      assert.equal(planStockClaim([line('missing')], await engine.lockStockIdentities(tx, [line('missing')])).ok, false);
      assert.equal(planStockClaim([line('a', 4)], await engine.lockStockIdentities(tx, [a])).ok, false);
    }));
    const reject = (name, callback, pattern) => operation(name, () => assert.rejects(transaction(callback), pattern));
    await reject('reject stock owner', tx => tx`insert into stock(id,product_id,variant_id) values ('wrong','legacy','a')`, /stock_variant_owner/);
    await reject('reject movement owner', tx => tx`insert into stock_movements(product_id,variant_id,delta,reason,order_id) values ('legacy','a',1,'return','legacy')`, /movement_variant_owner/);
    await reject('reject order item owner', tx => tx`insert into order_items(order_id,product_id,variant_id) values ('legacy','legacy','a')`, /order_item_variant_owner/);
    await reject('reject movement update', tx => tx`update stock_movements set delta=0 where id=(select min(id) from stock_movements)`, /stock movements are immutable/);
    await reject('reject movement delete', tx => tx`delete from stock_movements where id=(select min(id) from stock_movements)`, /stock movements are immutable/);
    await reject('reject negative stock', tx => tx`update stock set on_hand=-1 where id='a'`, /check constraint/);
    await reject('reject empty commerce identity', tx => tx`insert into product_variants(id,product_id,is_purchasable,combination_key) values ('bad','p',true,'bad')`, /variant_commerce_identity/);
    await reject('reject duplicate commerce combination', tx => tx`insert into product_variants(id,product_id,sku,is_purchasable,combination_key) values ('duplicate','p','SKU-DUPLICATE',true,'a')`, /idx_variants_commerce_combination/);
    await reject('reject invalid inventory mode', tx => tx`update products set inventory_mode='invalid' where id='legacy'`, /check constraint/);
    assert.equal((await stock('free')).on_hand, 0);
    assert.equal((await sql`select count(*)::int n from stock where on_hand<0 or reserved>on_hand`)[0].n, 0);
    assert.deepEqual([...await sql`select id,inventory_mode from products order by id`], [{ id: 'legacy', inventory_mode: 'product' }, { id: 'p', inventory_mode: 'variant' }, { id: 'untracked', inventory_mode: 'product' }]);
    await fixture.assertCounts();
  } finally { await fixture.close(); }
});
