/**
 * Pure-Node HTTP Sale Browse & Checkout Burst Benchmark
 * (Zero-dependency fallback if the `k6` binary is not installed on Windows)
 *
 * Exercises valid seeded catalog slugs and correct HTTP methods/contracts:
 *   1. Sale Browse:
 *      - `GET /` (Homepage HTML validation)
 *      - `GET /in/shop/iphone/accessories/[category]` (Category HTML validation)
 *      - `GET /shop/product/[id]` (Product Detail HTML validation)
 *      - `GET /api/catalog/availability?ids=...&lines=...` (JSON contract validation)
 *   2. Optional Checkout Burst (`POST /api/payu/initiate`, enabled via `CHECKOUT_CONCURRENCY`)
 *
 * Usage (requires `npm run dev` or `npm run build && npm run start` running on port 3000):
 *   node scripts/perf/node-http-load-bench.mjs
 *
 * Multi-level sweep (10, 30, 50, 100 workers):
 *   $env:WORKER_LEVELS="10,30,50,100"; node scripts/perf/node-http-load-bench.mjs
 */

import { performance } from 'node:perf_hooks';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const CONCURRENCY = Number(process.env.CONCURRENCY || 30);
const DURATION_SEC = Number(process.env.DURATION_SEC || 15);
const CHECKOUT_CONCURRENCY = Number(process.env.CHECKOUT_CONCURRENCY || 0);
const WORKER_LEVELS = process.env.WORKER_LEVELS
  ? process.env.WORKER_LEVELS
      .split(',')
      .map((n) => Number(n.trim()))
      .filter(Boolean)
  : [CONCURRENCY];

const PRODUCT_IDS = (
  process.env.PRODUCT_IDS ||
  'apple-60w-usbc-charge-cable-1m,apple-20w-usbc-power-adapter,apple-usbc-to-lightning-cable-1m,apple-earphones-usbc,apple-earphones-lightning'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CATEGORY_URLS = [
  '/in/shop/iphone/accessories/power-adapter-cable',
  '/in/shop/iphone/accessories/wired-earphones',
  '/in/shop/iphone/accessories/cases-protection',
];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
}

async function timedFetch(url, options = {}, validateContent = null) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    const durationMs = performance.now() - t0;
    const contentValid = validateContent ? Boolean(validateContent(res, text)) : true;
    return {
      ok: res.ok && contentValid,
      status: res.status,
      contentValid,
      durationMs,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentValid: false,
      error: err.message,
      durationMs: performance.now() - t0,
    };
  }
}

function isValidHtml(res, text) {
  return res.status === 200 && text.length > 200 && /<!DOCTYPE html>|<html/i.test(text);
}

function isValidAvailabilityJson(expectedProductId, res, text) {
  if (res.status !== 200) return false;
  try {
    const data = JSON.parse(text);
    return (
      data !== null &&
      typeof data === 'object' &&
      typeof data.saleLive === 'boolean' &&
      Array.isArray(data.products) &&
      data.products.some((p) => p && p.id === expectedProductId && typeof p.inStock === 'boolean')
    );
  } catch {
    return false;
  }
}

