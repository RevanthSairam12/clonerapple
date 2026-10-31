import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('browsing history: product detail pages record only for signed-in sessions', async () => {
  const buyPage = await readFile(path.resolve('src/app/shop/buy/[productId]/page.tsx'), 'utf8');
  const productPage = await readFile(path.resolve('src/app/shop/product/[productId]/page.tsx'), 'utf8');

  // Must call getUserSession and only record if session exists
  assert.match(buyPage, /getUserSession\(\)/);
  assert.match(buyPage, /if\s*\(\s*session\s*\)\s*\{[\s\S]*recordProductView\(/);
  assert.match(productPage, /getUserSession\(\)/);
  assert.match(productPage, /if\s*\(\s*session\s*\)\s*\{[\s\S]*recordProductView\(/);
});

test('browsing history: cap of 50 and 90-day retention query', async () => {
  const historyModule = await readFile(path.resolve('src/lib/account/browsing-history.ts'), 'utf8');

  // Must define 50 cap and 90 retention days
  assert.match(historyModule, /MAX_BROWSING_HISTORY_ITEMS\s*=\s*50/);
  assert.match(historyModule, /BROWSING_HISTORY_RETENTION_DAYS\s*=\s*90/);
  assert.match(historyModule, /delete\s+from\s+customer_browsing_history[\s\S]*order\s+by\s+last_viewed_at\s+desc[\s\S]*limit/i);
  assert.match(historyModule, /delete\s+from\s+customer_browsing_history[\s\S]*last_viewed_at\s*</i);
});

test('browsing history: reconcile cron runs 90-day history pruning', async () => {
  const cronRoute = await readFile(path.resolve('src/app/api/payu/reconcile/route.ts'), 'utf8');
  assert.match(cronRoute, /pruneOldBrowsingHistory\(90\)/);
});

test('browsing history: toggle opt-out and clear all logic exists and is owner-scoped', async () => {
  const historyApi = await readFile(path.resolve('src/app/api/account/history/route.ts'), 'utf8');
  const settingsApi = await readFile(path.resolve('src/app/api/account/history/settings/route.ts'), 'utf8');

  assert.match(historyApi, /requireAccountSessionApi\(\)/);
  assert.match(historyApi, /clearBrowsingHistory\(auth\.session\.userId\)/);
  assert.match(historyApi, /assertSameOrigin\(request\)/);

  assert.match(settingsApi, /requireAccountSessionApi\(\)/);
  assert.match(settingsApi, /setBrowsingHistorySettings\(auth\.session\.userId/);
  assert.match(settingsApi, /assertSameOrigin\(request\)/);
});
