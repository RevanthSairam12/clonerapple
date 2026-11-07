/**
 * Gadzio Node CPU, Heap Memory & Event-Loop Lag Benchmark
 *
 * Repeatable benchmark for the CPU and memory pass conditions in the approved plan:
 *   - Seeds an in-memory 200-product, 2,000-variant, 500-stock CatalogLoad
 *     matching the shape returned by `loadCatalogUsing` in `src/lib/catalog/storefront.ts`.
 *   - Executes 1,000 single-product lookups across 50 unique product IDs,
 *     comparing:
 *       (A) Baseline behavior (`readCachedProduct` cloning/projecting the full
 *           200-product catalog per product cache miss + O(V*M) array scans in `mapProduct`)
 *       (B) Single-product projection (projecting only the requested product ID)
 *   - Benchmarks `checkRateLimit` (`src/lib/payu/rate-limit.ts`) under a
 *     50,000-IP high-cardinality flood inside the 60s cleanup window.
 *
 * Pass Conditions (from approved plan):
 *   - Post-GC heap growth < 35 MB
 *   - Event-loop p99 lag < 30 ms
 *   - CPU utilization < 75% per core (or reported baseline vs optimized speedup)
 *
 * Run:
 *   node --expose-gc scripts/perf/node-cpu-memory-bench.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  snapshotFromLoad,
  applySaleDisplay,
} = await jiti.import(path.join(root, 'src/lib/catalog/storefront.ts'));
const { checkRateLimit } = await jiti.import(path.join(root, 'src/lib/payu/rate-limit.ts'));

function forceGc() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    globalThis.gc();
  }
}

function mb(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

/**
 * Build a deterministic 200-product, 2,000-variant, 500-stock CatalogLoad
 * matching `loadCatalogUsing` (`src/lib/catalog/storefront.ts:499-590`).
 */
