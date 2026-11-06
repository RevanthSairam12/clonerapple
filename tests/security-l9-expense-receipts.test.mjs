/**
 * SECURITY (L-9): expense receipts are stored in the public `media` bucket via
 * `store_media`, so anyone holding the object URL can read them. Splitting the
 * bucket is a storage migration and was deliberately deferred, not forgotten.
 *
 * This test pins the written acceptance so a future refactor of expense
 * attachments sees it, and confirms no half-done bucket change was left behind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('the expense-receipt risk is documented as accepted', async () => {
  const doc = await readFile(path.join(root, 'docs', 'security-known-risks-20261106.md'), 'utf8');
  assert.match(doc, /## L-9 — Expense receipts live in the public `media` bucket/);
  assert.match(doc, /private `expense-receipts` bucket/);
  assert.match(doc, /What would close it/);
});

test('expense attachments still read store_media, with no partial bucket split', async () => {
  const source = await readFile(path.join(root, 'src', 'lib', 'store-admin', 'expenses.ts'), 'utf8');
  assert.match(source, /join store_media m on m\.id = e\.attachment_media_id/);
  assert.doesNotMatch(source, /expense-receipts/);
  assert.doesNotMatch(source, /createSignedUrl|signedUrl/);
});
