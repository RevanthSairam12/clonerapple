/**
 * Pure-Node Staging Checkout Concurrency & PayU Simulator Runner
 * (Zero-dependency Node.js equivalent of `scripts/perf/k6-staging-checkout.js`)
 *
 * Runs the four staging checkout cohorts:
 *   1. distinct_50  — 50 concurrent checkouts across distinct SKUs
 *   2. distinct_100 — 100 concurrent checkouts across distinct SKUs
 *   3. hot_50       — 50 concurrent checkouts on one hot SKU
 *   4. hot_100      — 100 concurrent checkouts on one hot SKU
 *
 * Usage:
 *   node scripts/perf/node-staging-checkout.mjs \
 *     --base-url https://staging.example.com \
 *     --distinct-skus apple-20w-usbc-power-adapter,apple-60w-usbc-charge-cable-1m,apple-earphones-usbc,apple-usbc-to-lightning-cable-1m \
 *     --hot-sku apple-20w-usbc-power-adapter
 */

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: process.env.BASE_URL || 'http://localhost:3000' },
    'distinct-skus': {
      type: 'string',
      default:
        process.env.DISTINCT_SKUS ||
        'apple-60w-usbc-charge-cable-1m,apple-20w-usbc-power-adapter,apple-usbc-to-lightning-cable-1m,apple-earphones-usbc,apple-earphones-lightning',
    },
    'hot-sku': { type: 'string', default: process.env.HOT_SKU || 'apple-20w-usbc-power-adapter' },
    'hot-variant-id': { type: 'string', default: process.env.HOT_VARIANT_ID || '' },
    scenario: { type: 'string', default: process.env.SCENARIO || 'all' },
    'simulator-status': { type: 'string', default: process.env.SIMULATOR_STATUS || 'failure' },
    'callback-route': { type: 'string', default: process.env.CALLBACK_ROUTE || 'webhook' },
  },
});

const BASE_URL = values['base-url'].replace(/\/$/, '');
const DISTINCT_SKUS = values['distinct-skus']
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HOT_SKU = values['hot-sku'].trim();
const HOT_VARIANT_ID = values['hot-variant-id'].trim() || null;
const PAYU_SALT = (process.env.PAYU_SALT || '').trim();
const SIMULATOR_STATUS = values['simulator-status'].trim();
const CALLBACK_ROUTE = values['callback-route'].trim();

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
}

function computePayUReverseHash({ salt, status, email, firstname, productinfo, amount, txnid, key }) {
  const formula = `${salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  return createHash('sha512').update(formula, 'utf8').digest('hex').toLowerCase();
}

async function runSingleBuyer({ cohort, vuIndex, sku, variantId }) {
  const fakeIp = `198.51.${(vuIndex % 250) + 1}.${(Math.floor(vuIndex / 250) % 250) + 1}`;
  const email = `loadtest.${cohort}.vu${vuIndex}.${Date.now()}@example.test`;
  const firstname = 'StagingLoad';

  const body = JSON.stringify({
    items: [{ id: sku, variantId: variantId || null, quantity: 1 }],
    customer: { firstname, email, phone: '9876543210' },
    shippingAddress: {
      name: 'Staging Load Buyer',
      phone: '9876543210',
      line1: '100 Bandra Kurla Complex',
      line2: 'Level 4',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400051',
    },
    marketingOptIn: false,
  });

  const t0 = performance.now();
  let status = 0;
  let parsed = null;
  let callbackMs = null;
  let callbackStatus = null;

  try {
    const res = await fetch(`${BASE_URL}/api/payu/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE_URL,
        Referer: `${BASE_URL}/checkout`,
        'X-Forwarded-For': fakeIp,
        ...(process.env.SESSION_COOKIE ? { Cookie: process.env.SESSION_COOKIE } : {}),
      },
      body,
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  } catch {
    status = 0;
  }
  const initiateMs = performance.now() - t0;

  if (status === 200 && PAYU_SALT && parsed?.fields?.txnid) {
    const fields = parsed.fields;
    const unmappedstatus = SIMULATOR_STATUS === 'failure' ? 'userCancelled' : 'captured';
    const hash = computePayUReverseHash({
      salt: PAYU_SALT,
      status: SIMULATOR_STATUS,
      email: fields.email || email,
      firstname: fields.firstname || firstname,
      productinfo: fields.productinfo || '',
      amount: fields.amount,
      txnid: fields.txnid,
      key: fields.key,
    });

    const form = new URLSearchParams({
      key: fields.key,
      txnid: fields.txnid,
      amount: fields.amount,
      productinfo: fields.productinfo || '',
      firstname: fields.firstname || firstname,
      email: fields.email || email,
      status: SIMULATOR_STATUS,
      unmappedstatus,
      hash,
    });

    const tCb = performance.now();
    try {
      const cbRes = await fetch(`${BASE_URL}/api/payu/${CALLBACK_ROUTE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-For': fakeIp,
        },
        body: form,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      callbackStatus = cbRes.status;
      await cbRes.body?.cancel();
    } catch {
      callbackStatus = 0;
    }
    callbackMs = performance.now() - tCb;
  }

  return { status, code: parsed?.code || null, initiateMs, callbackMs, callbackStatus };
}

async function runCohort(cohortName, concurrency, isHotSku) {
  const tasks = Array.from({ length: concurrency }, (_, i) => {
    const sku = isHotSku ? HOT_SKU : DISTINCT_SKUS[i % DISTINCT_SKUS.length];
    const variantId = isHotSku ? HOT_VARIANT_ID : null;
    return runSingleBuyer({ cohort: cohortName, vuIndex: i + 1, sku, variantId });
  });

  const results = await Promise.all(tasks);
  const timings = results.map((r) => r.initiateMs).sort((a, b) => a - b);
  const cbTimings = results
    .filter((r) => r.callbackMs !== null)
    .map((r) => r.callbackMs)
    .sort((a, b) => a - b);

  const statusCounts = {};
  let unhandled5xx = 0;
  for (const r of results) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    if (r.status === 0 || r.status === 500 || r.status === 502 || r.status === 504) {
      unhandled5xx += 1;
    }
  }

  return {
    cohort: cohortName,
    concurrency,
    mode: isHotSku ? 'hot_sku' : 'distinct_skus',
    p50_ms: percentile(timings, 50),
    p95_ms: percentile(timings, 95),
    p99_ms: percentile(timings, 99),
    max_ms: percentile(timings, 100),
    statusCounts,
    unhandled5xx,
    errorRate5xx: Number((unhandled5xx / concurrency).toFixed(4)),
    simulatorCallbacks: {
      sent: cbTimings.length,
      p50_ms: percentile(cbTimings, 50),
      p95_ms: percentile(cbTimings, 95),
    },
  };
}

async function main() {
  const cohorts = [
    ['distinct_50', 50, false],
    ['distinct_100', 100, false],
    ['hot_50', 50, true],
    ['hot_100', 100, true],
  ].filter(([name]) => values.scenario === 'all' || values.scenario === name);

  const reports = [];
  for (const [name, concurrency, isHot] of cohorts) {
    reports.push(await runCohort(name, concurrency, isHot));
  }

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        expectedRegions: {
          supabase: 'ap-south-1 (Mumbai)',
          vercel: 'bom1 (Mumbai)',
        },
        cohorts: reports,
      },
      null,
      2,
    ),
  );
}

await main();
