/**
 * SECURITY (SEC-007): PIN lookup & Spin Wheel distributed rate limits,
 * upstream coalescing/caching, cross-site blocking, and concurrent IP lock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import { NextRequest, NextResponse } from 'next/server.js';

const root = process.cwd();

function createSharedRateLimitSql() {
  const rows = [];
  let nextId = 1;
  let txChain = Promise.resolve();

  function createConn() {
    const conn = async (strings, ...values) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim();
      if (q.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: '' }];
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
      throw new Error(`Unexpected SQL in SEC-007 double: ${q}`);
    };
    conn.begin = async (fn) => {
      const prev = txChain;
      let release;
      txChain = new Promise((r) => {
        release = r;
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

test('SEC-007: GET /api/pincode/[pincode] enforces same-origin, coalesces & caches upstream lookups, and limits cross-instance IP abuse', async () => {
  const prevTrustProxy = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';

  const shared = createSharedRateLimitSql();
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;

  globalThis.fetch = async (url) => {
    upstreamCalls += 1;
    await new Promise((r) => setTimeout(r, 20));
    const pin = String(url).split('/').pop();
    return new Response(
      JSON.stringify([
        {
          Status: 'Success',
          PostOffice: [
            {
              Block: 'Bengaluru South',
              District: 'Bengaluru Urban',
              Division: 'Bengaluru',
              State: 'Karnataka',
              Pincode: pin,
            },
          ],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const loadInstance = async () => {
      const jiti = createJiti(import.meta.url, {
        moduleCache: false,
        alias: { '@': path.join(root, 'src') },
        virtualModules: {
          'next/server': { NextRequest, NextResponse },
          '@/lib/platform/db': { getSql: () => shared.createConn() },
        },
      });
      return jiti.import(path.join(root, 'src/app/api/pincode/[pincode]/route.ts'));
    };

    const instA = await loadInstance();
    const instB = await loadInstance();

    // 1. Cross-site request blocked before upstream or rate-limit burn
    const crossSite = await instA.GET(
      new Request('https://gadzio.in/api/pincode/560001', {
        headers: {
          'sec-fetch-site': 'cross-site',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
      { params: Promise.resolve({ pincode: '560001' }) },
    );
    assert.equal(crossSite.status, 403);
    assert.equal(upstreamCalls, 0);

    // 2. Invalid PIN rejected with 400 without upstream call
    const badPin = await instA.GET(
      new Request('https://gadzio.in/api/pincode/000123', {
        headers: {
          origin: 'https://gadzio.in',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
      { params: Promise.resolve({ pincode: '000123' }) },
    );
    assert.equal(badPin.status, 400);
    assert.equal(upstreamCalls, 0);

    // 3. Concurrent requests on the same instance coalesce into a single upstream call
    const makeSameOriginReq = (ip, pin = '560001') =>
      new Request(`https://gadzio.in/api/pincode/${pin}`, {
        headers: {
          origin: 'https://gadzio.in',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': ip,
        },
      });

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        instA.GET(makeSameOriginReq('203.0.113.10', '560001'), {
          params: Promise.resolve({ pincode: '560001' }),
        }),
      ),
    );
    for (const res of concurrent) {
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.location.pincode, '560001');
    }
    assert.equal(upstreamCalls, 1, 'concurrent lookups for the same PIN must coalesce');

    // 4. Subsequent request on instA hits process cache (0 extra upstream calls)
    const cachedHit = await instA.GET(makeSameOriginReq('203.0.113.10', '560001'), {
      params: Promise.resolve({ pincode: '560001' }),
    });
    assert.equal(cachedHit.status, 200);
    assert.equal(upstreamCalls, 1);

    // 5. Exhaust remaining IP quota (30/60s total: badPin + 5 + 1 = 7 consumed so far) across instA & instB
    let throttledAt = null;
    for (let i = 8; i <= 35; i += 1) {
      const targetInst = i % 2 === 0 ? instB : instA;
      const res = await targetInst.GET(makeSameOriginReq('203.0.113.10', '560001'), {
        params: Promise.resolve({ pincode: '560001' }),
      });
      if (res.status === 429) {
        throttledAt = i;
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
        break;
      }
      assert.equal(res.status, 200);
    }
    assert.equal(throttledAt, 31, '31st lookup from same IP across instances must hit 429');
  } finally {
    globalThis.fetch = originalFetch;
    if (prevTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrustProxy;
  }
});

test('SEC-007: Spin Wheel GET/POST distributed rate limits and advisory IP serialization', async () => {
  const prevTrustProxy = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';

  const shared = createSharedRateLimitSql();
  let currentUserId = 'user-spin-1';
  let spinCalls = 0;

  try {
    const loadSpinRoutes = async () => {
      const jiti = createJiti(import.meta.url, {
        moduleCache: false,
        alias: { '@': path.join(root, 'src') },
        virtualModules: {
          'next/server': { NextRequest, NextResponse },
          '@/lib/platform/db': { getSql: () => shared.createConn() },
          '@/lib/storefront/maintenance-guard': { requireStorefrontOpen: async () => null },
          '@/lib/user-auth': {
            getUserSession: async () =>
              currentUserId ? { userId: currentUserId, email: `${currentUserId}@example.com` } : null,
          },
          '@/lib/account/auth': {
            requireAccountSessionApi: async () =>
              currentUserId
                ? { ok: true, session: { userId: currentUserId, email: `${currentUserId}@example.com` } }
                : { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
          },
          '@/lib/spin-wheel/store': {
            getCustomerSpinState: async () => ({ available: true, canSpin: true }),
            executeSpinDraw: async () => {
              spinCalls += 1;
              return { ok: true, segment: { id: 'seg-1', label: 'No Prize' } };
            },
          },
        },
      });
      const getRoute = await jiti.import(path.join(root, 'src/app/api/spin-wheel/route.ts'));
      const postRoute = await jiti.import(path.join(root, 'src/app/api/spin-wheel/spin/route.ts'));
      return { getRoute, postRoute };
    };

    const instA = await loadSpinRoutes();
    const instB = await loadSpinRoutes();

    // GET /api/spin-wheel rejects cross-site
    const crossGet = await instA.getRoute.GET(
      new NextRequest('https://gadzio.in/api/spin-wheel', {
        headers: { 'sec-fetch-site': 'cross-site', 'x-forwarded-for': '203.0.113.55' },
      }),
    );
    assert.equal(crossGet.status, 403);

    // Legitimate same-origin GET succeeds with no-store
    const okGet = await instA.getRoute.GET(
      new NextRequest('https://gadzio.in/api/spin-wheel', {
        headers: {
          origin: 'https://gadzio.in',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': '203.0.113.55',
        },
      }),
    );
    assert.equal(okGet.status, 200);
    assert.equal(okGet.headers.get('cache-control'), 'no-store');

    // Enforce GET user limit (40 / 60s) across instances even from rotating IPs
    let getUserThrottled = false;
    for (let i = 2; i <= 42; i += 1) {
      const target = i % 2 === 0 ? instB : instA;
      const res = await target.getRoute.GET(
        new NextRequest('https://gadzio.in/api/spin-wheel', {
          headers: {
            origin: 'https://gadzio.in',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-for': `203.0.114.${i}`,
          },
        }),
      );
      if (res.status === 429) {
        getUserThrottled = true;
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
        break;
      }
    }
    assert.equal(getUserThrottled, true);

    // POST /api/spin-wheel/spin enforces cross-instance IP limit (15 / 60s) across separate user accounts
    let postIpThrottled = false;
    for (let i = 1; i <= 17; i += 1) {
      currentUserId = `user-acct-${i}`;
      const target = i % 2 === 0 ? instB : instA;
      const res = await target.postRoute.POST(
        new NextRequest('https://gadzio.in/api/spin-wheel/spin', {
          method: 'POST',
          headers: {
            origin: 'https://gadzio.in',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.99',
          },
          body: JSON.stringify({ termsAccepted: true }),
        }),
      );
      if (res.status === 429) {
        postIpThrottled = true;
        assert.equal(i, 16, '16th spin from same IP across accounts must return 429');
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
        break;
      }
      assert.equal(res.status, 200);
    }
    assert.equal(postIpThrottled, true);
    assert.equal(spinCalls, 15, '16th throttled request must never invoke executeSpinDraw');

    // Source verification: executeSpinDraw uses advisory lock 614203 keyed on storeDay + ipHash AND retains (user_id, store_day) insert-first uniqueness
    const storeSrc = await readFile(path.join(root, 'src', 'lib', 'spin-wheel', 'store.ts'), 'utf8');
    assert.match(storeSrc, /pg_advisory_xact_lock\(\s*614203,\s*hashtext\(/s);
    assert.match(storeSrc, /insert into spin_wheel_spins/i);
    assert.match(storeSrc, /max_spins_per_ip_per_day/);
  } finally {
    if (prevTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrustProxy;
  }
});
