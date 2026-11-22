import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';

const root = process.cwd();

/**
 * Shared stateful in-memory PostgreSQL double simulating `auth_rate_limits` across
 * independent serverless instances. Enforces advisory lock serialization on
 * transaction boundaries matching `distributed-rate-limit.ts`.
 */
function createSharedRateLimitSql() {
  const rows = [];
  let nextId = 1;
  let txChain = Promise.resolve();

  function parseTableLock(strings) {
    return strings.join('?');
  }

  function createConn() {
    const conn = async (strings, ...values) => {
      const q = parseTableLock(strings).replace(/\s+/g, ' ').trim();

      if (q.includes('pg_advisory_xact_lock')) {
        return [{ pg_advisory_xact_lock: '' }];
      }
      if (q.includes('from auth_rate_limits') && q.includes('count(*)')) {
        const [scope, bucketKey, cutoff] = values;
        const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : Date.parse(String(cutoff));
        const matching = rows.filter(
          (r) => r.scope === scope && r.bucket_key === bucketKey && r.created_at.getTime() > cutoffMs,
        );
        const oldest = matching.length
          ? new Date(Math.min(...matching.map((r) => r.created_at.getTime())))
          : null;
        return [{ hits: matching.length, oldest }];
      }
      if (q.includes('insert into auth_rate_limits')) {
        const [nowVal, scopes, hashes] = values;
        const createdAt = nowVal instanceof Date ? nowVal : new Date(nowVal);
        for (let i = 0; i < scopes.length; i += 1) {
          rows.push({
            id: nextId++,
            scope: scopes[i],
            bucket_key: hashes[i],
            created_at: createdAt,
          });
        }
        return [];
      }
      if (q.includes('delete from auth_rate_limits') && q.includes('limit')) {
        const [cutoff, limit] = values;
        const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : Date.parse(String(cutoff));
        const expiredIds = rows
          .filter((r) => r.created_at.getTime() < cutoffMs)
          .slice(0, Number(limit))
          .map((r) => r.id);
        for (const id of expiredIds) {
          const idx = rows.findIndex((r) => r.id === id);
          if (idx !== -1) rows.splice(idx, 1);
        }
        return expiredIds.map((id) => ({ id }));
      }
      throw new Error(`Unexpected SQL in SEC-001 test double: ${q}`);
    };

    conn.begin = async (fn) => {
      const prev = txChain;
      let release;
      txChain = new Promise((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        return await fn(conn);
      } finally {
        release();
      }
    };

    return conn;
  }

  return { rows, createConn };
}

function createCatalogHarness({ sharedSql, saleStateRef, dbReadRef }) {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => sharedSql },
      '@/lib/catalog/storefront': {
        readStorefrontCatalog: async () => dbReadRef(),
        applySaleDisplay: (product, saleLive) => ({
          ...product,
          effectivePricePaise: saleLive && product.salePricePaise != null ? product.salePricePaise : product.pricePaise,
        }),
      },
      '@/lib/storefront/catalog-merge': {
        accessoryProductFromDatabase: () => ({}),
        caseProductFromDatabase: () => ({}),
        collectionProductFromDatabase: () => ({}),
        mergeAccessoryProduct: (p) => p,
        mergeCaseProduct: (p) => p,
        refFromDatabase: (product, categoryName) => ({
          id: product.id,
          name: product.name,
          category: categoryName ?? '',
          image: '',
          pricePaise: product.effectivePricePaise ?? product.pricePaise,
          inStock: product.inStock,
          keywords: [],
        }),
      },
      '@/lib/catalog/adapter': { toCategoryConfig: (c) => c },
      '@/lib/storefront/catalog-tags': { CATALOG_CACHE_TAG: 'catalog', productCacheTag: (id) => `p:${id}` },
      'next/cache': { unstable_cache: (fn) => fn, revalidateTag: () => {} },
      react: { cache: (fn) => fn },
    },
  });
  return jiti;
}

