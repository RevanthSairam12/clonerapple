/**
 * Gadzio Staging Checkout Concurrency & PayU Simulator Load Test (k6)
 *
 * Covers the four staging load scenarios required before production launch:
 *   1. distinct_50  — 50 concurrent checkouts distributed across distinct SKUs
 *   2. distinct_100 — 100 concurrent checkouts distributed across distinct SKUs
 *   3. hot_50       — 50 concurrent checkouts contending on ONE hot SKU
 *   4. hot_100      — 100 concurrent checkouts contending on ONE hot SKU
 *
 * Each virtual user executes:
 *   Step A: POST /api/payu/initiate (locks stock, prices cart, creates order, returns txnid & signed fields)
 *   Step B: If PAYU_SALT is supplied and initiate succeeded (HTTP 200), posts a signed PayU simulator
 *           callback to /api/payu/webhook (or /api/payu/success) to exercise the callback & reverse-hash path.
 *
 * Target Region Configuration:
 *   - Supabase Project Region: ap-south-1 (Mumbai)
 *   - Vercel Function Region:  bom1 (Mumbai)
 *
 * Usage:
 *   # Run all 4 scenarios sequentially:
 *   k6 run -e BASE_URL=https://staging.example.com \
 *          -e DISTINCT_SKUS=apple-20w-usbc-power-adapter,apple-60w-usbc-charge-cable-1m,apple-earphones-usbc,apple-usbc-to-lightning-cable-1m \
 *          -e HOT_SKU=apple-20w-usbc-power-adapter \
 *          -e PAYU_SALT=$PAYU_SALT \
 *          scripts/perf/k6-staging-checkout.js
 *
 *   # Run a single scenario (e.g. hot_100):
 *   k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=hot_100 scripts/perf/k6-staging-checkout.js
 */

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SELECTED_SCENARIO = (__ENV.SCENARIO || 'all').trim();
const PAYU_SALT = (__ENV.PAYU_SALT || '').trim();
const CALLBACK_ROUTE = (__ENV.CALLBACK_ROUTE || 'webhook').trim(); // 'webhook' or 'success'

