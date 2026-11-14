import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIGRATED_SEQUENCE_COLUMNS,
  applyManifestToTarget,
  syncMigratedSequences,
  syncSequenceForColumn,
} from '../scripts/migrate-data-to-new-project.mjs';

function createSequenceMockSql(initialTables = {}, initialSequences = {}) {
  const tables = {
    price_history: [...(initialTables.price_history ?? [])],
    product_content_revisions: [...(initialTables.product_content_revisions ?? [])],
  };
  const sequences = {
    'public.price_history_id_seq': {
      last_value: 1n,
      is_called: false,
      ...(initialSequences['public.price_history_id_seq'] ?? {}),
    },
    'public.product_content_revisions_revision_number_seq': {
      last_value: 1n,
      is_called: false,
      ...(initialSequences['public.product_content_revisions_revision_number_seq'] ?? {}),
    },
  };
  const seqByCol = {
    'public.price_history:id': 'public.price_history_id_seq',
    'public.product_content_revisions:revision_number':
      'public.product_content_revisions_revision_number_seq',
  };
  const operations = [];

  function parseTableName(query) {
    const m = query.match(/(?:FROM|INTO)\s+public\."([a-z0-9_]+)"/i);
    return m?.[1] ?? null;
  }

  function makeClient() {
    return {
      async unsafe(sqlText, params = []) {
        const text = sqlText.replace(/\s+/g, ' ').trim();
        operations.push({ text, params: [...params] });

        if (text.startsWith('SELECT count(*)::int AS count FROM')) {
          const table = parseTableName(text);
          return [{ count: tables[table]?.length ?? 0 }];
        }
        if (text.startsWith('DELETE FROM public.')) {
          const table = parseTableName(text);
          if (table) tables[table] = [];
          return [];
        }
        if (text.startsWith("SET session_replication_role = 'replica'")) {
          return [];
        }
        if (text.startsWith('INSERT INTO public.')) {
          const table = parseTableName(text);
          const colMatch = text.match(/\(([^)]+)\)\s+OVERRIDING SYSTEM VALUE/);
          if (table && colMatch && tables[table]) {
            const cols = colMatch[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
            const row = {};
            cols.forEach((col, i) => {
              row[col] = params[i];
            });
            tables[table].push(row);
          }
          return [];
        }
        if (text.startsWith('SELECT pg_get_serial_sequence(')) {
          const [qualifiedTable, col] = params;
          return [{ sequence_name: seqByCol[`${qualifiedTable}:${col}`] ?? null }];
        }
        const maxMatch = text.match(
          /SELECT MAX\("([a-z0-9_]+)"\)::bigint AS max_value, EXISTS \(SELECT 1 FROM "public"\."([a-z0-9_]+)"\) AS has_rows/,
        );
        if (maxMatch) {
          const [, col, table] = maxMatch;
          const rows = tables[table] ?? [];
          if (rows.length === 0) return [{ max_value: null, has_rows: false }];
          const maxVal = rows.reduce((acc, r) => {
            const v = BigInt(r[col]);
            return v > acc ? v : acc;
          }, BigInt(rows[0][col]));
          return [{ max_value: maxVal.toString(), has_rows: true }];
        }
        const seqReadMatch = text.match(
          /SELECT last_value::bigint AS last_value, is_called FROM "public"\."([a-z0-9_]+)"/,
        );
        if (seqReadMatch) {
          const seqKey = `public.${seqReadMatch[1]}`;
          const st = sequences[seqKey];
          return [{ last_value: st.last_value.toString(), is_called: st.is_called }];
        }
        if (text.startsWith('SELECT setval($1::regclass, $2::bigint, $3::boolean)')) {
          const [seqKey, valueStr, isCalled] = params;
          sequences[seqKey] = {
            last_value: BigInt(valueStr),
            is_called: Boolean(isCalled),
          };
          return [{ setval: valueStr }];
        }
        return [];
      },
      async begin(fn) {
        return fn(makeClient());
      },
    };
  }

  function nextval(seqKey) {
    const st = sequences[seqKey];
    if (!st.is_called) {
      st.is_called = true;
      return st.last_value;
    }
    st.last_value += 1n;
    return st.last_value;
  }

  return { sql: makeClient(), tables, sequences, operations, nextval };
}

