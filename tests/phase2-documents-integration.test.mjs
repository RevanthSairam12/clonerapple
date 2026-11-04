/**
 * Real Phase2 transactions; disabled by default and never reads .env files.
 * Preflight only: node scripts/phase2-test-manifest.mjs
 * Execution requires separate write approval, RUN_PHASE2_DB_TESTS=1 and the
 * exact PHASE2_APPROVED_MANIFEST digest. Do not run before that approval.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { spawnSync } from 'node:child_process';
import { ROOT, SCHEMA, TABLES, phase2Manifest, openPhase2Fixture, assertPhase2Counts } from './helpers/phase2-fixture.mjs';

const skip = process.env.RUN_PHASE2_DB_TESTS !== '1' ? 'Phase2 database writes require explicit manifest approval' : false;

test('Phase2 fixture manifest is deterministic, isolated and contains all write counts (no DB)', async () => {
  const first = await phase2Manifest('postgres://fixture:withheld@fixture.example.test/test');
  assert.deepEqual(first, await phase2Manifest('postgres://fixture:withheld@fixture.example.test/test'));
  assert.equal(first.hostname, 'fixture.example.test');
  assert.equal(JSON.stringify(first).includes('withheld'), false);
  assert.equal(first.publicTableWrites, 0);
  assert.equal(first.publicSequenceAdvances, 0);
  assert.deepEqual(first.schemas, [SCHEMA]);
  assert.deepEqual(Object.keys(first.committedInserts).sort(), [...TABLES].sort());
  const helper = await readFile(path.join(ROOT, 'tests/helpers/phase2-fixture.mjs'), 'utf8');
  assert.doesNotMatch(helper, /like\s+public\./i);
  assert.doesNotMatch(helper, /readFile\([^\n]*\.env/);
  assert.match(helper, /PHASE2_APPROVED_MANIFEST/);
  const keys = ['RUN_PHASE2_DB_TESTS', 'PHASE2_APPROVED_MANIFEST', 'DATABASE_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.RUN_PHASE2_DB_TESTS = '1';
    process.env.DATABASE_URL = 'postgres://fixture:withheld@fixture.example.test/test';
    process.env.PHASE2_APPROVED_MANIFEST = 'not-approved';
    // Fails before the dynamic postgres import/client constructor, even with
    // RUN_PHASE2_DB_TESTS accidentally enabled and a URL present.
    await assert.rejects(openPhase2Fixture(), /Generate and approve the exact Phase2 write manifest/);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test('Phase A aggregate preflight safely describes fresh approval without importing a DB client', () => {
  const env = { ...process.env, DATABASE_URL: 'postgres://fixture:withheld@fixture.example.test/test' };
  const run = spawnSync(process.execPath, [path.join(ROOT,'scripts/phase-a-test-manifest.mjs')], {env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.doesNotMatch(run.stdout,/withheld|postgres:\/\//);
  const manifest = JSON.parse(run.stdout);
  assert.equal(manifest.hostname,'fixture.example.test');
  assert.equal(manifest.maximumConnections,2);
  assert.equal(manifest.publicTableWrites,0);
  assert.equal(manifest.publicSequenceAdvances,0);
  assert.equal(manifest.suites.length,3);
  assert.match(manifest.approvalSha256,/^[a-f0-9]{64}$/);
  assert.equal(manifest.suites[0].manifest.committedInserts.bill_requests,1);
  assert.equal(manifest.suites[1].sequences.expectedTotal,38);
  assert.equal(manifest.suites[2].sequences.expectedTotal,37);
  const again = spawnSync(process.execPath, [path.join(ROOT,'scripts/phase-a-test-manifest.mjs')], {env,encoding:'utf8'});
  assert.equal(again.stdout,run.stdout);
});

test('Phase2 invoice, retired bill request and refund transactions in approved private schema', { skip, concurrency: false }, async t => {
  const jiti = createJiti(import.meta.url, { alias: { '@': path.join(ROOT, 'src') } });
  // No app pool/global replacement: every operation receives our pinned client.
  const { ensureInvoiceIssuedInTx } = await jiti.import(path.join(ROOT, 'src/lib/orders/invoice.ts'));
  const { requestBillUsing, BillRequestError } = await jiti.import(path.join(ROOT, 'src/lib/account/bill-requests.ts'));
  const { initiateRefundUsing, resolveRefundRequestUsing } = await jiti.import(path.join(ROOT, 'src/lib/store-admin/refund-lifecycle.ts'));
  const { getDocumentStateUsing, getCustomerDocumentStateUsing } = await jiti.import(path.join(ROOT, 'src/lib/orders/document-data.ts'));
  const fixture = await openPhase2Fixture();
  const { sql } = fixture;
  const issue = (client, id) => client.begin(tx => ensureInvoiceIssuedInTx(tx, id, 'phase2_owner'));
  const start = (client, txnid, amountPaise, extra = {}) => initiateRefundUsing(client, { txnid, amountPaise, method: 'cash', actorId: 'phase2_owner', ...extra });
  const finish = (client, txnid, requestId, status = 'COMPLETED', providerRef = 'fixture-reference') => resolveRefundRequestUsing(client, { txnid, requestId, status, providerRef, actorId: 'phase2_owner' });
  const count = async table => (await sql.unsafe(`select count(*)::int as n from "${table}"`))[0].n;
  const denyBill = (user, txnid, reason, status) => assert.rejects(requestBillUsing(sql, user, txnid, reason), error => error instanceof BillRequestError && error.status === status);
  try {
    await t.test('migration RLS, policies, FKs and sequence defaults are schema-local', async () => {
      const rows = await sql`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${SCHEMA} and c.relkind='r'`;
      assert.equal(rows.length, TABLES.length);
      assert.ok(rows.every(row => row.relrowsecurity));
      assert.equal((await sql`select count(*)::int n from pg_policies where schemaname=${SCHEMA}`)[0].n, 0);
      const crossSchema = await sql`select count(*)::int n from pg_constraint k join pg_class source on source.oid=k.conrelid join pg_namespace sn on sn.oid=source.relnamespace join pg_class target on target.oid=k.confrelid join pg_namespace tn on tn.oid=target.relnamespace where k.contype='f' and sn.nspname=${SCHEMA} and tn.nspname<>${SCHEMA}`;
      assert.equal(crossSchema[0].n, 0);
      const defaults = await sql`select column_default from information_schema.columns where table_schema=${SCHEMA} and column_default like 'nextval(%'`;
      assert.equal(defaults.length, 1);
      assert.doesNotMatch(defaults[0].column_default, /public\./);
    });
    await t.test('invoice strict audit failure rolls back counter and preserves historical requests', async () => {
      await sql.unsafe("alter table store_admin_audit add constraint fixture_reject_document_audit check(action not in ('order.invoice.issue','order.bill.request')) not valid");
      try {
        await assert.rejects(issue(sql, 'invoice_rollback'), /Invoice audit unavailable/);
        assert.equal(await count('bill_requests'), 1);
        assert.equal((await sql`select last_number::int n from invoice_number_counters`)[0].n, 0);
        assert.equal((await sql`select invoice_number from orders where id='invoice_rollback'`)[0].invoice_number, null);
      } finally { await sql.unsafe('alter table store_admin_audit drop constraint fixture_reject_document_audit'); }
    });
    await t.test('two independent sessions issue once for the same locked order', async () => {
      const issued = await fixture.race((one, two) => Promise.all([issue(one, 'invoice_same'), issue(two, 'invoice_same')]));
      assert.deepEqual(issued[0], issued[1]);
      assert.equal(issued[0].number, 'FIX000001');
      assert.equal(await count('store_admin_audit'), 2);
    });
    await t.test('different orders serialize the real counter without duplicate references', async () => {
      const issued = await fixture.race((one, two) => Promise.all([issue(one, 'invoice_a'), issue(two, 'invoice_b')]));
      assert.deepEqual(issued.map(row => row.number).sort(), ['FIX000002', 'FIX000003']);
      assert.notEqual(issued[0].number, issued[1].number);
    });
    await t.test('prefix edits and retries preserve number/date; trigger blocks identity changes', async () => {
      const prior = await issue(sql, 'invoice_same');
      await sql`update store_settings set value='NEW' where key='invoice_prefix'`;
      assert.deepEqual(await issue(sql, 'invoice_same'), prior);
      await assert.rejects(sql`update orders set invoice_number='renamed' where id='invoice_same'`, /immutable/);
      await assert.rejects(sql`update orders set invoice_sequence=999 where id='invoice_same'`, /immutable/);
      await assert.rejects(sql`update orders set invoice_issued_at=invoice_issued_at+interval '1 second' where id='invoice_same'`, /immutable/);
      await assert.rejects(sql`update invoice_number_counters set last_number=0`, /cannot decrease/);
      await assert.rejects(sql`delete from invoice_number_counters`, /permanent/);
    });
    await t.test('shipment failure rolls back invoice, counter, audit and shipment together', async () => {
      await assert.rejects(sql.begin(async tx => {
        await ensureInvoiceIssuedInTx(tx, 'invoice_rollback', 'phase2_owner');
        await tx`update orders set fulfilment_status='ON_THE_WAY' where id='invoice_rollback'`;
        throw new Error('fixture shipment failed');
      }), /fixture shipment failed/);
      const [order] = await sql`select invoice_number,fulfilment_status from orders where id='invoice_rollback'`;
      assert.equal(order.invoice_number, null); assert.equal(order.fulfilment_status, 'ACCEPTED');
      assert.equal((await sql`select last_number::int n from invoice_number_counters`)[0].n, 3);
      assert.equal(await count('store_admin_audit'), 4);
      // Same caller-owned transaction shape as the POS direct-delivered milestone.
      const issued = await sql.begin(async tx => {
        const invoice = await ensureInvoiceIssuedInTx(tx, 'invoice_pos', 'phase2_owner');
        await tx`update orders set fulfilment_status='DELIVERED' where id='invoice_pos'`;
        return invoice;
      });
      assert.equal(issued.number, 'NEW000004');
    });
    await t.test('retired requests enforce ownership and return 410 for every reason/state, including old requests', async () => {
      const before = await sql`select * from bill_requests`;
      const auditCount = await count('store_admin_audit');
      await denyBill('other_user', 'bill_reason', null, 404);
      await denyBill('bill_user', 'missing_order', null, 404);
      for (const id of ['bill_reason','bill_other','bill_inactive','bill_unpaid','bill_cancel','bill_shipped','bill_review']) {
        for (const reason of [null, {reasonId:'active'}, {reasonId:'inactive'}, {reasonId:'other',otherText:'x'.repeat(301)}]) {
          await denyBill('bill_user', id, reason, 410);
        }
      }
      const results = await fixture.race((one,two) => Promise.allSettled([
        requestBillUsing(one,'bill_user','bill_reason'), requestBillUsing(two,'bill_user','bill_reason'),
      ]));
      assert.ok(results.every(row => row.status==='rejected' && row.reason.status===410));
      for (let i=0;i<6;i++) await denyBill('throttle_user', `throttle_${i}`, null, 410);
      assert.deepEqual([...await sql`select * from bill_requests`], [...before]);
      assert.equal(await count('store_admin_audit'),auditCount);
      assert.equal((await getDocumentStateUsing(sql,'bill_reason')).kind,'provisional', 'staff historical access remains');
      const customer = await getCustomerDocumentStateUsing(sql,'bill_reason');
      assert.equal(customer.kind,'receipt'); assert.equal(customer.billRequested,false); assert.equal(customer.invoiceNumber,null);
      await assert.rejects(sql`update bill_requests set reason_label='mutated' where order_id='bill_reason'`, /immutable/);
      await assert.rejects(sql`delete from bill_requests where order_id='bill_reason'`, /immutable/);
    });
    await t.test('customer document reads never allocate identity and require delivered existing identity', async () => {
      const counter = (await sql`select last_number::int n from invoice_number_counters`)[0].n;
      const audits = await count('store_admin_audit');
      const issuedBeforeDelivery = await getCustomerDocumentStateUsing(sql,'invoice_same');
      assert.equal(issuedBeforeDelivery.kind,'receipt'); assert.equal(issuedBeforeDelivery.invoiceNumber,null);
      assert.equal((await getCustomerDocumentStateUsing(sql,'invoice_same','invoice')).canViewBill,false);
      const delivered = await getCustomerDocumentStateUsing(sql,'invoice_pos','invoice');
      assert.equal(delivered.kind,'invoice'); assert.equal(delivered.invoiceNumber,'NEW000004');
      for (const id of ['bill_unpaid','bill_review']) {
        const state = await getCustomerDocumentStateUsing(sql,id);
        assert.equal(state.kind,'status'); assert.equal(state.canViewReceipt,false); assert.equal(state.invoiceNumber,null);
      }
      assert.equal((await getCustomerDocumentStateUsing(sql,'bill_shipped','invoice')).canViewBill,false);
      assert.equal((await sql`select last_number::int n from invoice_number_counters`)[0].n,counter);
      assert.equal(await count('store_admin_audit'),audits);
    });
    await t.test('concurrent refund initiation reserves capture but has no completion side effects', async () => {
      const results = await fixture.race((one, two) => Promise.all([start(one, 'refund_race', 6000), start(two, 'refund_race', 6000)]));
      assert.equal(results.filter(row => row.ok).length, 1);
      assert.equal(results.find(row => !row.ok).reason, 'refund-exceeds-captured');
      const first = results.find(row => row.ok);
      assert.equal(await count('refunds'), 0); assert.equal(await count('refund_request_events'), 0);
      assert.equal((await sql`select state from coupon_redemptions`)[0].state, 'CONSUMED');
      assert.equal((await sql`select status from refund_obligations`)[0].status, 'PENDING');
      assert.equal((await getDocumentStateUsing(sql, 'refund_race')).label, 'Refund Initiated');
      assert.equal((await finish(sql, 'refund_race', first.requestId, 'COMPLETED', ' ')).ok, false);
      const completed = await fixture.race((one, two) => Promise.all([finish(one, 'refund_race', first.requestId), finish(two, 'refund_race', first.requestId)]));
      assert.ok(completed.every(row => row.ok));
      assert.equal(new Set(completed.map(row => row.refundId)).size, 1);
      assert.deepEqual(completed.map(row => row.duplicate).sort(), [false, true]);
      assert.equal((await getDocumentStateUsing(sql, 'refund_race')).label, 'Refund Successful — Partial');
      const second = await start(sql, 'refund_race', 4000); assert.equal(second.ok, true);
      assert.equal((await finish(sql, 'refund_race', second.requestId)).ok, true);
      const effects = async () => ({
        coupon: [...await sql`select state,released_at,release_reason from coupon_redemptions`],
        obligation: [...await sql`select status,refund_id,updated_at from refund_obligations`],
        refunds: await count('refunds'), events: await count('refund_request_events'), audits: await count('store_admin_audit'),
      });
      const beforeRetry = await effects();
      assert.equal((await finish(sql, 'refund_race', second.requestId)).duplicate, true);
      assert.deepEqual(await effects(), beforeRetry);
      assert.equal((await sql`select state from coupon_redemptions`)[0].state, 'RELEASED');
      assert.equal((await sql`select status from refund_obligations`)[0].status, 'RECORDED');
      assert.equal((await getDocumentStateUsing(sql, 'refund_race')).label, 'Refund Successful');
      assert.equal((await start(sql, 'refund_race', 1)).ok, false);
      assert.equal(await count('stock_movements'), 0);
    });
    await t.test('failed/rejected terminal events release capacity without ledger writes', async () => {
      for (const status of ['FAILED', 'REJECTED']) {
        const request = await start(sql, 'refund_terminal', 7000); assert.equal(request.ok, true);
        assert.equal((await finish(sql, 'refund_terminal', request.requestId, status)).ok, true);
        assert.equal((await finish(sql, 'refund_terminal', request.requestId, status)).duplicate, true);
        assert.equal((await finish(sql, 'refund_terminal', request.requestId)).reason, 'already-terminal');
      }
      const request = await start(sql, 'refund_terminal', 3000); assert.equal(request.ok, true);
      assert.equal((await finish(sql, 'refund_terminal', request.requestId)).ok, true);
      assert.equal((await sql`select count(*)::int n from refunds where order_id='refund_terminal'`)[0].n, 1);
      await assert.rejects(sql`update refund_requests set amount_paise=1 where id=${request.requestId}`, /immutable/);
      await assert.rejects(sql`delete from refund_requests where id=${request.requestId}`, /immutable/);
      await assert.rejects(sql`update refund_request_events set status='FAILED' where request_id=${request.requestId}`, /immutable/);
      await assert.rejects(sql`delete from refund_request_events where request_id=${request.requestId}`, /immutable/);
      await assert.rejects(sql`update refunds set provider_ref='changed' where order_id='refund_terminal'`, /immutable/);
      const otherLedger = (await sql`select id from refunds where order_id='refund_race' limit 1`)[0].id;
      // A fresh nonexistent terminal id fails FK; a matching-id duplicate also
      // cannot link a ledger from the wrong order (real completion trigger).
      const rejected = (await sql`select request_id from refund_request_events where status='REJECTED' limit 1`)[0].request_id;
      await assert.rejects(sql`insert into refund_request_events(request_id,status,refund_id,created_by) values (${rejected},'COMPLETED',${otherLedger},'phase2_owner')`, /must match/);
    });
    await t.test('return-level concurrency cap and completion close only the returned goods value', async () => {
      const results = await fixture.race((one, two) => Promise.all([start(one, 'refund_return', 4000, { returnId: 'return_fixture' }), start(two, 'refund_return', 4000, { returnId: 'return_fixture' })]));
      assert.equal(results.filter(row => row.ok).length, 1);
      assert.equal(results.find(row => !row.ok).reason, 'return-cap-exceeded');
      const first = results.find(row => row.ok);
      assert.equal((await finish(sql, 'refund_return', first.requestId)).ok, true);
      assert.equal((await sql`select status from return_requests`)[0].status, 'RECEIVED');
      const second = await start(sql, 'refund_return', 1000, { returnId: 'return_fixture' });
      assert.equal(second.ok, true);
      assert.equal((await finish(sql, 'refund_return', second.requestId)).ok, true);
      assert.equal((await finish(sql, 'refund_return', second.requestId)).duplicate, true);
      assert.equal((await sql`select status from return_requests`)[0].status, 'REFUNDED');
      assert.equal(await count('stock_movements'), 0);
    });
    await t.test('strict audit failure rolls back initiation and completion without financial leaks', async () => {
      // Local check intentionally makes writeAudit return false; never changes
      // production audit rules or suppresses its append-only trigger.
      await sql.unsafe("alter table store_admin_audit add constraint fixture_reject_refund_audit check(action not in ('refund.initiate','refund.completed')) not valid");
      try {
        assert.equal((await start(sql, 'refund_terminal', 1000)).ok, false);
        await sql.unsafe('alter table store_admin_audit drop constraint fixture_reject_refund_audit');
        // Reuse an approved outstanding request by rolling back the terminal
        // transaction explicitly; the normal lifecycle owns its transaction.
        // A database trigger fails only refund.completed audit, ensuring ledger
        // and event inserts occurred before the whole operation rolls back.
        await sql.unsafe("alter table store_admin_audit add constraint fixture_reject_refund_audit check(action<>'refund.completed') not valid");
        // All committed requests are terminal, so create this request inside an
        // outer rollback-only scope and pass a begin adapter to the real seam.
        await assert.rejects(sql.begin(async tx => {
          const connection = Object.assign((...args) => tx(...args), { begin: callback => callback(tx) });
          const request = await start(connection, 'refund_terminal', 1000);
          assert.equal(request.ok, true);
          const completed = await finish(connection, 'refund_terminal', request.requestId);
          assert.equal(completed.ok, false);
          throw new Error('fixture rollback-only request');
        }), /fixture rollback-only request/);
      } finally { await sql.unsafe('alter table store_admin_audit drop constraint fixture_reject_refund_audit'); }
    });
    await t.test('all committed fixture insert counts match the preapproved manifest', async () => {
      await assertPhase2Counts(fixture);
      const sensitive = await sql`select count(*)::int n from store_admin_audit where before::text like '%@%' or after::text like '%@%'`;
      assert.equal(sensitive[0].n, 0);
      await assert.rejects(sql`update store_admin_audit set reason='changed'`, /immutable/);
      await assert.rejects(sql`delete from store_admin_audit`, /immutable/);
    });
  } finally { await fixture.close(); }
});
