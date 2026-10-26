import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const { canonicalViewQuery, sanitizeSavedViews } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'preferences.ts'),
);

/* -------------------------------------------------- canonical query */

test('filters are written in a stable order and unknown keys are dropped', () => {
  assert.equal(
    canonicalViewQuery({
      to: '2026-10-01',
      from: '2026-09-01',
      sort: 'oldest',
      state: 'pending',
      channel: 'WEB',
      q: '  phone  ',
      page: '4',
      view: 'TXN1',
    }),
    'q=phone&channel=web&state=PENDING&sort=oldest&from=2026-09-01&to=2026-10-01',
  );
});

test('the default sort is not written into a view', () => {
  assert.equal(canonicalViewQuery({ state: 'DELIVERED', sort: 'newest' }), 'state=DELIVERED');
});

test('a sort on its own is not a saved view', () => {
  assert.equal(canonicalViewQuery({ sort: 'amount-desc' }), null);
  assert.equal(canonicalViewQuery({}), null);
});

test('invalid filter values are ignored rather than saved', () => {
  assert.equal(canonicalViewQuery({ state: 'BOGUS', channel: 'carrier', from: '2026-13-01' }), null);
  assert.equal(canonicalViewQuery({ q: 'abc', state: 'BOGUS' }), 'q=abc');
});

/* ------------------------------------------------------ saved views */

test('valid views survive sanitising, invalid ones are dropped', () => {
  const views = sanitizeSavedViews([
    { id: 'view_abc123', name: 'Unpaid POS', query: 'state=PENDING&channel=pos' },
    { id: 'not-a-view', name: 'Bad id', query: 'state=PENDING' },
    { id: 'view_def456', name: '', query: 'state=PENDING' },
    { id: 'view_ghi789', name: 'Sort only', query: 'sort=oldest' },
    { id: 'view_jkl012', name: 'Unknown state', query: 'state=BOGUS' },
    'nonsense',
    null,
  ]);

  assert.deepEqual(views, [
    { id: 'view_abc123', name: 'Unpaid POS', query: 'channel=pos&state=PENDING' },
  ]);
});

test('duplicate ids keep the first entry', () => {
  const views = sanitizeSavedViews([
    { id: 'view_abc123', name: 'First', query: 'q=one' },
    { id: 'view_abc123', name: 'Second', query: 'q=two' },
  ]);
  assert.equal(views.length, 1);
  assert.equal(views[0].name, 'First');
});

test('names longer than 28 characters are rejected', () => {
  const views = sanitizeSavedViews([
    { id: 'view_abc123', name: 'x'.repeat(28), query: 'q=ok' },
    { id: 'view_def456', name: 'x'.repeat(29), query: 'q=no' },
  ]);
  assert.equal(views.length, 1);
  assert.equal(views[0].id, 'view_abc123');
});

test('at most ten views are kept', () => {
  const views = sanitizeSavedViews(
    Array.from({ length: 14 }, (_, index) => ({
      id: `view_${String(index).padStart(6, '0')}`,
      name: `View ${index}`,
      query: `q=${index}`,
    })),
  );
  assert.equal(views.length, 10);
  assert.equal(views[9].name, 'View 9');
});

test('non-array payloads yield no views', () => {
  assert.deepEqual(sanitizeSavedViews(null), []);
  assert.deepEqual(sanitizeSavedViews({ id: 'view_abc123' }), []);
  assert.deepEqual(sanitizeSavedViews('view_abc123'), []);
});