test('applyManifestToTarget copies explicit IDs into price_history and product_content_revisions and syncs sequences afterward', async () => {
  const { sql, tables, operations, nextval } = createSequenceMockSql();

  const manifest = [
    {
      group: 'Categories & Catalogue',
      table: 'product_content_revisions',
      pk: 'id',
      syncEmpty: false,
      rows: [
        { id: 'rev_1', revision_number: 4, product_id: 'prod_1', actor_id: 'stf_1', source: 'backfill' },
        { id: 'rev_2', revision_number: 11, product_id: 'prod_1', actor_id: 'stf_1', source: 'csv_import' },
      ],
    },
    {
      group: 'Categories & Catalogue',
      table: 'price_history',
      pk: 'id',
      syncEmpty: false,
      rows: [
        { id: 1, product_id: 'prod_1', old_price_paise: null, new_price_paise: 100 },
        { id: 7, product_id: 'prod_1', old_price_paise: 100, new_price_paise: 19900 },
      ],
    },
  ];

  const syncResults = await applyManifestToTarget(sql, manifest, { allowNonEmpty: false });

  // Explicit IDs preserved in target tables.
  assert.deepEqual(
    tables.price_history.map((r) => r.id),
    [1, 7],
  );
  assert.deepEqual(
    tables.product_content_revisions.map((r) => r.revision_number),
    [4, 11],
  );

  // Sequences synchronized AFTER all explicit-ID INSERT statements finished.
  const lastInsertIdx = operations.reduce(
    (last, op, idx) => (op.text.startsWith('INSERT INTO public.') && op.text.includes('OVERRIDING SYSTEM VALUE') ? idx : last),
    -1,
  );
  const firstSeqSyncIdx = operations.findIndex((op) => op.text.startsWith('SELECT pg_get_serial_sequence('));
  assert.ok(lastInsertIdx >= 0 && firstSeqSyncIdx > lastInsertIdx);

  assert.equal(syncResults.length, MIGRATED_SEQUENCE_COLUMNS.length);
  assert.equal(syncResults[0].updated, true);
  assert.equal(syncResults[1].updated, true);

  // Subsequent generated IDs exceed the existing maxima (100+ safety, here 8 > 7 and 12 > 11).
  assert.equal(nextval('public.price_history_id_seq'), 8n);
  assert.equal(nextval('public.product_content_revisions_revision_number_seq'), 12n);
});

test('sequence synchronization handles empty tables correctly without moving backwards', async () => {
  // 1. Fresh empty tables keep initial nextval = 1.
  const fresh = createSequenceMockSql();
  const freshRes = await syncMigratedSequences(fresh.sql);
  assert.equal(freshRes.every((r) => r.updated === false), true);
  assert.equal(fresh.nextval('public.price_history_id_seq'), 1n);
  assert.equal(fresh.nextval('public.product_content_revisions_revision_number_seq'), 1n);

  // 2. Empty table whose sequence already advanced past 1 must NOT reset backwards.
  const aheadEmpty = createSequenceMockSql(
    {},
    {
      'public.price_history_id_seq': { last_value: 5n, is_called: true },
      'public.product_content_revisions_revision_number_seq': { last_value: 3n, is_called: true },
    },
  );
  const aheadRes = await syncMigratedSequences(aheadEmpty.sql);
  assert.equal(aheadRes.every((r) => r.updated === false), true);
  assert.equal(aheadEmpty.nextval('public.price_history_id_seq'), 6n);
  assert.equal(aheadEmpty.nextval('public.product_content_revisions_revision_number_seq'), 4n);
});

test('re-running sequence synchronization is idempotent and never resets sequences backwards', async () => {
  const { sql, sequences, operations, nextval } = createSequenceMockSql({
    price_history: [{ id: 1 }, { id: 7 }],
    product_content_revisions: [{ id: 'r1', revision_number: 4 }],
  });

  // First sync sets seq to MAX + 1.
  const first = await syncMigratedSequences(sql);
  assert.equal(first[0].updated, true);
  assert.equal(first[0].nextValue, '8');
  assert.equal(first[1].updated, true);
  assert.equal(first[1].nextValue, '5');

  // Re-run immediately: already at MAX + 1, so setval is NOT invoked again.
  const opsBeforeRerun = operations.length;
  const second = await syncMigratedSequences(sql);
  assert.equal(second.every((r) => r.updated === false), true);
  assert.equal(
    operations.slice(opsBeforeRerun).some((op) => op.text.includes('setval(')),
    false,
  );

  // Simulate further live inserts advancing sequences past MAX (e.g. rolled back or deleted/newer inserts).
  assert.equal(nextval('public.price_history_id_seq'), 8n);
  assert.equal(nextval('public.price_history_id_seq'), 9n);
  assert.equal(sequences['public.price_history_id_seq'].last_value, 9n);

  // Re-run again: must keep nextval = 10n and NEVER step back to 8n.
  const opsBeforeThird = operations.length;
  const third = await syncMigratedSequences(sql);
  assert.equal(third[0].updated, false);
  assert.equal(third[0].nextValue, '10');
  assert.equal(
    operations.slice(opsBeforeThird).some((op) => op.text.includes('setval(')),
    false,
  );
  assert.equal(nextval('public.price_history_id_seq'), 10n);
});

test('syncSequenceForColumn rejects unsafe SQL identifiers', async () => {
  const { sql } = createSequenceMockSql();
  await assert.rejects(
    () => syncSequenceForColumn(sql, { schema: 'public', table: 'price_history; drop table products', column: 'id' }),
    /Unsafe PostgreSQL/,
  );
  await assert.rejects(
    () => syncSequenceForColumn(sql, { schema: 'public', table: 'price_history', column: 'id" --' }),
    /Unsafe PostgreSQL/,
  );
});
