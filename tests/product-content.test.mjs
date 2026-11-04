import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { applyDescriptionBackfillUsing } from '../scripts/backfill-product-descriptions.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const content = await jiti.import(path.join(root, 'src/lib/store-admin/product-content.ts'));
const duplicate = await jiti.import(path.join(root, 'src/lib/store-admin/product-duplicate.ts'));
const section = { id: 'overview', title: 'Overview', hidden: false, type: 'text', blocks: [{ type: 'paragraph', content: [{ text: 'private content prose' }] }] };
const original = { short_description: null, description_sections: null, description: 'old fallback prose', highlights: [{ title: 'Old', desc: 'Claim' }], in_the_box: ['Old item'] };
function database({ row = original, revision = null, latest = null, fail = '' } = {}) {
  const events = [];
  const tx = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    events.push({ query, values });
    if (fail && query.startsWith(fail)) throw new Error('private DB detail');
    if (query.startsWith('select short_description')) return row ? [structuredClone(row)] : [];
    if (query.startsWith('select id from product_content_revisions')) return latest ? [{ id: latest }] : [];
    if (query.startsWith('select before_snapshot')) return revision ? [revision] : [];
    if (query.startsWith('select id from products')) return row ? [{ id: 'p' }] : [];
    if (query.startsWith('select id,actor_id')) return revision ? [{ id: latest, ...revision }] : [];
    return [];
  };
  tx.json = value => structuredClone(value);
  const sql = { begin: async fn => { events.push({ query: 'BEGIN' }); try { const result = await fn(tx); events.push({ query: 'COMMIT' }); return result; } catch (error) { events.push({ query: 'ROLLBACK' }); throw error; } } };
  return { tx, sql, events };
}
const writes = events => events.filter(e => /^(update|insert)/.test(e.query));
test('content writes lock persisted old JSON and preserve null/[] without inferring fallback', async () => {
  const { tx, events } = database();
  const result = await content.writeProductContentUsing(tx, 'p', { descriptionSections: [] }, 'staff', { source: 'csv_import' });
  assert.equal(result.changed, true);
  assert.match(events[0].query, /deleted_at is null for update$/);
  const revision = events.find(e => e.query.startsWith('insert into product_content_revisions'));
  assert.deepEqual(revision.values[4], { shortDescription: null, descriptionSections: null, legacyFallback: { description: original.description, highlights: original.highlights, inTheBox: original.in_the_box } });
  assert.deepEqual(revision.values[5].descriptionSections, []);
  assert.equal(revision.values[5].shortDescription, null);
  const audit = events.find(e => e.query.startsWith('insert into store_admin_audit'));
  assert.doesNotMatch(JSON.stringify(audit.values), /old fallback prose|Old item|Claim/);
  assert.match(JSON.stringify(audit.values), /revisionId|sectionCount/);
});
test('omitted fields, equal canonical values and object-key ordering cause no revision or audit', async () => {
  for (const patch of [{}, { shortDescription: null }]) {
    const { tx, events } = database({ latest: 'r-current' });
    assert.deepEqual(await content.writeProductContentUsing(tx, 'p', patch, 'staff'), { changed: false, revisionId: 'r-current' });
    assert.equal(writes(events).length, 0);
  }
  const { tx, events } = database({ row: { ...original, description_sections: [section] } });
  const reordered = { blocks: section.blocks, type: 'text', hidden: false, title: 'Overview', id: 'overview' };
  await content.writeProductContentUsing(tx, 'p', { descriptionSections: [reordered] }, 'staff');
  assert.equal(writes(events).length, 0);
});
test('previous malformed persisted sections are captured exactly, not parsed or discarded', async () => {
  const malformed = { unknownLegacy: ['kept verbatim'] };
  const { tx, events } = database({ row: { ...original, description_sections: malformed } });
  await content.writeProductContentUsing(tx, 'p', { descriptionSections: [section] }, 'staff');
  assert.deepEqual(events.find(e => e.query.startsWith('insert into product_content_revisions')).values[4].descriptionSections, malformed);
});
test('bounded invalid writes and optimistic conflicts make no business writes', async () => {
  for (const patch of [{ shortDescription: 'x'.repeat(1001) }, { descriptionSections: Array(25).fill(section) }]) {
    const { tx, events } = database();
    await assert.rejects(content.writeProductContentUsing(tx, 'p', patch, 'staff'), /Invalid product description/);
    assert.equal(writes(events).length, 0);
  }
  const { tx, events } = database({ latest: 'r-new' });
  await assert.rejects(content.writeProductContentUsing(tx, 'p', { descriptionSections: [] }, 'staff', { expectedRevision: null }), error => error.status === 409);
  assert.equal(writes(events).length, 0);
});
test('oversized historical snapshot refuses before writes without truncating evidence', async () => {
  const {tx,events}=database({row:{...original,description:'x'.repeat(1_048_576)}});
  await assert.rejects(content.writeProductContentUsing(tx,'p',{descriptionSections:[]},'staff'),/snapshot limit/);
  assert.equal(writes(events).length,0);
});
test('revision or strict audit failure propagates into caller rollback', async () => {
  for (const fail of ['insert into product_content_revisions', 'insert into store_admin_audit']) {
    const { tx, sql, events } = database({ fail });
    await assert.rejects(sql.begin(() => content.writeProductContentUsing(tx, 'p', { descriptionSections: [section] }, 'staff')));
    assert.equal(events.at(-1).query, 'ROLLBACK');
    assert.ok(!events.some(e => e.query === 'COMMIT'));
  }
});
test('restore reads product-scoped stored snapshots and appends a new revision including before null fallback', async () => {
  const previous = { shortDescription: null, descriptionSections: null, legacyFallback: { description: 'Historic fallback is reference only', highlights: [], inTheBox: [] } };
  const { tx, events } = database({ row: { ...original, description_sections: [section] }, revision: { before_snapshot: previous, after_snapshot: { ...previous, descriptionSections: [] } }, latest: 'latest' });
  const result = await content.restoreProductContentUsing(tx, 'p', 'r-old', 'staff', { expectedRevision: 'latest', snapshot: 'before' });
  assert.equal(result.changed, true);
  assert.deepEqual(events.find(e => e.query.startsWith('select before_snapshot')).values, ['r-old', 'p']);
  const revision = events.find(e => e.query.startsWith('insert into product_content_revisions'));
  assert.equal(revision.values[3], 'restore');
  assert.equal(revision.values[5].descriptionSections, null);
  assert.equal(revision.values[6], 'r-old');
  assert.equal(revision.values[5].legacyFallback.description, original.description);
  assert.ok(!events.some(e => /update products set description=/.test(e.query)));
  assert.ok(!events.some(e => /^(update|delete).*product_content_revisions/.test(e.query)));
});
test('restore rejects missing, malformed and sanitization-changing stored snapshots without writes', async () => {
  for (const target of [null, {}, { shortDescription: null, descriptionSections: [{ ...section, title: 'bad\u0001title' }] }, { shortDescription: null, descriptionSections: [{ ...section, blocks: [{ type: 'paragraph', content: [{ text: 'x', href: 'javascript:alert(1)' }] }] }] }]) {
    const { tx, events } = database({ revision: { after_snapshot: target } });
    await assert.rejects(content.restoreProductContentUsing(tx, 'p', 'old', 'staff'));
    assert.equal(writes(events).length, 0);
  }
});
test('history is bounded, product scoped and never returns staff contact fields', async () => {
  const { tx, events } = database({ revision: { after_snapshot: {} }, latest: 'new' });
  assert.equal((await content.productContentHistoryUsing(tx, 'p', 20)).latestRevision, 'new');
  const query = events.find(e => e.query.startsWith('select id,actor_id'));
  assert.deepEqual(query.values, ['p', 20]);
  assert.doesNotMatch(query.query, /email|phone|store_admins/);
  await assert.rejects(content.productContentHistoryUsing(tx, 'p', 101));
});
test('duplicate SQL copies current canonical content, never revision lineage or stock', async () => {
  const events = [];
  const tx = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim(); events.push({ query, values });
    if (query.startsWith('select id,sell_by,sku_pattern from products')) return [{ id: 'source', sell_by: 'single', sku_pattern: null }];
    return [];
  }; tx.json = value => value;
  await duplicate.duplicateProductUsing(tx, 'source', { name: 'Copy', slug: 'copy' }, 'staff');
  const insert = events.find(e => e.query.startsWith('insert into products'));
  assert.match(insert.query, /description,short_description,description_sections/);
  assert.equal(insert.query.match(/short_description/g).length, 2);
  assert.ok(!events.some(e => /product_content_revisions|insert into stock\b|stock_movements/.test(e.query)));
});
test('backfill apply uses the same transactional revision writer, preserves summary and rolls back strict audit failure', async () => {
  const { tx, events } = database({ row: { ...original, short_description: 'Existing staff summary' } });
  await applyDescriptionBackfillUsing(tx, [{ id: 'p', sections: [section] }], 'owner');
  const revision = events.find(e => e.query.startsWith('insert into product_content_revisions'));
  assert.equal(revision.values[3], 'backfill');
  assert.equal(revision.values[4].descriptionSections, null);
  assert.equal(revision.values[5].shortDescription, 'Existing staff summary');
  assert.deepEqual(revision.values[5].descriptionSections, [section]);
  const failing = database({ fail: 'insert into store_admin_audit' });
  await assert.rejects(failing.sql.begin(tx => applyDescriptionBackfillUsing(tx, [{ id: 'p', sections: [section] }], 'owner')));
  assert.equal(failing.events.at(-1).query, 'ROLLBACK');
});
test('migration is private, append-only, additive and contains no business DML or inferred backfill', async () => {
  const sql = await readFile(path.join(root, 'migrations/0056_product_content_revisions.sql'), 'utf8');
  assert.match(sql, /alter table product_content_revisions enable row level security/i);
  assert.match(sql, /before update or delete on product_content_revisions/i);
  assert.match(sql, /raise exception 'product content revisions are immutable'/i);
  assert.match(sql, /revision_number bigint generated always as identity/i);
  assert.doesNotMatch(sql, /create\s+policy|\b(insert\s+into|update\s+products|delete\s+from|truncate|drop\s+(table|column|database))\b/i);
});