async function runSingleLevel(browseWorkers, checkoutWorkers) {
  const browseTimings = [];
  const surfaceStats = {
    home: { timings: [], statusCounts: {}, errors: 0, invalidContent: 0 },
    category: { timings: [], statusCounts: {}, errors: 0, invalidContent: 0 },
    pdp: { timings: [], statusCounts: {}, errors: 0, invalidContent: 0 },
    availability: { timings: [], statusCounts: {}, errors: 0, invalidContent: 0 },
  };
  const checkoutTimings = [];
  let browseErrors = 0;
  let server5xx = 0;
  let checkout409 = 0;
  let checkout429 = 0;
  const checkoutStatusCounts = {};

  const startWall = performance.now();
  const stopAt = startWall + DURATION_SEC * 1000;

  function recordSurface(surfaceKey, result) {
    const surface = surfaceStats[surfaceKey];
    browseTimings.push(result.durationMs);
    surface.timings.push(result.durationMs);
    surface.statusCounts[result.status] = (surface.statusCounts[result.status] || 0) + 1;
    if (!result.contentValid) surface.invalidContent += 1;
    if (!result.ok || result.status !== 200) {
      surface.errors += 1;
      browseErrors += 1;
      if (!result.ok && (result.status === 0 || result.status >= 500)) {
        server5xx += 1;
      }
    }
  }

  async function browseWorker(workerId) {
    let iter = 0;
    while (performance.now() < stopAt) {
      const productId = PRODUCT_IDS[(workerId + iter) % PRODUCT_IDS.length];
      const categoryPath = CATEGORY_URLS[(workerId + iter) % CATEGORY_URLS.length];
      iter += 1;

      const r1 = await timedFetch(`${BASE_URL}/`, { method: 'GET' }, isValidHtml);
      recordSurface('home', r1);
      if (performance.now() >= stopAt) break;

      const r2 = await timedFetch(`${BASE_URL}${categoryPath}`, { method: 'GET' }, isValidHtml);
      recordSurface('category', r2);
      if (performance.now() >= stopAt) break;

      const r3 = await timedFetch(
        `${BASE_URL}/shop/product/${encodeURIComponent(productId)}`,
        { method: 'GET' },
        isValidHtml,
      );
      recordSurface('pdp', r3);
      if (performance.now() >= stopAt) break;

      const linesParam = encodeURIComponent(JSON.stringify([{ productId, quantity: 1 }]));
      const r4 = await timedFetch(
        `${BASE_URL}/api/catalog/availability?ids=${encodeURIComponent(productId)}&lines=${linesParam}`,
        {
          method: 'GET',
          headers: {
            Origin: BASE_URL,
            Referer: `${BASE_URL}/shop/product/${encodeURIComponent(productId)}`,
          },
        },
        (res, text) => isValidAvailabilityJson(productId, res, text),
      );
      recordSurface('availability', r4);
    }
  }

  async function checkoutWorker(workerId) {
    let iter = 0;
    while (performance.now() < stopAt) {
      const productId = PRODUCT_IDS[(workerId + iter) % PRODUCT_IDS.length];
      const fakeIp = `10.${(workerId % 250) + 1}.${(Math.floor(iter / 250) % 250) + 1}.${(iter % 250) + 1}`;
      iter += 1;

      const res = await timedFetch(
        `${BASE_URL}/api/payu/initiate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/checkout`,
            'X-Forwarded-For': fakeIp,
          },
          body: JSON.stringify({
            items: [{ id: productId, variantId: null, quantity: 1 }],
            customer: {
              firstname: 'Perf Buyer',
              email: `perf.buyer.${workerId}.${iter}@example.test`,
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
          }),
        },
        (_r, text) => {
          try {
            const parsed = JSON.parse(text);
            return Boolean(parsed && typeof parsed === 'object');
          } catch {
            return false;
          }
        },
      );

      checkoutTimings.push(res.durationMs);
      checkoutStatusCounts[res.status] = (checkoutStatusCounts[res.status] || 0) + 1;
      if (res.status === 409) checkout409 += 1;
      if (res.status === 429) checkout429 += 1;
      if (res.status === 0 || res.status === 500 || res.status === 502 || res.status === 504) {
        server5xx += 1;
      }
    }
  }

  await Promise.all([
    ...Array.from({ length: browseWorkers }, (_, i) => browseWorker(i + 1)),
    ...Array.from({ length: checkoutWorkers }, (_, i) => checkoutWorker(i + 1)),
  ]);
  const totalElapsedSec = (performance.now() - startWall) / 1000;

  browseTimings.sort((a, b) => a - b);
  checkoutTimings.sort((a, b) => a - b);
  const bySurface = {};
  for (const [key, data] of Object.entries(surfaceStats)) {
    data.timings.sort((a, b) => a - b);
    bySurface[key] = {
      requests: data.timings.length,
      rps: Number((data.timings.length / totalElapsedSec).toFixed(2)),
      p50Ms: percentile(data.timings, 50),
      p95Ms: percentile(data.timings, 95),
      p99Ms: percentile(data.timings, 99),
      statusCounts: data.statusCounts,
      errors: data.errors,
      invalidContent: data.invalidContent,
    };
  }

  const totalReqs = browseTimings.length + checkoutTimings.length;
  return {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    durationSec: Number(totalElapsedSec.toFixed(2)),
    concurrency: { browseWorkers, checkoutWorkers },
    overall: {
      totalRequests: totalReqs,
      throughputRps: Number((totalReqs / totalElapsedSec).toFixed(2)),
      unhandled5xxCount: server5xx,
    },
    saleBrowse: {
      requests: browseTimings.length,
      errorRate: Number((browseErrors / Math.max(1, browseTimings.length)).toFixed(4)),
      p50Ms: percentile(browseTimings, 50),
      p95Ms: percentile(browseTimings, 95),
      p99Ms: percentile(browseTimings, 99),
      bySurfaceP95Ms: {
        home: bySurface.home.p95Ms,
        category: bySurface.category.p95Ms,
        pdp: bySurface.pdp.p95Ms,
        availabilityApi: bySurface.availability.p95Ms,
      },
      surfaces: bySurface,
    },
    checkoutBurst: {
      requests: checkoutTimings.length,
      p50Ms: percentile(checkoutTimings, 50),
      p95Ms: percentile(checkoutTimings, 95),
      p99Ms: percentile(checkoutTimings, 99),
      statusCounts: checkoutStatusCounts,
      conflicts409: checkout409,
      rateLimited429: checkout429,
    },
  };
}

async function runHttpBenchmark() {
  const probe = await timedFetch(`${BASE_URL}/`, { method: 'GET' }, isValidHtml);
  if (!probe.ok) {
    console.error(
      `\n[ERROR] Could not reach ${BASE_URL} (${probe.error || `status ${probe.status}`}).\nStart the server in another terminal first (` +
        '`npm run dev` or `npm run build && npm run start`), then re-run this command.\n',
    );
    process.exit(1);
  }

  const reports = [];
  for (const browseWorkers of WORKER_LEVELS) {
    // Warm up seeded catalog routes before each worker level so 30s ISR/cache
    // boundaries do not skew mid-sweep comparisons.
    await timedFetch(`${BASE_URL}/`, { method: 'GET' });
    for (const cat of CATEGORY_URLS) await timedFetch(`${BASE_URL}${cat}`, { method: 'GET' });
    for (const id of PRODUCT_IDS) {
      await timedFetch(`${BASE_URL}/shop/product/${encodeURIComponent(id)}`, { method: 'GET' });
    }

    const report = await runSingleLevel(browseWorkers, CHECKOUT_CONCURRENCY);
    reports.push(report);
    console.log('\n=== GADZIO HTTP LOAD BENCHMARK REPORT ===');
    console.log(JSON.stringify(report, null, 2));
  }

  if (reports.length > 1) {
    console.log('\n=== GADZIO HTTP MULTI-LEVEL SUMMARY ===');
    console.log(JSON.stringify(reports, null, 2));
  }
}

await runHttpBenchmark();