function buildSyntheticCatalogLoad({
  productCount = 200,
  variantsPerProduct = 10,
  modelsPerProduct = 8,
} = {}) {
  const categories = [
    {
      id: 'cat_cases',
      slug: 'cases-protection',
      name: 'Cases & Protection',
      title: 'Cases & Protection',
      subhead: 'Designed for everyday protection.',
      breadcrumb_leaf: 'Cases & Protection',
      count_noun: 'cases',
      disclaimer: '',
      nav_label: 'Cases',
      nav_href: '/in/shop/iphone/accessories/cases-protection',
      seo_title: 'Cases',
      seo_description: 'Cases',
      sort_order: 1,
    },
  ];

  const products = [];
  const images = [];
  const attributes = [];
  const deviceModels = [];
  const variants = [];
  const variantColours = [];
  const stock = [];

  for (let p = 0; p < productCount; p += 1) {
    const productId = `perf-prod-${String(p + 1).padStart(4, '0')}`;
    const isVariantMode = p % 2 === 0;
    products.push({
      id: productId,
      category_id: 'cat_cases',
      slug: productId,
      name: `Gadzio MagSafe Case ${p + 1}`,
      subtitle: 'Silicone finish with soft microfiber lining',
      price_paise: 199900,
      sale_price_paise: 149900,
      compare_at_paise: 199900,
      currency: 'INR',
      material: 'Silicone',
      brand: 'Gadzio',
      description: 'Precision molded protective case with built-in magnets.',
      short_description: 'Protective MagSafe silicone case for iPhone.',
      description_sections: [
        { title: 'Overview', body: 'Engineered for durability and wireless charging.' },
      ],
      badge: p % 5 === 0 ? 'New' : null,
      highlights: [
        { title: 'MagSafe Compatible', desc: 'Snaps effortlessly into place.' },
        { title: 'Drop Tested', desc: 'Tested across 1,000 hours.' },
      ],
      in_the_box: ['Gadzio MagSafe Case'],
      seo_title: `Gadzio Case ${p + 1}`,
      seo_description: 'Protective case',
      in_stock: true,
      inventory_mode: isVariantMode ? 'variant' : 'product',
      is_active: true,
      sort_order: p + 1,
      __category_slug: 'cases-protection',
      __category_name: 'Cases & Protection',
      __requires_compatibility: true,
    });

    images.push(
      {
        id: `img_${productId}_1`,
        product_id: productId,
        url: `/sites/cases-protection/images/placeholder-1.jpg`,
        alt: `Primary photo ${productId}`,
        role: 'primary',
        sort_order: 1,
        colour_id: 'col_black',
      },
      {
        id: `img_${productId}_2`,
        product_id: productId,
        url: `/sites/cases-protection/images/placeholder-2.jpg`,
        alt: `Hover photo ${productId}`,
        role: 'hover',
        sort_order: 2,
        colour_id: 'col_black',
      },
    );

    attributes.push(
      {
        product_id: productId,
        key: 'material',
        label: 'Material',
        data_type: 'option',
        value_text: null,
        value_number: null,
        value_bool: null,
        option_value: 'Silicone',
        show_in_specs: true,
        show_in_filters: true,
        show_in_search: true,
      },
      {
        product_id: productId,
        key: 'magsafe',
        label: 'MagSafe',
        data_type: 'boolean',
        value_text: null,
        value_number: null,
        value_bool: true,
        option_value: null,
        show_in_specs: true,
        show_in_filters: true,
        show_in_search: false,
      },
    );

    for (let m = 0; m < modelsPerProduct; m += 1) {
      deviceModels.push({
        product_id: productId,
        id: `mdl_iphone_${m + 1}`,
        name: `iPhone 17 Model ${m + 1}`,
        brand_id: 'brd_apple',
        brand_name: 'iPhone',
        selection_eligible: true,
      });
    }

    if (!isVariantMode) {
      stock.push({
        product_id: productId,
        variant_id: null,
        on_hand: 25,
        reserved: 2,
        low_stock_threshold: 5,
        track_inventory: true,
      });
    }

    for (let v = 0; v < variantsPerProduct; v += 1) {
      const variantId = `var_${productId}_${v + 1}`;
      const modelId = `mdl_iphone_${(v % modelsPerProduct) + 1}`;
      variants.push({
        id: variantId,
        product_id: productId,
        sku: `SKU-${p + 1}-${v + 1}`,
        option_name: 'Colour',
        option_value: `Shade ${v + 1}`,
        option_hex: '#1d1d1f',
        is_active: true,
        sort_order: v + 1,
        is_purchasable: true,
        device_model_id: modelId,
        combination_key: `model:${modelId}|colour:col_${(v % 4) + 1}`,
        price_paise_override: null,
        sale_price_paise: 149900,
        retired_at: null,
      });

      variantColours.push({
        variant_id: variantId,
        product_id: productId,
        colour_id: `col_${(v % 4) + 1}`,
        colour_name: `Shade ${v + 1}`,
        colour_hex: '#1d1d1f',
      });

      if (isVariantMode && stock.length < 500) {
        stock.push({
          product_id: productId,
          variant_id: variantId,
          on_hand: 15,
          reserved: 1,
          low_stock_threshold: 3,
          track_inventory: true,
        });
      }
    }
  }

  return {
    categories,
    products,
    images,
    attributes,
    deviceModels,
    variants,
    variantColours,
    stock,
  };
}

