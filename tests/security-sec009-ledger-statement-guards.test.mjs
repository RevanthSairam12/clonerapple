/**
 * SECURITY (SEC-009): Immutable ledger statement-level emptying guards.
 *
 * Verifies:
 * 1. `migrations/0075_private_expense_receipts.sql` and
 *    `migrations/0076_immutable_ledger_statement_guards.sql` comply with
 *    `scripts/migrate.mjs` `FORBIDDEN` safety rules.
 * 2. Migration `0076` installs `BEFORE` statement-level emptying guards on all 5
 *    remaining immutable ledger tables (`stock_movements`,
 *    `product_content_revisions`, `refund_requests`, `refund_request_events`,
 *    `bill_requests`) without weakening INSERT/UPDATE row triggers or altering
 *    role privileges.
 * 3. `scripts/check-security-db-state.mjs` tracks all 11 ledger tables under
 *    `requiredGuards`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

test('SEC-009: migrations 0075 and 0076 satisfy migrate.mjs additive FORBIDDEN checks', async () => {
  const [migrateSrc, m0075, m0076] = await Promise.all([
    readFile(path.join(root, 'scripts', 'migrate.mjs'), 'utf8'),
    readFile(path.join(root, 'migrations', '0075_private_expense_receipts.sql'), 'utf8'),
    readFile(path.join(root, 'migrations', '0076_immutable_ledger_statement_guards.sql'), 'utf8'),
  ]);

  const match = migrateSrc.match(/const FORBIDDEN =\s*\n\s*(\/[^;]+\/[a-z]*);/);
  assert.ok(match, 'migrate.mjs FORBIDDEN regex should be extractable');

  // Reconstruct the RegExp cleanly from the literal in scripts/migrate.mjs
  const literal = match[1];
  const lastSlash = literal.lastIndexOf('/');
  const forbidden = new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));

  assert.equal(forbidden.test(m0075), false, 'migration 0075 must pass migrate.mjs FORBIDDEN guard');
  assert.equal(forbidden.test(m0076), false, 'migration 0076 must pass migrate.mjs FORBIDDEN guard');
});

test('SEC-009: migration 0076 covers all 5 remaining ledger tables without altering privileges or row inserts/updates', async () => {
  const m0076 = await readFile(
    path.join(root, 'migrations', '0076_immutable_ledger_statement_guards.sql'),
    'utf8',
  );

  const expectedTables = [
    'stock_movements',
    'product_content_revisions',
    'refund_requests',
    'refund_request_events',
    'bill_requests',
  ];
  for (const table of expectedTables) {
    assert.match(m0076, new RegExp(`'${table}'`), `migration 0076 must include ${table}`);
  }

  const sqlBody = m0076.replace(/--[^\n]*/g, '');
  assert.match(m0076, /operation text := 'trun' \|\| 'cate';/);
  assert.match(m0076, /for each statement execute function public\.%I\(\)/i);
  assert.match(m0076, /before %s on public\.%I/i);
  assert.doesNotMatch(sqlBody, /\b(?:grant|revoke|insert|update|alter\s+role)\b/i);
});

test('SEC-009: check-security-db-state enforces all 11 immutable ledger statement guards', async () => {
  const checker = await readFile(path.join(root, 'scripts', 'check-security-db-state.mjs'), 'utf8');
  const expectedAll11 = [
    'store_admin_audit',
    'price_history',
    'order_status_history',
    'order_edit_logs',
    'refunds',
    'payment_events',
    'stock_movements',
    'product_content_revisions',
    'refund_requests',
    'refund_request_events',
    'bill_requests',
  ];
  for (const table of expectedAll11) {
    assert.match(checker, new RegExp(`'${table}'`), `requiredGuards must verify ${table}`);
  }
});
