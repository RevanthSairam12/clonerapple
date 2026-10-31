import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('message centre: enqueue attaches customer user id and marks inapp SENT', async () => {
  const enqueueModule = await readFile(path.resolve('src/lib/notifications/enqueue.ts'), 'utf8');

  // Must connect customer in-app to customerUserId and mark SENT
  assert.match(enqueueModule, /channel\s*===\s*'inapp'\s*&&\s*audience\s*===\s*'customer'/);
  assert.match(enqueueModule, /status\s*=\s*'SENT'/);
  assert.match(enqueueModule, /customer_user_id/);
});

test('message centre: retention scrub displays neutral line when body is cleared', async () => {
  const messagesModule = await readFile(path.resolve('src/lib/account/messages.ts'), 'utf8');

  assert.match(messagesModule, /RETENTION_ARCHIVED_TEXT/);
  assert.match(messagesModule, /Message details archived according to data retention policy/);
});

test('message centre: owner-scoped unread count, mark read and mark all read', async () => {
  const messagesModule = await readFile(path.resolve('src/lib/account/messages.ts'), 'utf8');

  assert.match(messagesModule, /where\s+customer_user_id\s*=\s*\$\{userId\}\s+and\s+read_at\s+is\s+null/i);
  assert.match(messagesModule, /set\s+read_at\s*=\s*now\(\)[\s\S]*where\s+id\s*=\s*\$\{messageId\}\s+and\s+customer_user_id\s*=\s*\$\{userId\}/i);
  assert.match(messagesModule, /set\s+read_at\s*=\s*now\(\)[\s\S]*where\s+customer_user_id\s*=\s*\$\{userId\}\s+and\s+read_at\s+is\s+null/i);
});

test('message centre: route is guarded and force-dynamic', async () => {
  const pageFile = await readFile(path.resolve('src/app/account/messages/page.tsx'), 'utf8');
  assert.match(pageFile, /requireAccountPageSession\('\/account\/messages'\)/);
  assert.match(pageFile, /export\s+const\s+dynamic\s*=\s*'force-dynamic'/);
});
