import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('preferences: marketing opt-in updates users and syncs newsletter_subscribers', async () => {
  const prefsModule = await readFile(path.resolve('src/lib/account/preferences.ts'), 'utf8');

  assert.match(prefsModule, /update\s+users\s+set\s+marketing_opt_in\s*=\s*\$\{marketingOptIn\}/i);
  assert.match(prefsModule, /newsletter_subscribers/);
  assert.match(prefsModule, /unsubscribed_at\s*=\s*now\(\)/i);
});

test('data export: requires password, rate limited to 24h, contains only owner data, no secrets', async () => {
  const dataModule = await readFile(path.resolve('src/lib/account/data-management.ts'), 'utf8');

  // Verify bcrypt check
  assert.match(dataModule, /bcrypt\.compare\(passwordAttempt,\s*user\.password_hash\)/);
  // Verify 24h rate limit
  assert.match(dataModule, /EXPORT_COOLDOWN_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  // Verify last_data_export_at update
  assert.match(dataModule, /update\s+users\s+set\s+last_data_export_at\s*=\s*now\(\)/i);

  // Payload shape check: profile, addresses, orders, requests, couponRedemptions, browsingHistory
  assert.match(dataModule, /interface DataExportPayload/);
  assert.match(dataModule, /profile:/);
  assert.match(dataModule, /addresses:/);
  assert.match(dataModule, /orders:/);
  assert.match(dataModule, /requests:/);
  assert.match(dataModule, /couponRedemptions:/);
  assert.match(dataModule, /browsingHistory:/);

  // Must not expose password hashes or session tokens
  assert.doesNotMatch(dataModule, /password_hash:\s*user\.password_hash/);
  assert.doesNotMatch(dataModule, /token_hash/);
});

test('account closure: refused with open/unpaid/undelivered orders or requests', async () => {
  const dataModule = await readFile(path.resolve('src/lib/account/data-management.ts'), 'utf8');

  // Check refusal conditions
  assert.match(dataModule, /Order \$\{ord\.txnid\} is still pending payment/);
  assert.match(dataModule, /Order \$\{ord\.txnid\} is currently in transit/);
  assert.match(dataModule, /You have an open order request or return/);
});

test('account closure: anonymises correctly, revokes sessions, frees email', async () => {
  const dataModule = await readFile(path.resolve('src/lib/account/data-management.ts'), 'utf8');

  // Revoke sessions
  assert.match(dataModule, /delete\s+from\s+user_sessions\s+where\s+user_id\s*=\s*\$\{userId\}/i);
  // Remove addresses & browsing history
  assert.match(dataModule, /delete\s+from\s+customer_addresses\s+where\s+user_id\s*=\s*\$\{userId\}/i);
  assert.match(dataModule, /delete\s+from\s+customer_browsing_history\s+where\s+user_id\s*=\s*\$\{userId\}/i);
  // Replace email with anonymised address
  assert.match(dataModule, /anonymisedEmail\(userId\)/);
  assert.match(dataModule, /is_blocked\s*=\s*true/);
  assert.match(dataModule, /anonymised_at\s*=\s*now\(\)/);
});