test('SEC-001: concurrent fresh=1 requests coalesce onto one DB read and short micro-cache invalidates cleanly', async () => {
  globalThis.__gadzioSaleStateCache = undefined;
  globalThis.__gadzioCatalogSnapshot = undefined;
  globalThis.__gadzioFreshCatalogSnapshot = undefined;
  globalThis.__gadzioFreshCatalogFailure = undefined;
  globalThis.__gadzioCatalogEpoch = 0;

  let dbReads = 0;
  const shared = createSharedRateLimitSql();
  const baseProduct = {
    id: 'prod-1',
    categoryId: 'cat-1',
    name: 'Case',
    pricePaise: 120000,
    salePricePaise: 90000,
    inStock: true,
    inventoryMode: 'product',
  };
  let saleLive = false;

  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => shared.createConn() },
      '@/lib/catalog/storefront': {
        readStorefrontCatalog: async () => {
          dbReads += 1;
          await new Promise((r) => setTimeout(r, 25));
          return {
            categories: [{ id: 'cat-1', slug: 'cases', name: 'Cases', facets: [] }],
            products: [{ ...baseProduct }],
          };
        },
        applySaleDisplay: (product, live) => ({
          ...product,
          effectivePricePaise: live ? product.salePricePaise : product.pricePaise,
        }),
      },
      '@/lib/catalog/adapter': { toCategoryConfig: (c) => c },
      'next/cache': { unstable_cache: (fn) => fn, revalidateTag: () => {} },
      react: { cache: (fn) => fn },
    },
  });

  // Override readSaleState via direct module load after clearing cache
  const saleState = await jiti.import(path.join(root, 'src/lib/storefront/sale-state.ts'));
  saleState.clearSaleStateCache();

  // Swap db double cleanly for sale-state + catalog by mocking @/lib/storefront/sale-state in route loader
  const { readStorefrontCatalog: _unused, ...restCatalogMocks } = {};
  const catalog = await jiti.import(path.join(root, 'src/lib/storefront/catalog.ts'));
  const route = await jiti.import(path.join(root, 'src/app/api/catalog/summary/route.ts'));

  // Intercept sale-state queries via fake sql supporting both sale_settings and auth_rate_limits
  const fullSql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim();
    if (q.includes('from sale_settings')) {
      return [{ enabled: saleLive, starts_at: null, ends_at: null, updated_at: null, updated_by: null, db_now: new Date() }];
    }
    if (q.includes('clock_timestamp()')) {
      return [{ db_now: new Date() }];
    }
    return shared.createConn()(strings, ...values);
  };
  fullSql.begin = shared.createConn().begin;

  const prevJiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => fullSql },
      '@/lib/catalog/storefront': {
        readStorefrontCatalog: async () => {
          dbReads += 1;
          await new Promise((r) => setTimeout(r, 25));
          return {
            categories: [{ id: 'cat-1', slug: 'cases', name: 'Cases', facets: [] }],
            products: [{ ...baseProduct }],
          };
        },
        applySaleDisplay: (product, live) => ({
          ...product,
          pricePaise: live && product.salePricePaise != null ? product.salePricePaise : product.pricePaise,
          onSale: Boolean(live && product.salePricePaise != null),
        }),
      },
      '@/lib/storefront/catalog-merge': {
        accessoryProductFromDatabase: () => ({}),
        caseProductFromDatabase: () => ({}),
        collectionProductFromDatabase: () => ({}),
        mergeAccessoryProduct: (p) => p,
        mergeCaseProduct: (p) => p,
        refFromDatabase: (product, categoryName) => ({
          id: product.id,
          name: product.name,
          category: categoryName ?? '',
          image: '',
          pricePaise: product.effectivePricePaise ?? product.pricePaise,
          inStock: product.inStock,
          keywords: [],
        }),
      },
      '@/lib/catalog/adapter': { toCategoryConfig: (c) => c },
      'next/cache': { unstable_cache: (fn) => fn, revalidateTag: () => {} },
      react: { cache: (fn) => fn },
    },
  });

  const summaryRoute = await prevJiti.import(path.join(root, 'src/app/api/catalog/summary/route.ts'));
  const saleStateMod = await prevJiti.import(path.join(root, 'src/lib/storefront/sale-state.ts'));
  saleStateMod.clearSaleStateCache();
  dbReads = 0;

  // 10 concurrent ?fresh=1 requests must coalesce into a single DB catalogue read.
  const burst = await Promise.all(
    Array.from({ length: 10 }, () =>
      summaryRoute.GET(new Request('https://shop.example/api/catalog/summary?fresh=1')),
    ),
  );
  assert.equal(burst.every((r) => r.status === 200), true);
  assert.equal(dbReads, 1, '10 concurrent ?fresh=1 requests must execute only 1 DB read');

  // Immediate repeat ?fresh=1 within 2s micro-cache must still reuse the coalesced fresh snapshot.
  const cachedFresh = await summaryRoute.GET(new Request('https://shop.example/api/catalog/summary?fresh=1'));
  assert.equal(cachedFresh.status, 200);
  assert.equal((await cachedFresh.json()).products[0].pricePaise, 120000);
  assert.equal(dbReads, 1);

  // Admin mutation triggers clearSaleStateCache(), which immediately invalidates the fresh micro-cache.
  saleLive = true;
  saleStateMod.clearSaleStateCache();
  const invalidatedFresh = await summaryRoute.GET(new Request('https://shop.example/api/catalog/summary?fresh=1'));
  assert.equal(invalidatedFresh.status, 200);
  assert.equal((await invalidatedFresh.json()).products[0].pricePaise, 90000);
  assert.equal(dbReads, 2);

  // Normal cached endpoint continues working and returns products.
  const normal = await summaryRoute.GET(new Request('https://shop.example/api/catalog/summary'));
  assert.equal(normal.status, 200);
  assert.equal((await normal.json()).products[0].id, 'prod-1');
});

