import test from 'node:test';
import assert from 'node:assert/strict';
import { planDescriptionBackfill, parseDescriptionBackfillArgs } from '../scripts/backfill-product-descriptions.mjs';

const row = (id, extra = {}) => ({ id, description: 'Existing overview', highlights: [], in_the_box: [],
  short_description: null, description_sections: null, deleted_at: null, updated_at: '2026-11-03', ...extra });

test('backfill preserves edits, explicit empty sections, deleted rows and absent source content', () => {
  const rows = [row('candidate', { short_description: 'Staff summary' }),
    row('empty', { description_sections: [] }), row('edited', { description_sections: [{ staff: true }] }),
    row('deleted', { deleted_at: '2026-11-02' }), row('no-source', { description: '' })];
  const before = structuredClone(rows);
  const plan = planDescriptionBackfill(rows, 'target');
  assert.deepEqual(rows, before);
  assert.deepEqual(plan.counts, { total: 5, preservedStructured: 2, deleted: 1, noLegacyContent: 1,
    invalidLegacy: 0, candidates: 1, withDescription: 1, withHighlights: 0, withInTheBox: 0 });
  assert.equal(plan.updates[0].id, 'candidate');
  assert.equal(plan.updates[0].sections[0].blocks[0].content[0].text, 'Existing overview');
  assert.equal('shortDescription' in plan.updates[0], false);
  const applied = rows.map(source => ({ ...source,
    description_sections: plan.updates.find(update => update.id === source.id)?.sections ?? source.description_sections }));
  assert.equal(planDescriptionBackfill(applied, 'target').updates.length, 0);
});

test('digest binds source data and target identity, regardless of input row order', () => {
  const rows = [row('b'), row('a')];
  const digest = planDescriptionBackfill(rows, 'target').digest;
  assert.equal(planDescriptionBackfill([...rows].reverse(), 'target').digest, digest);
  assert.notEqual(planDescriptionBackfill(rows, 'other-target').digest, digest);
  assert.notEqual(planDescriptionBackfill([row('b'), row('a', { short_description: 'Edited' })], 'target').digest, digest);
});

test('malformed or oversized legacy data is reported without truncation or fabrication', () => {
  const plan = planDescriptionBackfill([row('bad', { highlights: [{}] }),
    row('oversized', { description: 'a'.repeat(8001) }), row('box', { description: '', in_the_box: ['Existing item'] })], 'target');
  assert.equal(plan.counts.invalidLegacy, 2);
  assert.equal(plan.counts.withInTheBox, 1);
  assert.equal(plan.updates.length, 1);
});

test('write mode requires explicit host, digest and actor arguments', () => {
  assert.equal(parseDescriptionBackfillArgs([]).apply, false);
  assert.equal(parseDescriptionBackfillArgs(['--dry-run']).apply, false);
  for (const args of [['--apply'], ['--apply', '--dry-run'], ['--force'], ['--staff-actor', 'owner']]) {
    assert.throws(() => parseDescriptionBackfillArgs(args));
  }
  assert.equal(parseDescriptionBackfillArgs(['--apply', '--approved-host', 'example.test:5432',
    '--approved-digest', 'a'.repeat(64), '--staff-actor', 'owner']).apply, true);
});