const DISTINCT_SKUS = (
  __ENV.DISTINCT_SKUS ||
  'apple-60w-usbc-charge-cable-1m,apple-20w-usbc-power-adapter,apple-usbc-to-lightning-cable-1m,apple-earphones-usbc,apple-earphones-lightning'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const HOT_SKU = (__ENV.HOT_SKU || DISTINCT_SKUS[0] || 'apple-20w-usbc-power-adapter').trim();
const HOT_VARIANT_ID = (__ENV.HOT_VARIANT_ID || '').trim() || null;

// Per-scenario latency trends (ms)
const latencyDistinct50 = new Trend('checkout_latency_distinct_50_ms', true);
const latencyDistinct100 = new Trend('checkout_latency_distinct_100_ms', true);
const latencyHot50 = new Trend('checkout_latency_hot_50_ms', true);
const latencyHot100 = new Trend('checkout_latency_hot_100_ms', true);
const callbackLatency = new Trend('payu_simulator_callback_latency_ms', true);

// Error and outcome rates/counters
const unhandled5xxRate = new Rate('checkout_unhandled_5xx_rate');
const busy503Counter = new Counter('checkout_503_busy_lock_timeout');
const outOfStock409Counter = new Counter('checkout_409_out_of_stock');
const rateLimited429Counter = new Counter('checkout_429_rate_limited');
const initiated200Counter = new Counter('checkout_200_initiated');
const simulatorCallbacksSent = new Counter('payu_simulator_callbacks_sent');

const allScenarios = {
  distinct_50: {
    executor: 'per-vu-iterations',
    vus: 50,
    iterations: 1,
    maxDuration: '30s',
    startTime: '0s',
    exec: 'runDistinct50',
    tags: { cohort: 'distinct_50', mode: 'distinct', concurrency: '50' },
  },
  distinct_100: {
    executor: 'per-vu-iterations',
    vus: 100,
    iterations: 1,
    maxDuration: '45s',
    startTime: SELECTED_SCENARIO === 'all' ? '35s' : '0s',
    exec: 'runDistinct100',
    tags: { cohort: 'distinct_100', mode: 'distinct', concurrency: '100' },
  },
  hot_50: {
    executor: 'per-vu-iterations',
    vus: 50,
    iterations: 1,
    maxDuration: '30s',
    startTime: SELECTED_SCENARIO === 'all' ? '85s' : '0s',
    exec: 'runHot50',
    tags: { cohort: 'hot_50', mode: 'hot_sku', concurrency: '50' },
  },
  hot_100: {
    executor: 'per-vu-iterations',
    vus: 100,
    iterations: 1,
    maxDuration: '45s',
    startTime: SELECTED_SCENARIO === 'all' ? '120s' : '0s',
    exec: 'runHot100',
    tags: { cohort: 'hot_100', mode: 'hot_sku', concurrency: '100' },
  },
};

export const options = {
  scenarios:
    SELECTED_SCENARIO !== 'all' && allScenarios[SELECTED_SCENARIO]
      ? { [SELECTED_SCENARIO]: allScenarios[SELECTED_SCENARIO] }
      : allScenarios,
  thresholds: {
    checkout_unhandled_5xx_rate: ['rate==0'],
    checkout_latency_distinct_50_ms: ['p(50)<600', 'p(95)<1500'],
    checkout_latency_distinct_100_ms: ['p(50)<1000', 'p(95)<2500'],
    checkout_latency_hot_50_ms: ['p(50)<1500', 'p(95)<5200'],
    checkout_latency_hot_100_ms: ['p(50)<2500', 'p(95)<5500'],
  },
};

/**
 * Compute PayU Reverse Hash matching `computeReverseHash` in `src/lib/payu/hash.ts`:
 * sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
function computePayUReverseHash({ salt, status, email, firstname, productinfo, amount, txnid, key }) {
  const formula = `${salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  return crypto.sha512(formula, 'hex').toLowerCase();
}

function executeCheckout(sku, variantId, cohortTag, trendMetric) {
  // Unique synthetic IP per VU/iteration so per-IP rate limiting (20/5m) does not mask DB concurrency
  const fakeIp = `198.51.${(__VU % 250) + 1}.${((__ITER + 1) % 250) + 1}`;
  const email = `loadtest.${cohortTag}.vu${__VU}.it${__ITER}@example.test`;
  const firstname = 'StagingLoad';

  const body = JSON.stringify({
    items: [
      {
        id: sku,
        variantId: variantId || null,
        quantity: 1,
      },
    ],
    customer: {
      firstname,
      email,
      phone: '9876543210',
    },
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

  const res = http.post(`${BASE_URL}/api/payu/initiate`, body, {
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/checkout`,
      'X-Forwarded-For': fakeIp,
      ...(__ENV.SESSION_COOKIE ? { Cookie: __ENV.SESSION_COOKIE } : {}),
    },
    tags: { cohort: cohortTag, step: 'initiate' },
  });

  trendMetric.add(res.timings.duration);

  const isUnhandled5xx = res.status === 500 || res.status === 502 || res.status === 504;
  unhandled5xxRate.add(isUnhandled5xx);

  if (res.status === 200) initiated200Counter.add(1, { cohort: cohortTag });
  if (res.status === 409) outOfStock409Counter.add(1, { cohort: cohortTag });
  if (res.status === 429) rateLimited429Counter.add(1, { cohort: cohortTag });
  if (res.status === 503) busy503Counter.add(1, { cohort: cohortTag });

  check(res, {
    [`[${cohortTag}] status is 200 (initiated), 409 (stock/conflict), or 503 (busy with Retry-After)`]: (r) =>
      r.status === 200 ||
      r.status === 409 ||
      (r.status === 503 && r.headers['Retry-After'] !== undefined),
    [`[${cohortTag}] zero unhandled 500`]: (r) => r.status !== 500,
  });

  // Step B: PayU Simulator Callback Path when initiate succeeded and PAYU_SALT is provided
  if (res.status === 200 && PAYU_SALT) {
    let parsed = null;
    try {
      parsed = res.json();
    } catch {
      parsed = null;
    }

    const fields = parsed && parsed.fields;
    if (fields && fields.txnid && fields.amount && fields.key) {
      const simStatus = __ENV.SIMULATOR_STATUS || 'failure'; // 'failure' or 'success'
      const unmappedstatus = simStatus === 'failure' ? 'userCancelled' : 'captured';
      const reverseHash = computePayUReverseHash({
        salt: PAYU_SALT,
        status: simStatus,
        email: fields.email || email,
        firstname: fields.firstname || firstname,
        productinfo: fields.productinfo || '',
        amount: fields.amount,
        txnid: fields.txnid,
        key: fields.key,
      });

      const formPayload = {
        key: fields.key,
        txnid: fields.txnid,
        amount: fields.amount,
        productinfo: fields.productinfo || '',
        firstname: fields.firstname || firstname,
        email: fields.email || email,
        status: simStatus,
        unmappedstatus,
        hash: reverseHash,
      };

      const cbRes = http.post(`${BASE_URL}/api/payu/${CALLBACK_ROUTE}`, formPayload, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-For': fakeIp,
        },
        redirects: 0,
        tags: { cohort: cohortTag, step: 'payu_simulator_callback' },
      });

      callbackLatency.add(cbRes.timings.duration);
      simulatorCallbacksSent.add(1, { cohort: cohortTag });
      unhandled5xxRate.add(cbRes.status === 500 || cbRes.status === 502 || cbRes.status === 504);
    }
  }

  sleep(0.05);
}

export function runDistinct50() {
  const sku = DISTINCT_SKUS[(__VU - 1) % DISTINCT_SKUS.length];
  executeCheckout(sku, null, 'distinct_50', latencyDistinct50);
}

export function runDistinct100() {
  const sku = DISTINCT_SKUS[(__VU - 1) % DISTINCT_SKUS.length];
  executeCheckout(sku, null, 'distinct_100', latencyDistinct100);
}

export function runHot50() {
  executeCheckout(HOT_SKU, HOT_VARIANT_ID, 'hot_50', latencyHot50);
}

export function runHot100() {
  executeCheckout(HOT_SKU, HOT_VARIANT_ID, 'hot_100', latencyHot100);
}

export function handleSummary(data) {
  const m = (name) => data.metrics[name]?.values || {};
  const formatTrend = (name) => ({
    p50_ms: m(name).med ?? null,
    p95_ms: m(name)['p(95)'] ?? null,
    p99_ms: m(name)['p(99)'] ?? null,
    max_ms: m(name).max ?? null,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    targetBaseUrl: BASE_URL,
    expectedTopology: {
      supabaseRegion: 'ap-south-1 (Mumbai)',
      vercelFunctionRegion: 'bom1 (Mumbai)',
    },
    cohorts: {
      distinct_50: formatTrend('checkout_latency_distinct_50_ms'),
      distinct_100: formatTrend('checkout_latency_distinct_100_ms'),
      hot_50: formatTrend('checkout_latency_hot_50_ms'),
      hot_100: formatTrend('checkout_latency_hot_100_ms'),
      payu_simulator_callback: formatTrend('payu_simulator_callback_latency_ms'),
    },
    outcomes: {
      initiated_200: m('checkout_200_initiated').count ?? 0,
      out_of_stock_409: m('checkout_409_out_of_stock').count ?? 0,
      busy_lock_timeout_503: m('checkout_503_busy_lock_timeout').count ?? 0,
      rate_limited_429: m('checkout_429_rate_limited').count ?? 0,
      simulator_callbacks_sent: m('payu_simulator_callbacks_sent').count ?? 0,
      unhandled_5xx_rate: m('checkout_unhandled_5xx_rate').rate ?? 0,
    },
  };

  return {
    stdout: `\n=== GADZIO STAGING CHECKOUT LOAD REPORT ===\n${JSON.stringify(report, null, 2)}\n`,
    'staging-checkout-k6-summary.json': JSON.stringify(report, null, 2),
  };
}
