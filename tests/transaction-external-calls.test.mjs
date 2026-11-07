/**
 * Transaction row-lock audit guards (Step 3).
 *
 * Verifies that every transaction holding row locks (checkout, POS, stock,
 * coupons, reconcile, callbacks, outbox, staff, media, returns, refunds)
 * performs zero external network I/O (PayU verification, SMTP, SMS, HTTP,
 * Supabase Storage) while `sql.begin(async (tx) => ...)` is open.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const source = (rel) => readFile(path.join(root, rel), 'utf8');

/** Extract all `sql.begin(...)` or `database().begin(...)` blocks from a file. */
function extractTransactionBlocks(text) {
  const blocks = [];
  const pattern = /\.begin\s*\(/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    let depth = 0;
    let i = start + match[0].length - 1; // at '('
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) {
          blocks.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return blocks;
}

const ROW_LOCKING_MODULES = [
  'src/lib/payu/orders.ts',
  'src/lib/payu/stock.ts',
  'src/lib/payu/process-response.ts',
  'src/lib/payu/reconcile.ts',
  'src/lib/payu/waitlist-cleanup.ts',
  'src/lib/coupons/store.ts',
  'src/lib/store-admin/coupons.ts',
  'src/lib/store-admin/pos.ts',
  'src/lib/notifications/outbox.ts',
  'src/lib/store-admin/returns.ts',
  'src/lib/store-admin/orders.ts',
  'src/lib/store-admin/refund-lifecycle.ts',
  'src/lib/store-admin/payments.ts',
  'src/lib/store-admin/media.ts',
  'src/lib/store-admin/staff.ts',
];

const FORBIDDEN_EXTERNAL_CALLS = /\b(fetch|verifyPaymentWithPayU|deliverNotification|sendMail|sendTestEmail|deleteFromStorage|queueOrderEvent|queueFulfilmentEvents|queueNotification|enqueueNotification|processNotificationOutbox|revalidateCatalog)\s*\(/;

test('no row-locking transaction invokes PayU HTTP, SMTP, SMS, Storage, or outbox drains inside sql.begin', async () => {
  for (const file of ROW_LOCKING_MODULES) {
    const content = await source(file);
    const blocks = extractTransactionBlocks(content);
    for (const block of blocks) {
      assert.doesNotMatch(
        block,
        FORBIDDEN_EXTERNAL_CALLS,
        `${file} must not invoke external calls inside a transaction block`,
      );
    }
  }
});

test('PayU callback and reconcile verify with PayU BEFORE opening the order status transaction', async () => {
  const processResponse = await source('src/lib/payu/process-response.ts');
  const verifyIdx = processResponse.indexOf('verifyPaymentWithPayU');
  const settleIdx = processResponse.indexOf('transitionOrderStatus({');
  assert.ok(verifyIdx > 0 && settleIdx > verifyIdx, 'processPayUCallback verifies before transitionOrderStatus');

  const reconcile = await source('src/lib/payu/reconcile.ts');
  const recBody = reconcile.slice(reconcile.indexOf('export async function reconcileOrderUsing'));
  const verifierCall = recBody.indexOf('await verifier(');
  const transitionCall = recBody.indexOf('await transitionOrderStatus(');
  assert.ok(verifierCall > 0 && transitionCall > verifierCall, 'reconcileOrderUsing awaits verifier before transitionOrderStatus');
});

test('notification outbox commits its FOR UPDATE SKIP LOCKED lease before calling deliver()', async () => {
  const outbox = await source('src/lib/notifications/outbox.ts');
  const claimFn = outbox.slice(
    outbox.indexOf('export async function claimNotificationBatch'),
    outbox.indexOf('async function markSent'),
  );
  assert.match(claimFn, /sql\.begin/);
  assert.match(claimFn, /for update skip locked/);
  assert.doesNotMatch(claimFn, /deliver/);

  const processFn = outbox.slice(outbox.indexOf('export async function processNotificationOutbox'));
  assert.doesNotMatch(processFn, /sql\.begin/, 'processNotificationOutbox runs deliver() outside sql.begin');
  assert.ok(processFn.indexOf('claimNotificationBatch(') < processFn.indexOf('await deliver('));
});

test('staff password hashing (bcrypt.hash) runs before opening the row-locking transaction', async () => {
  const staff = await source('src/lib/store-admin/staff.ts');
  const resetBody = staff.slice(
    staff.indexOf('export async function resetStaffPassword'),
    staff.indexOf('export async function updateOwnProfile'),
  );
  assert.ok(
    resetBody.indexOf('bcrypt.hash(') < resetBody.indexOf('sql.begin('),
    'resetStaffPassword hashes the new password before acquiring the row lock',
  );

  const changeBody = staff.slice(
    staff.indexOf('export async function changeOwnPassword'),
    staff.indexOf('export async function listStaffSessions'),
  );
  assert.ok(
    changeBody.indexOf('bcrypt.hash(') < changeBody.indexOf('sql.begin('),
    'changeOwnPassword hashes the new password before acquiring the row lock',
  );
});
