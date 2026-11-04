import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const rules = await jiti.import(path.join(root, 'src/lib/store-admin/coupon-rules.ts'));
const service = await jiti.import(path.join(root, 'src/lib/store-admin/coupons.ts'));
const form = { code: 'VISIBLE5', name: 'Fixture', type: 'PERCENT', value: '10', scope: 'ORDER' };
const parse = patch => rules.parseCouponInput({ ...form, ...patch });
const actor = { actorId: null };

test('admin coupon discovery defaults hidden, omission is distinguishable from clear', () => {
  const defaults = parse();
  assert.equal(defaults.ok, true);
  assert.equal(defaults.values.showToAllUsers, false);
  assert.deepEqual(defaults.values.assignedToEmails, []);
  assert.deepEqual(defaults.values.assignedCustomerGroups, []);
  const omitted = rules.parseCouponInput(form, { preserveOmittedVisibility: true });
  assert.equal(omitted.ok, true);
  for (const key of ['showToAllUsers', 'assignedToEmails', 'assignedCustomerGroups']) {
    assert.equal(Object.hasOwn(omitted.values, key), false);
  }
  const cleared = rules.parseCouponInput({ ...form, showToAllUsers: false, assignedToEmails: [], assignedCustomerGroups: '' }, { preserveOmittedVisibility: true });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.values.showToAllUsers, false);
  assert.deepEqual(cleared.values.assignedToEmails, []);
  assert.deepEqual(cleared.values.assignedCustomerGroups, []);
});

test('assignment normalization and validation do not change redemption restrictions', () => {
  const parsed = parse({ assignedToEmails: ' A@Example.invalid; a@example.invalid ', assignedCustomerGroups: ['VIP', 'vip', ' retail '], restrictedToEmails: 'other@example.invalid', allowedCustomerGroups: ['legacy-group'] });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.values.assignedToEmails, ['a@example.invalid']);
  assert.deepEqual(parsed.values.assignedCustomerGroups, ['vip', 'retail']);
  assert.deepEqual(parsed.values.restrictedToEmails, ['other@example.invalid']);
  assert.deepEqual(parsed.values.allowedCustomerGroups, ['legacy-group']);
  for (const patch of [
    { assignedToEmails: ['bad'] }, { assignedToEmails: [123] },
    { assignedToEmails: ['a'.repeat(245) + '@example.invalid'] },
    { assignedToEmails: Array(201).fill('a@example.invalid') },
    { assignedCustomerGroups: ['invented'] }, { assignedCustomerGroups: Array(21).fill('vip') },
    { assignedToEmails: null }, { assignedCustomerGroups: {} }, { showToAllUsers: 'true' },
  ]) assert.equal(parse(patch).ok, false, JSON.stringify(patch));
});

test('audits contain visibility and assignment counts, not recipient lists', () => {
  const { values } = parse({ showToAllUsers: true, assignedToEmails: ['private@example.invalid'], assignedCustomerGroups: ['vip'] });
  const snapshot = rules.couponAuditSnapshot(values);
  assert.equal(snapshot.showToAllUsers, true);
  assert.equal(snapshot.assignedEmails, 1);
  assert.equal(snapshot.assignedCustomerGroups, 1);
  assert.equal(JSON.stringify(snapshot).includes('private@example.invalid'), false);
  assert.equal(JSON.stringify(snapshot).includes('vip'), false);
});

test('selected visibility parser bounds, deduplicates, orders and rejects malformed IDs', () => {
  assert.deepEqual(rules.parseCouponVisibilityInput({ ids: ['b', 'a', 'b'], showToAllUsers: false }), { ok: true, ids: ['a','b'], showToAllUsers: false });
  for (const ids of [[], Array(501).fill('a'), ['a', null], ['a b'], ['../id']]) {
    assert.equal(rules.parseCouponVisibilityInput({ ids, showToAllUsers: true }).ok, false);
  }
  assert.equal(rules.parseCouponVisibilityInput({ ids: ['a'], showToAllUsers: 'true' }).ok, false);
  assert.equal(rules.parseCouponVisibilityFilter('public'), 'public');
  assert.equal(rules.parseCouponVisibilityFilter('hidden'), 'hidden');
  assert.equal(rules.parseCouponVisibilityFilter('unknown'), 'all');
});

// Narrow transaction fake: no configured database is opened, and rollback is
// observable independently from the service's public error conversion.
function database(rows) {
  const events = [];
  const tx = (strings, ...params) => {
    if (Array.isArray(strings) && !strings.raw) return strings;
    const query = strings.join('?');
    events.push({ query, params });
    return Promise.resolve(query.includes('select ') ? rows : []);
  };
  const sql = { begin: async fn => {
    try { const result = await fn(tx); events.push('commit'); return result; }
    catch (error) { events.push('rollback'); throw error; }
  } };
  return { sql, events, tx };
}