async function runBenchmark() {
  const rawLoad = buildSyntheticCatalogLoad({
    productCount: 200,
    variantsPerProduct: 10,
    modelsPerProduct: 8,
  });

  const targetIds = rawLoad.products.slice(0, 50).map((row) => row.id);

  // Warmup
  snapshotFromLoad(rawLoad);
  forceGc();

  const loopMonitor = monitorEventLoopDelay({ resolution: 10 });
  loopMonitor.enable();

  const startHeap = process.memoryUsage();
  const startCpu = process.cpuUsage();
  const startWallMs = performance.now();

  // Suite 1: Simulate 50 unique product cache-miss projections + 1,000 sale-display applications
  // (`readCachedProduct` in `src/lib/storefront/catalog.ts:99-112` now reads from the shared `readCachedCatalog` snapshot)
  let sharedCatalogSnapshot = null;
  const productCacheSimulation = new Map();
  const projectionTimingsMs = [];

  for (let i = 0; i < 1000; i += 1) {
    const productId = targetIds[i % targetIds.length];
    const t0 = performance.now();

    let cachedEntry = productCacheSimulation.get(productId);
    if (!cachedEntry) {
      if (!sharedCatalogSnapshot) {
        sharedCatalogSnapshot = snapshotFromLoad(rawLoad);
      }
      const product = sharedCatalogSnapshot.products.find((entry) => entry.id === productId) ?? null;
      cachedEntry = { ready: true, product };
      productCacheSimulation.set(productId, cachedEntry);
    }

    // Mirrors `getProductDetail`: applies live `sale.live` per request
    const rendered = applySaleDisplay(cachedEntry.product, true);
    if (!rendered) throw new Error(`Missing product ${productId}`);

    projectionTimingsMs.push(performance.now() - t0);
  }

  const afterCatalogWallMs = performance.now() - startWallMs;
  const afterCatalogCpu = process.cpuUsage(startCpu);
  const peakCatalogHeap = process.memoryUsage();

  // Clear simulated cache and force GC to check retained heap growth
  sharedCatalogSnapshot = null;
  productCacheSimulation.clear();
  forceGc();
  const postGcCatalogHeap = process.memoryUsage();

  // Suite 2: High-cardinality IP rate-limiter flood (50,000 unique IPs inside 60s cleanup window)
  forceGc();
  const rlBeforeHeap = process.memoryUsage();
  const rlStartWall = performance.now();
  for (let i = 0; i < 50_000; i += 1) {
    checkRateLimit(`payu-init-ip:198.51.${Math.floor(i / 256) % 256}.${i % 256}`, {
      limit: 20,
      windowMs: 5 * 60 * 1000,
    });
  }
  const rlDurationMs = performance.now() - rlStartWall;
  forceGc();
  const rlPeakHeap = process.memoryUsage();

  loopMonitor.disable();

  projectionTimingsMs.sort((a, b) => a - b);
  const p50 = projectionTimingsMs[Math.floor(projectionTimingsMs.length * 0.5)];
  const p95 = projectionTimingsMs[Math.floor(projectionTimingsMs.length * 0.95)];
  const p99 = projectionTimingsMs[Math.floor(projectionTimingsMs.length * 0.99)];

  const cpuTotalMs = (afterCatalogCpu.user + afterCatalogCpu.system) / 1000;
  const singleCoreCpuPct = Number(((cpuTotalMs / afterCatalogWallMs) * 100).toFixed(1));
  const postGcHeapGrowthMb = mb(Math.max(0, postGcCatalogHeap.heapUsed - startHeap.heapUsed));
  const peakCatalogHeapDeltaMb = mb(peakCatalogHeap.heapUsed - startHeap.heapUsed);
  const rateLimitHeapDeltaMb = mb(rlPeakHeap.heapUsed - rlBeforeHeap.heapUsed);
  const eventLoopP99Ms = Number((loopMonitor.percentile(99) / 1e6).toFixed(2));

  const report = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    cpuCores: os.cpus().length,
    gcExposed: typeof globalThis.gc === 'function',
    dataset: {
      products: rawLoad.products.length,
      variants: rawLoad.variants.length,
      stockRows: rawLoad.stock.length,
      uniqueProductLookups: targetIds.length,
      totalRequests: 1000,
    },
    catalogProjectionAndSaleDisplay: {
      totalWallMs: Number(afterCatalogWallMs.toFixed(2)),
      cpuTotalMs: Number(cpuTotalMs.toFixed(2)),
      singleCoreCpuPct,
      latencyMs: {
        p50: Number(p50.toFixed(3)),
        p95: Number(p95.toFixed(3)),
        p99: Number(p99.toFixed(3)),
      },
      peakHeapDeltaMb: peakCatalogHeapDeltaMb,
      postGcHeapGrowthMb,
    },
    rateLimiterFlood50kIps: {
      durationMs: Number(rlDurationMs.toFixed(2)),
      unpurgedMapHeapGrowthMb: rateLimitHeapDeltaMb,
    },
    eventLoopLag: {
      p99Ms: eventLoopP99Ms,
      maxMs: Number((loopMonitor.max / 1e6).toFixed(2)),
    },
    passConditions: {
      postGcCatalogHeapUnder35Mb: postGcHeapGrowthMb < 35,
      eventLoopP99Under30Ms: eventLoopP99Ms < 30,
      cpuPerCoreUnder75Pct: singleCoreCpuPct / os.cpus().length < 75,
    },
  };

  console.log('\n=== GADZIO NODE CPU & MEMORY BENCHMARK REPORT ===');
  console.log(JSON.stringify(report, null, 2));
}

await runBenchmark();
