// User-approved temporary-schema batch; deliberately excludes public-writing scripts.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const files = [
  'coupon-db-integration', 'coupon-order-integration',
  'flash-sale-reconcile-integration', 'flash-sale-reservation-integration',
  'inventory-controls', 'late-payment-stock-integration', 'maintenance-integration',
  'notifications-enqueue-integration', 'notifications-outbox-integration',
  'order-cancel-stock-integration', 'order-stock-integration', 'pos-entered-prices',
  'reports-correctness-integration', 'sale-admin', 'sale-boundary-display',
  'sale-price-entry', 'sale-pricing', 'staff-accounts-integration', 'stock-behaviour',
  'phase5-option-lifecycle',
  'payu-callback-integration', 'shipping-order-integration',
];
const selected = process.argv.slice(2);
if (selected.some(file => !files.includes(file))) throw new Error('Unknown test file');
const config = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  config[match[1]] = value;
}
const url = process.env.DATABASE_URL || config.DATABASE_URL;
const target = new URL(url);
if (target.hostname !== 'aws-0-ap-northeast-1.pooler.supabase.com' || target.pathname !== '/postgres' || (target.port && target.port !== '5432')) throw new Error('Approved target mismatch; no connection attempted');
const directory = fs.mkdtempSync('.tmp-approved-sql-');
console.log('Evidence directory:', directory);
const results = [];
for (const file of selected.length ? selected : files) {
  const log = path.join(directory, `${file}.log`);
  const fd = fs.openSync(log, 'wx');
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', `tests/${file}.test.mjs`], {
    env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: config.DATABASE_SSL || 'true',
      RUN_LEGACY_DB_TESTS: '1', RUN_PAYU_CALLBACK_INTEGRATION: '1', RUN_SHIPPING_ORDER_INTEGRATION: '1',
      RUN_PHASE2_DB_TESTS: '0', RUN_PHASE3_DB_TESTS: '0', RUN_PHASE4_DB_TESTS: '0' },
    stdio: ['ignore', fd, fd],
    // Remote latency makes schema-heavy suites slow; let node:test finish its
    // finally cleanup instead of killing a healthy test at an arbitrary deadline.
    timeout: 0,
  });
  fs.closeSync(fd);
  const text = fs.readFileSync(log, 'utf8');
  const metric = name => Number(text.match(new RegExp(`(?:#|ℹ) ${name} (\\d+)`))?.[1] ?? -1);
  const complete = !result.error && !result.signal && result.status !== null &&
    ['tests', 'pass', 'fail', 'skipped'].every(name => metric(name) >= 0);
  const row = { file, exit: result.status, signal: result.signal, complete,
    ...(result.error ? { errorCode: result.error.code || 'SPAWN_ERROR' } : {}),
    tests: metric('tests'), pass: metric('pass'), fail: metric('fail'), skipped: metric('skipped'), log };
  results.push(row);
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(row));
  // A crashed/timed-out process might not have cleaned its schema. Stop, do not
  // adopt/drop any leftover namespace or run more test work after such a failure.
  if (!complete || result.status !== 0) break;
}
process.exitCode = results.some(row => row.exit !== 0 || !row.complete) ? 1 : 0;
