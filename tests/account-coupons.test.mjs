import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('coupons page: lists only private coupons assigned to email or customer group', async () => {
  const couponsModule = await readFile(path.resolve('src/lib/account/coupons.ts'), 'utf8');

  // Must check status active and dates
  assert.match(couponsModule, /status\s*=\s*'active'/);
  assert.match(couponsModule, /starts_at\s*<=\s*now\(\)/);
  // Must exclude public coupons: requires restricted_to_emails or allowed_customer_groups
  assert.match(couponsModule, /restricted_to_emails\s+is\s+not\s+null/);
  assert.match(couponsModule, /allowed_customer_groups\s+is\s+not\s+null/);
});

test('coupons page: never leaks total limits, internal names or other customers use', async () => {
  const couponsModule = await readFile(path.resolve('src/lib/account/coupons.ts'), 'utf8');

  // Customer view model must only export customer-safe fields
  assert.doesNotMatch(couponsModule, /totalRedemptionLimit\s*:/);
  assert.doesNotMatch(couponsModule, /internalName\s*:/);
  assert.match(couponsModule, /interface CustomerCouponView/);
  assert.match(couponsModule, /remainingDisplay\s*:/);
});

test('coupons page: account route is guarded and force-dynamic', async () => {
  const pageFile = await readFile(path.resolve('src/app/account/coupons/page.tsx'), 'utf8');
  assert.match(pageFile, /requireAccountPageSession\('\/account\/coupons'\)/);
  assert.match(pageFile, /export\s+const\s+dynamic\s*=\s*'force-dynamic'/);
});
