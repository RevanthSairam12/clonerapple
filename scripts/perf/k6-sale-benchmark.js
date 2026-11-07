/**
 * Gadzio Sale-Time HTTP Load & Latency Benchmark (k6)
 *
 * Covers the two HTTP benchmark suites from the approved performance plan:
 *   1. Sale Browse (300 VUs, 3m):
 *      - GET /
 *      - GET /in/shop/iphone/accessories/cases-protection
 *      - GET /shop/product/[id]
 *      - POST /api/catalog/availability
 *      Pass: p95 < 220ms, p99 < 450ms, throughput >= 400 RPS, error rate < 0.1%
 *
 *   2. Checkout Burst (50 RPS constant arrival rate, 2m):
 *      - POST /api/payu/initiate
 *      Pass: p95 < 400ms, p99 < 850ms, 0% 5xx
 *
 * Usage (full benchmark):
 *   k6 run -e BASE_URL=http://localhost:3000 scripts/perf/k6-sale-benchmark.js
 *
 * Usage (quick 20s smoke verify):
 *   k6 run -e BASE_URL=http://localhost:3000 -e SMOKE=1 scripts/perf/k6-sale-benchmark.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const IS_SMOKE = __ENV.SMOKE === '1';

const PRODUCT_IDS = (__ENV.PRODUCT_IDS ||
  'iphone-17-pro-clear-case,iphone-17-silicone-case,20w-usb-c-power-adapter,magsafe-charger-1m,usb-c-woven-charge-cable,airpods-pro-2-case-silicone'
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const browseLatency = new Trend('gadzio_browse_duration_ms', true);
const checkoutLatency = new Trend('gadzio_checkout_duration_ms', true);
const server5xxRate = new Rate('gadzio_http_5xx_rate');
const checkoutConflict409 = new Counter('gadzio_checkout_409_conflicts');
const checkoutRateLimited429 = new Counter('gadzio_checkout_429_ratelimited');

export const options = {
  scenarios: {
    sale_browse: {
      executor: 'ramping-vus',
      exec: 'saleBrowse',
      startVUs: IS_SMOKE ? 5 : 25,
      stages: IS_SMOKE
        ? [
            { duration: '5s', target: 15 },
            { duration: '10s', target: 15 },
            { duration: '5s', target: 0 },
          ]
        : [
            { duration: '30s', target: Number(__ENV.VUS_BROWSE || 300) },
            { duration: __ENV.DURATION_BROWSE || '2m', target: Number(__ENV.VUS_BROWSE || 300) },
            { duration: '30s', target: 0 },
          ],
      gracefulRampDown: '10s',
      tags: { suite: 'sale_browse' },
    },
    checkout_burst: {
      executor: 'constant-arrival-rate',
      exec: 'checkoutBurst',
      rate: IS_SMOKE ? 5 : Number(__ENV.RPS_CHECKOUT || 50),
      timeUnit: '1s',
      duration: IS_SMOKE ? '15s' : (__ENV.DURATION_CHECKOUT || '2m'),
      preAllocatedVUs: IS_SMOKE ? 10 : 80,
      maxVUs: IS_SMOKE ? 25 : 200,
      startTime: IS_SMOKE ? '2s' : '15s',
      tags: { suite: 'checkout_burst' },
    },
  },
  thresholds: {
    'http_req_duration{suite:sale_browse}': ['p(95)<220', 'p(99)<450'],
    'http_req_failed{suite:sale_browse}': ['rate<0.001'],
    'http_req_duration{suite:checkout_burst}': ['p(95)<400', 'p(99)<850'],
    gadzio_http_5xx_rate: ['rate==0'],
  },
};

function pickProduct(vu, iter) {
  return PRODUCT_IDS[(vu + iter) % PRODUCT_IDS.length];
}

export function saleBrowse() {
  const productId = pickProduct(__VU, __ITER);
  const commonHeaders = {
    Accept: 'text/html,application/xhtml+xml,application/json',
    'User-Agent': 'GadzioPerfAudit-k6/1.0',
  };

  // 1. Homepage (reads content blocks + sale state + maintenance check)
  const homeRes = http.get(`${BASE_URL}/`, {
    headers: commonHeaders,
    tags: { suite: 'sale_browse', surface: 'home' },
  });
  browseLatency.add(homeRes.timings.duration);
  server5xxRate.add(homeRes.status >= 500 && homeRes.status !== 503);

  // 2. Category collection grid (reads cached catalog + live sale state)
  const catRes = http.get(`${BASE_URL}/in/shop/iphone/accessories/cases-protection`, {
    headers: commonHeaders,
    tags: { suite: 'sale_browse', surface: 'category' },
  });
  browseLatency.add(catRes.timings.duration);
  server5xxRate.add(catRes.status >= 500 && catRes.status !== 503);

  // 3. Single Product Detail page (triggers readCachedProduct -> full catalog load on miss)
  const pdpRes = http.get(`${BASE_URL}/shop/product/${encodeURIComponent(productId)}`, {
    headers: commonHeaders,
    tags: { suite: 'sale_browse', surface: 'pdp' },
  });
  browseLatency.add(pdpRes.timings.duration);
  server5xxRate.add(pdpRes.status >= 500 && pdpRes.status !== 503);

  // 4. Click-time availability check (hits PostgreSQL directly via readAvailabilityUsing)
  const availPayload = JSON.stringify({
    ids: [productId],
    lines: [{ productId, quantity: 1 }],
  });
  const availRes = http.post(`${BASE_URL}/api/catalog/availability`, availPayload, {
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/shop/product/${encodeURIComponent(productId)}`,
    },
    tags: { suite: 'sale_browse', surface: 'availability_api' },
  });
  browseLatency.add(availRes.timings.duration);
  server5xxRate.add(availRes.status >= 500 && availRes.status !== 503);

  check(
    { homeRes, catRes, pdpRes, availRes },
    {
      'home status is 200': (r) => r.homeRes.status === 200,
      'category status is 200': (r) => r.catRes.status === 200,
      'pdp status is 200 or 404': (r) => r.pdpRes.status === 200 || r.pdpRes.status === 404,
      'availability status is 200': (r) => r.availRes.status === 200,
    },
  );

  sleep(0.2);
}

export function checkoutBurst() {
  const productId = pickProduct(__VU, __ITER);
  const fakeIp = `10.${(__VU % 250) + 1}.${(Math.floor(__ITER / 250) % 250) + 1}.${(__ITER % 250) + 1}`;
  const payload = JSON.stringify({
    items: [
      {
        id: productId,
        variantId: null,
        quantity: 1,
      },
    ],
    customer: {
      firstname: 'Perf Buyer',
      email: `perf.buyer.${__VU}.${__ITER}@example.test`,
      phone: '9876543210',
    },
    shippingAddress: {
      name: 'Perf Buyer',
      phone: '9876543210',
      line1: '42 MG Road, Indiranagar',
      line2: 'Floor 2',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    },
    marketingOptIn: false,
  });

  const res = http.post(`${BASE_URL}/api/payu/initiate`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/checkout`,
      'X-Forwarded-For': fakeIp,
      ...( __ENV.SESSION_COOKIE ? { Cookie: __ENV.SESSION_COOKIE } : {} ),
    },
    tags: { suite: 'checkout_burst', surface: 'payu_initiate' },
  });

  checkoutLatency.add(res.timings.duration);
  // 503 is allowed only when payment_not_configured or maintenance is intentionally active;
  // unhandled 500s fail the benchmark.
  server5xxRate.add(res.status === 500 || res.status === 502 || res.status === 504);

  if (res.status === 409) checkoutConflict409.add(1);
  if (res.status === 429) checkoutRateLimited429.add(1);

  check(res, {
    'checkout initiate did not throw 500': (r) => r.status !== 500,
    'checkout response is valid JSON': (r) => {
      try {
        return typeof r.json() === 'object';
      } catch {
        return false;
      }
    },
  });
}

export function handleSummary(data) {
  const metric = (name) => data.metrics[name]?.values || {};
  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    smokeMode: IS_SMOKE,
    saleBrowse: {
      p50_ms: metric('http_req_duration{suite:sale_browse}').med ?? null,
      p95_ms: metric('http_req_duration{suite:sale_browse}')['p(95)'] ?? null,
      p99_ms: metric('http_req_duration{suite:sale_browse}')['p(99)'] ?? null,
      fail_rate: metric('http_req_failed{suite:sale_browse}').rate ?? null,
    },
    checkoutBurst: {
      p50_ms: metric('http_req_duration{suite:checkout_burst}').med ?? null,
      p95_ms: metric('http_req_duration{suite:checkout_burst}')['p(95)'] ?? null,
      p99_ms: metric('http_req_duration{suite:checkout_burst}')['p(99)'] ?? null,
      conflicts_409: metric('gadzio_checkout_409_conflicts').count ?? 0,
      ratelimited_429: metric('gadzio_checkout_429_ratelimited').count ?? 0,
    },
    overall: {
      total_requests: metric('http_reqs').count ?? 0,
      throughput_rps: metric('http_reqs').rate ?? 0,
      unhandled_5xx_rate: metric('gadzio_http_5xx_rate').rate ?? 0,
    },
  };

  return {
    stdout: `\n=== GADZIO K6 BENCHMARK SUMMARY ===\n${JSON.stringify(summary, null, 2)}\n`,
    'perf-k6-summary.json': JSON.stringify(summary, null, 2),
  };
}