test('bulk visibility validates all selections before writing and audit false rolls back', async () => {
  for (const rows of [[], [{ id: 'a', status: 'archived' }]]) {
    const db = database(rows);
    const result = await service.setCouponsVisibility({ ids: ['a'], showToAllUsers: true }, actor, { sql: db.sql, audit: async () => { throw new Error('must not audit'); } });
    assert.equal(result.ok, false);
    assert.equal(db.events.some(event => event.query?.includes('update coupons')), false);
  }
  const db = database([{ id: 'a', status: 'active', show_to_all_users: false }]);
  let auditCalls = 0;
  const result = await service.setCouponsVisibility({ ids: ['a'], showToAllUsers: true }, actor, { sql: db.sql, audit: async (input, tx) => {
    auditCalls++;
    assert.equal(tx, db.tx);
    assert.equal(input.action, 'coupon.bulk_visibility');
    assert.deepEqual(input.after, { count: 1, showToAllUsers: true });
    return false;
  } });
  assert.equal(result.ok, false);
  assert.equal(auditCalls, 1);
  assert.equal(db.events.at(-1), 'rollback');
});

test('create, update, duplicate and generation abort when transactional auditing fails', async () => {
  const values = parse().values;
  const row = { id: 'a', code: 'SOURCE5', type: 'PERCENT', value: 10, scope: 'ORDER', status: 'active', show_to_all_users: true, assigned_to_emails: ['a@example.invalid'], assigned_customer_groups: ['vip'] };
  for (const [name, invoke, rows] of [
    ['create', options => service.createCoupon(values, actor, options), []],
    ['update', options => service.updateCoupon('a', values, actor, options), [row]],
    ['duplicate', options => service.duplicateCoupon('a', actor, options), [row]],
    ['generation', options => service.bulkGenerateCoupons({ count: 2, prefix: 'TEST', length: 8, values }, actor, options), []],
  ]) {
    const db = database(rows);
    let calls = 0;
    const result = await invoke({ sql: db.sql, audit: async (_input, tx) => { assert.equal(tx, db.tx); calls++; return false; } });
    assert.equal(result.ok, false, name);
    assert.equal(calls, 1, name);
    assert.equal(db.events.at(-1), 'rollback', name);
  }
});

test('update preserves omitted discovery fields from its locked row and honors explicit clears', async () => {
  const row = { id: 'a', code: 'SOURCE5', type: 'PERCENT', value: 10, scope: 'ORDER', status: 'active', show_to_all_users: true, assigned_to_emails: ['a@example.invalid'], assigned_customer_groups: ['vip'] };
  for (const clear of [false, true]) {
    const parsed = rules.parseCouponInput({ ...form, ...(clear ? { showToAllUsers: false, assignedToEmails: [], assignedCustomerGroups: [] } : {}) }, { preserveOmittedVisibility: true });
    const db = database([row]);
    let snapshot;
    const result = await service.updateCoupon('a', parsed.values, actor, { sql: db.sql, audit: async input => { snapshot = input; return true; } });
    assert.equal(result.ok, true);
    assert.equal(result.data.after.showToAllUsers, !clear);
    assert.deepEqual(result.data.after.assignedToEmails, clear ? [] : ['a@example.invalid']);
    assert.deepEqual(result.data.after.assignedCustomerGroups, clear ? [] : ['vip']);
    assert.equal(snapshot.after.assignedEmails, clear ? 0 : 1);
    assert.equal(JSON.stringify(snapshot).includes('a@example.invalid'), false);
    assert.equal(db.events.at(-1), 'commit');
  }
});

test('bulk visibility writes only public flag and one audit for deduplicated selection', async () => {
  const db = database([{ id: 'a', status: 'active', show_to_all_users: false }, { id: 'b', status: 'paused', show_to_all_users: true }]);
  let auditCalls = 0;
  const result = await service.setCouponsVisibility({ ids: ['b','a','b'], showToAllUsers: false }, actor, { sql: db.sql, audit: async () => { auditCalls++; return true; } });
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 2);
  assert.equal(auditCalls, 1);
  const update = db.events.find(event => event.query?.includes('update coupons'));
  assert.equal(update.query.includes('assigned_to_emails'), false);
  assert.equal(update.query.includes('restricted_to_emails'), false);
  assert.equal(db.events[0].query.includes('order by id for update'), true);
  assert.equal(db.events.at(-1), 'commit');
});