test('SEC-001: distributed rate limit across two separate serverless instances enforces 20/min/IP cap and blocks cross-site fresh=1', async () => {
  const prevTrust = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';

  try {
    const shared = createSharedRateLimitSql();
    let dbReads = 0;

    function bootInstance() {
      const instanceSql = shared.createConn();
      const jiti = createJiti(import.meta.url, {
        moduleCache: false,
        alias: { '@': path.join(root, 'src') },
        virtualModules: {
          '@/lib/platform/db': { getSql: () => instanceSql },
          '@/lib/storefront/catalog': {
            getFreshStorefrontRefs: async () => {
              dbReads += 1;
              return { products: [{ id: 'p1', pricePaise: 1000 }], saleLive: false, source: 'db' };
            },
            getStorefrontRefs: async () => ({ products: [{ id: 'p1', pricePaise: 1000 }], saleLive: false, source: 'db' }),
          },
        },
      });
      return jiti.import(path.join(root, 'src/app/api/catalog/summary/route.ts'));
    }

    const instanceA = await bootInstance();
    const instanceB = await bootInstance();

    // Cross-site Fetch Metadata on ?fresh=1 must return 403 before hitting catalogue DB.
    const crossSite = await instanceA.GET(
      new Request('https://shop.example/api/catalog/summary?fresh=1', {
        headers: {
          host: 'shop.example',
          'sec-fetch-site': 'cross-site',
          'x-forwarded-for': '203.0.113.55',
        },
      }),
    );
    assert.equal(crossSite.status, 403);
    assert.equal(dbReads, 0);

    // Same-origin / public requests (no Origin, no Sec-Fetch-Site) from 203.0.113.55 split across A and B:
    // 12 requests on Instance A + 8 requests on Instance B = 20 allowed.
    for (let i = 0; i < 12; i += 1) {
      const res = await instanceA.GET(
        new Request('https://shop.example/api/catalog/summary?fresh=1', {
          headers: { host: 'shop.example', 'x-forwarded-for': '203.0.113.55' },
        }),
      );
      assert.equal(res.status, 200);
    }
    for (let i = 0; i < 8; i += 1) {
      const res = await instanceB.GET(
        new Request('https://shop.example/api/catalog/summary?fresh=1', {
          headers: { host: 'shop.example', 'x-forwarded-for': '203.0.113.55' },
        }),
      );
      assert.equal(res.status, 200);
    }
    assert.equal(dbReads, 20);
    assert.equal(shared.rows.length, 20, 'rate-limit hits must be recorded in shared PostgreSQL store');

    // 21st request on Instance B is blocked with 429 and NEVER hits the catalogue reader.
    const blocked = await instanceB.GET(
      new Request('https://shop.example/api/catalog/summary?fresh=1', {
        headers: { host: 'shop.example', 'x-forwarded-for': '203.0.113.55' },
      }),
    );
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
    assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
    assert.equal(dbReads, 20);
    assert.equal(shared.rows.length, 20, 'rate-limit hits must be recorded in shared PostgreSQL store');

    // Normal cached summary requests remain publicly accessible even while ?fresh=1 is throttled.
    const normalCached = await instanceB.GET(
      new Request('https://shop.example/api/catalog/summary', {
        headers: { host: 'shop.example', 'x-forwarded-for': '203.0.113.55' },
      }),
    );
    assert.equal(normalCached.status, 200);

    // Unused helper reference guard
    void createCatalogHarness;
  } finally {
    if (prevTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrust;
  }
});

test('SEC-001: DB outage triggers short failure cooldown without hammering the database', async () => {
  globalThis.__gadzioSaleStateCache = undefined;
  globalThis.__gadzioCatalogSnapshot = undefined;
  globalThis.__gadzioFreshCatalogSnapshot = undefined;
  globalThis.__gadzioFreshCatalogFailure = undefined;
  globalThis.__gadzioCatalogEpoch = 0;

  let dbReadAttempts = 0;
  let shouldFail = true;
  const shared = createSharedRateLimitSql();
  const fullSql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim();
    if (q.includes('from sale_settings')) {
      return [{ enabled: false, starts_at: null, ends_at: null, updated_at: null, updated_by: null, db_now: new Date() }];
    }
    if (q.includes('clock_timestamp()')) {
      return [{ db_now: new Date() }];
    }
    return shared.createConn()(strings, ...values);
  };
  fullSql.begin = shared.createConn().begin;

  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => fullSql },
      '@/lib/catalog/storefront': {
        readStorefrontCatalog: async () => {
          dbReadAttempts += 1;
          if (shouldFail) throw new Error('DB outage');
          return {
            categories: [{ id: 'cat-1', slug: 'cases', name: 'Cases', facets: [] }],
            products: [{ id: 'p1', categoryId: 'cat-1', name: 'Case', pricePaise: 1000, inStock: true, inventoryMode: 'product' }],
          };
        },
        applySaleDisplay: (p) => ({ ...p, effectivePricePaise: p.pricePaise }),
      },
      '@/lib/storefront/catalog-merge': {
        accessoryProductFromDatabase: () => ({}),
        caseProductFromDatabase: () => ({}),
        collectionProductFromDatabase: () => ({}),
        mergeAccessoryProduct: (p) => p,
        mergeCaseProduct: (p) => p,
        refFromDatabase: (product) => ({ id: product.id, name: product.name, category: '', image: '', pricePaise: product.pricePaise, inStock: true, keywords: [] }),
      },
      '@/lib/catalog/adapter': { toCategoryConfig: (c) => c },
      'next/cache': { unstable_cache: (fn) => fn, revalidateTag: () => {} },
      react: { cache: (fn) => fn },
    },
  });

  const route = await jiti.import(path.join(root, 'src/app/api/catalog/summary/route.ts'));
  const saleStateMod = await jiti.import(path.join(root, 'src/lib/storefront/sale-state.ts'));
  saleStateMod.clearSaleStateCache();

  for (let i = 0; i < 5; i += 1) {
    const res = await route.GET(new Request('https://shop.example/api/catalog/summary?fresh=1'));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(dbReadAttempts, 1, 'failure cooldown prevents repeated DB queries during immediate retries');

  // Once invalidated and recovered, ?fresh=1 returns 200 again.
  shouldFail = false;
  saleStateMod.clearSaleStateCache();
  const ok = await route.GET(new Request('https://shop.example/api/catalog/summary?fresh=1'));
  assert.equal(ok.status, 200);
  assert.equal(dbReadAttempts, 2);
});
