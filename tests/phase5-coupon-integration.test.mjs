import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
import { ROOT, SCHEMA, TABLES, openPhase5Fixture, phase5Manifest } from './helpers/phase5-fixture.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(ROOT, 'src') } });
const skip = process.env.RUN_PHASE5_DB_TESTS !== '1' ? 'Phase5 SQL writes require separate hostname/count/manifest approval' : false;

test('Phase5 fixture refuses connections without write approval', async () => {
  if (process.env.RUN_PHASE5_DB_TESTS === '1') return;
  await assert.rejects(openPhase5Fixture, /separate approval/);
});
test('Phase5 manifest declares isolated rows and binds sources', async () => {
  const manifest = await phase5Manifest('postgres://synthetic:synthetic@example.invalid:5432/synthetic');
  assert.equal(manifest.publicTableWrites, 0);
  assert.equal(manifest.publicSequenceAdvances, 0);
  assert.equal(manifest.maximumConnections, 1);
  assert.deepEqual(manifest.schemas, [SCHEMA]);
  assert.match(manifest.approvalSha256, /^[a-f0-9]{64}$/);
});

test('Phase5 actual migration, customer isolation and atomically audited administration', { skip }, async t => {
  const fixture = await openPhase5Fixture();
  const { sql } = fixture;
  try {
    const admin = await jiti.import(path.join(ROOT, 'src/lib/store-admin/coupons.ts'));
    const { parseCouponInput } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/coupon-rules.ts'));
    const customer = await jiti.import(path.join(ROOT, 'src/lib/account/coupons.ts'));
    const actor = { actorId: null, actorEmail: 'staff@example.invalid', request: new Request('https://example.invalid/api/store-admin/coupons') };
    const options = { sql };
    const loadSettings = async () => ({ ok: true, settings: { coupons_enabled: (await sql`select value from store_settings where key = 'coupons_enabled'`)[0]?.value } });
    const values = (patch = {}) => {
      const parsed = parseCouponInput({ code: 'CREATED5', name: 'Internal fixture name', type: 'PERCENT', value: '10', scope: 'ORDER', ...patch });
      assert.equal(parsed.ok, true, parsed.error);
      return parsed.values;
    };
    await t.test('migration defaults old rows hidden and rerun preserves opt-in', async () => {
      await fixture.applyVisibility();
      const [legacy] = await sql`select show_to_all_users,assigned_to_emails,assigned_customer_groups from coupons where id = 'legacy'`;
      assert.deepEqual(legacy, { show_to_all_users: false, assigned_to_emails: [], assigned_customer_groups: [] });
      await sql`insert into users values ('a','a@example.invalid','retail'),('b','b@example.invalid','vip')`;
      await sql`insert into orders(id,txnid,status,user_id,customer_email) values ('oa','OA','PENDING','a','a@example.invalid'),('ob','OB','PENDING','b','b@example.invalid')`;
      await sql`insert into store_settings values ('coupons_enabled','on')`;
      await sql`insert into coupons(id,code,type,value,show_to_all_users,assigned_to_emails,assigned_customer_groups,restricted_to_emails,allowed_customer_groups,ends_at,total_redemption_limit,per_customer_limit) values
        ('public','PUBLIC5','PERCENT',10,true,'{}','{}',null,null,null,3,2),
        ('email','EMAIL5','FIXED',500,false,ARRAY['a@example.invalid'],'{}',null,null,null,null,null),
        ('group','GROUP5','FREE_SHIPPING',0,false,'{}',ARRAY['vip'],null,null,null,null,null),
        ('blocked','BLOCKED5','PERCENT',10,true,'{}','{}',ARRAY['a@example.invalid'],ARRAY['vip'],null,null,null),
        ('expired','EXPIRED5','PERCENT',10,true,'{}','{}',null,null,now()-interval '1 second',null,null)`;
      await fixture.applyVisibility();
      assert.equal((await sql`select show_to_all_users from coupons where id = 'public'`)[0].show_to_all_users, true);
      await sql`insert into coupon_redemptions(coupon_id,order_id,customer_user_id,customer_email,state) values ('public','oa','a','a@example.invalid','RESERVED'),('public','ob','b','b@example.invalid','CONSUMED')`;
      const rls = await sql`select relname,relrowsecurity from pg_class where relnamespace = ${SCHEMA}::regnamespace and relkind = 'r'`;
      assert.equal(rls.length, TABLES.length);
      assert.ok(rls.every(row => row.relrowsecurity));
    });
    await t.test('real customer queries isolate assignments and return only safe personal details', async () => {
      const a = await customer.listCustomerCouponsUsing(sql, 'a', loadSettings);
      const b = await customer.listCustomerCouponsUsing(sql, 'b', loadSettings);
      assert.deepEqual(a.map(row => row.code).sort(), ['EMAIL5','PUBLIC5']);
      assert.deepEqual(b.map(row => row.code).sort(), ['GROUP5','PUBLIC5']);
      assert.equal(a.find(row => row.code === 'PUBLIC5').remainingUses, 1);
      assert.equal(a.find(row => row.code === 'PUBLIC5').valueDisplay, '10% off');
      assert.equal(await customer.getCustomerCouponCountUsing(sql, 'a', loadSettings), a.length);
      assert.deepEqual(await customer.listCustomerCouponsUsing(sql, 'missing', loadSettings), []);
      assert.deepEqual(await customer.listCustomerCouponsUsing(sql, 'a', async () => ({ ok: true, settings: { coupons_enabled: 'off' } })), []);
      const allowed = ['id','code','valueDisplay','scopeDisplay','minOrderPaise','minOrderDisplay','expiresAt','expiryDisplay','remainingUses','remainingDisplay'].sort();
      for (const row of [...a,...b]) assert.deepEqual(Object.keys(row).sort(), allowed);
    });
    let createdId;
    await t.test('admin create/update preserve omitted visibility and audit assignments by count', async () => {
      const created = await admin.createCoupon(values({ showToAllUsers: true, assignedToEmails: ['a@example.invalid'] }), actor, options);
      assert.equal(created.ok, true, created.error); createdId = created.data.id;
      const omitted = parseCouponInput({ code: 'CREATED5', name: 'Changed internal name', type: 'PERCENT', value: '10', scope: 'ORDER' }, { preserveOmittedVisibility: true });
      assert.equal(omitted.ok, true);
      const updated = await admin.updateCoupon(createdId, omitted.values, actor, options);
      assert.equal(updated.ok, true, updated.error);
      assert.equal(updated.data.after.showToAllUsers, true);
      assert.deepEqual(updated.data.after.assignedToEmails, ['a@example.invalid']);
    });
    await t.test('selected bulk visibility is atomic, filterable and audited', async () => {
      for (const showToAllUsers of [false,true]) {
        const result = await admin.setCouponsVisibility({ ids: [createdId,'public'], showToAllUsers }, actor, options);
        assert.equal(result.ok, true, result.error);
      }
      const list = await admin.listCoupons({ visibility: 'public' }, options);
      assert.equal(list.ok, true, list.error);
      assert.ok(list.data.rows.every(row => row.showToAllUsers));
      const missing = await admin.setCouponsVisibility({ ids: [createdId,'missing'], showToAllUsers: false }, actor, options);
      assert.equal(missing.ok, false);
      assert.equal((await sql`select show_to_all_users from coupons where id = ${createdId}`)[0].show_to_all_users, true);
    });
    await t.test('duplicate and generated coupons have explicit safe defaults', async () => {
      const duplicate = await admin.duplicateCoupon(createdId, actor, options);
      assert.equal(duplicate.ok, true, duplicate.error);
      assert.equal(duplicate.data.status, 'paused');
      assert.equal(duplicate.data.showToAllUsers, false);
      assert.deepEqual(duplicate.data.assignedToEmails, []);
      const generated = await admin.bulkGenerateCoupons({ count: 2, prefix: 'PH5', length: 8, values: values() }, actor, options);
      assert.equal(generated.ok, true, generated.error);
      assert.equal(generated.data.ids.length, 2);
      const rows = await sql`select show_to_all_users from coupons where id in ${sql(generated.data.ids)}`;
      assert.ok(rows.every(row => row.show_to_all_users === false));
    });
    await t.test('audit failures roll back create, update and selected bulk writes', async () => {
      const failing = { sql, audit: async () => false };
      assert.equal((await admin.createCoupon(values({ code: 'ROLLBACK5' }), actor, failing)).ok, false);
      assert.equal((await admin.updateCoupon(createdId, values({ showToAllUsers: false }), actor, failing)).ok, false);
      assert.equal((await admin.setCouponsVisibility({ ids: [createdId,'public'], showToAllUsers: false }, actor, failing)).ok, false);
      assert.equal((await sql`select count(*)::int as n from coupons where code = 'ROLLBACK5'`)[0].n, 0);
      assert.ok((await sql`select show_to_all_users from coupons where id in ${sql([createdId,'public'])}`).every(row => row.show_to_all_users));
      const audit = await sql`select before,after from store_admin_audit`;
      assert.equal(audit.length, fixture.manifest.committedInserts.store_admin_audit);
      const serialized = JSON.stringify(audit);
      assert.ok(!serialized.includes('a@example.invalid'));
      assert.ok(!serialized.includes('staff@example.invalid'));
      for (const [table,count] of Object.entries(fixture.manifest.committedInserts)) {
        assert.equal((await sql.unsafe(`select count(*)::int as n from "${SCHEMA}"."${table}"`))[0].n, count, table);
      }
      for (const [sequence,count] of Object.entries(fixture.manifest.sequenceAdvances)) {
        const [state] = await sql.unsafe(`select last_value,is_called from "${SCHEMA}"."${sequence}"`);
        assert.equal(state.is_called ? Number(state.last_value) : 0, count, sequence);
      }
    });
  } finally { await fixture.close(); }
});
