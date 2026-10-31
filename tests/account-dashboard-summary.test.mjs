import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('dashboard summary: aggregates all 8 cards in bounded queries', async () => {
  const summaryModule = await readFile(path.resolve('src/lib/account/dashboard-summary.ts'), 'utf8');

  // Must include all card models
  assert.match(summaryModule, /user:\s*\{/);
  assert.match(summaryModule, /orders:\s*\{/);
  assert.match(summaryModule, /requests:\s*\{/);
  assert.match(summaryModule, /addresses:\s*\{/);
  assert.match(summaryModule, /security:\s*\{/);
  assert.match(summaryModule, /coupons:\s*\{/);
  assert.match(summaryModule, /messages:\s*\{/);
  assert.match(summaryModule, /support:\s*\{/);

  // Must batch in parallel queries, not per-card fan-out
  assert.match(summaryModule, /Promise\.all\(\[/);
  assert.match(summaryModule, /maskAccountEmail/);
});

test('dashboard page: renders responsive grid of 8 cards and grouped links', async () => {
  const pageFile = await readFile(path.resolve('src/app/account/page.tsx'), 'utf8');

  // Responsive grid: 3 on desktop, 2 on tablet, 1 on mobile
  assert.match(pageFile, /grid[\s\S]*sm:grid-cols-2[\s\S]*lg:grid-cols-3/);

  // Card headings
  assert.match(pageFile, /Your Orders/);
  assert.match(pageFile, /Returns and requests/);
  assert.match(pageFile, /Your Addresses/);
  assert.match(pageFile, /Login and security/);
  assert.match(pageFile, /Your Coupons/);
  assert.match(pageFile, /Message centre/);
  assert.match(pageFile, /Profile/);
  assert.match(pageFile, /Contact and support/);

  // Grouped links
  assert.match(pageFile, /Orders (&|&amp;) Shopping/);
  assert.match(pageFile, /Messages (&|&amp;) Offers/);
  assert.match(pageFile, /Login (&|&amp;) Security/);
  assert.match(pageFile, /Manage Your Data/);

  // Bottom personalized rows
  assert.match(pageFile, /<BuyAgainRow/);
  assert.match(pageFile, /Recently viewed/);
  assert.match(pageFile, /Inspired by your browsing history/);
});

test('dashboard home: page is force-dynamic and guarded', async () => {
  const pageFile = await readFile(path.resolve('src/app/account/page.tsx'), 'utf8');
  assert.match(pageFile, /requireAccountPageSession\('\/account'\)/);
  assert.match(pageFile, /export\s+const\s+dynamic\s*=\s*'force-dynamic'/);
});

test('header: displays live account context for signed-in customer', async () => {
  const headerFile = await readFile(path.resolve('src/components/header/GadzioHeader.tsx'), 'utf8');

  assert.match(headerFile, /unreadMessagesCount/);
  assert.match(headerFile, /customerFirstName/);
  assert.match(headerFile, /bg-\[#0071e3\]/); // Unread badge/dot
});
