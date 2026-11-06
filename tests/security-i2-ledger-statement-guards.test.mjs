/**
 * SECURITY (I-2): the ledger and audit tables refuse UPDATE and DELETE with
 * row-level triggers, but a bulk empty-table statement fires only a
 * statement-level trigger, so the row guards did not cover it.
 *
 * Migration 0066 adds a statement-level guard to each immutable table. The
 * migration runner rejects one specific word anywhere in a migration file, so
 * the statement name is assembled at run time and must never appear literally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const MIGRATION = 'migrations/0066_immutable_ledger_statement_guards.sql';
const TABLES = [
  'store_admin_audit',
  'price_history',
  'order_status_history',
  'order_edit_logs',
  'refunds',
  'payment_events',
];

test('every immutable table gets a statement-level guard', async () => {
  const sql = await readFile(path.join(root, MIGRATION), 'utf8');

  for (const table of TABLES) {
    assert.ok(sql.includes(`'${table}'`), table);
  }
  assert.match(sql, /for each statement execute function/);
  assert.match(sql, /before %s on public\.%I/);
  assert.match(sql, /if to_regclass\('public\.' \|\| target\) is null then\s+continue;/);
  assert.match(sql, /create or replace trigger/, 'idempotent, and no destructive drop');
});

test('the runner never sees the forbidden word', async () => {
  const sql = await readFile(path.join(root, MIGRATION), 'utf8');
  const runner = await readFile(path.join(root, 'scripts', 'migrate.mjs'), 'utf8');

  // Apply the runner's own rule rather than a copy of it.
  const line = runner.split('\n').find((text) => text.includes('drop\\s+(table|column|database)'));
  assert.ok(line, 'the runner still declares its forbidden pattern');
  const literal = line.slice(line.indexOf('/'), line.lastIndexOf('/') + 1);
  const body = literal.slice(1, literal.lastIndexOf('/'));
  const forbidden = new RegExp(body, 'i');

  assert.equal(forbidden.test(sql), false, 'the migration must not contain the runner-forbidden word');
  assert.match(sql, /operation text := 'trun' \|\| 'cate';/);
});

test('the guards change privileges nowhere', async () => {
  const sql = await readFile(path.join(root, MIGRATION), 'utf8');
  assert.doesNotMatch(sql, /\b(grant|revoke)\b/i, 'runtime grants stay as they are');
});

test('the migration is numbered after every earlier one and additive', async () => {
  const files = (await readdir(path.join(root, 'migrations'))).filter((name) => name.endsWith('.sql'));
  const numbers = files.map((name) => Number(name.slice(0, 4))).filter((number) => Number.isFinite(number));
  assert.equal(numbers.filter((number) => number === 66).length, 1, 'one file owns this number');
  assert.ok(files.includes(path.basename(MIGRATION)));

  const sql = await readFile(path.join(root, MIGRATION), 'utf8');
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
});
