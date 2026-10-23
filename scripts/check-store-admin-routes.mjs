/**
 * Guard against an unprotected store-admin API route.
 *
 * Every `route.*` file under src/app/api/store-admin must call
 * `requireStoreRole(...)` — except the login route, which is public by design.
 * New routes are picked up automatically; no list to maintain.
 *
 * Two stricter shapes are also enforced:
 * - read-only routes (catalogue and customer list/detail) must not export a
 *   mutating handler (POST/PUT/PATCH/DELETE);
 * - the customer reveal route must require `store_owner` and call
 *   `assertSameOrigin()`;
 * - all other mutating routes must call `assertSameOrigin()`.
 *
 * Usage: node scripts/check-store-admin-routes.mjs
 * Exit code 1 when a route is missing the guard (or the exemption disappears).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'src/app/api/store-admin');
const LOGIN_ROUTE = 'auth/login/route.ts';
const ROUTE_FILE = /^route\.(?:ts|tsx|js|jsx|mts)$/;
const GUARD_CALL = /\brequireStoreRole\s*(?:<[^>]*>)?\s*\(/;
const MUTATING_EXPORT =
  /\bexport\s+(?:async\s+)?(?:function\s+)?(POST|PUT|PATCH|DELETE)\b/;
const OWNER_GUARD_CALL =
  /\brequireStoreRole\s*\(\s*['"]store_owner['"]\s*\)/;
const SAME_ORIGIN_CALL = /\bassertSameOrigin\s*\(/;

/**
 * Read-only routes in this release. Catalogue and customer views must stay
 * GET-only. Price and stock writes stay disabled until checkout reads prices
 * from the database.
 *
 * Phase 2 additions:
 * - `orders/[txnid]/void` is owner-only (voiding a POS sale moves money and
 *   stock back, so it gets the same treatment as a reveal);
 * - `orders/[txnid]/payments`, `pos/sales`, `pos/shift` and `settings` mutate
 *   and therefore must call `assertSameOrigin`;
 * - `settings` also gates writes to `store_owner` inside the handler (the
 *   script checks the same-origin call; the role gate is enforced by
 *   `requireStoreRole('store_owner')` in the PUT handler).
 */
const EXPECTED_READ_ONLY_ROUTES = [
  'catalog/products/route.ts',
  'catalog/products/[id]/route.ts',
  'customers/route.ts',
  'customers/[id]/route.ts',
  'requests/route.ts',
  'pos/catalog/route.ts',
];

/** The only mutation in the customer area: an owner-only, audited reveal. */
const EXPECTED_OWNER_ROUTES = ['customers/[id]/reveal/route.ts'];
EXPECTED_OWNER_ROUTES.push('orders/[txnid]/reveal/route.ts');
// Voiding a POS sale is owner-only.
EXPECTED_OWNER_ROUTES.push('orders/[txnid]/void/route.ts');

const EXPECTED_MUTATING_ROUTES = [
  'orders/[txnid]/fulfilment/route.ts',
  'orders/[txnid]/delivery/route.ts',
  'requests/[id]/route.ts',
  'orders/[txnid]/payments/route.ts',
  'pos/sales/route.ts',
  'pos/shift/route.ts',
  'settings/route.ts',
];

const EXPECTED_ROUTES = [
  LOGIN_ROUTE,
  ...EXPECTED_READ_ONLY_ROUTES,
  ...EXPECTED_OWNER_ROUTES,
  ...EXPECTED_MUTATING_ROUTES,
];

async function collectRoutes(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRoutes(full)));
    } else if (ROUTE_FILE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

let routes;
try {
  routes = await collectRoutes(ROOT);
} catch {
  console.error('Could not read src/app/api/store-admin.');
  process.exit(1);
}

if (routes.length === 0) {
  console.error('No store-admin API routes found.');
  process.exit(1);
}

const relative = routes
  .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
  .sort();

if (!relative.includes(LOGIN_ROUTE)) {
  console.error(`Expected the public login route at ${LOGIN_ROUTE} — it is missing.`);
  process.exit(1);
}

let failed = false;

for (const expected of EXPECTED_ROUTES) {
  if (!relative.includes(expected)) {
    console.error(`Expected route ${expected} — it is missing.`);
    failed = true;
  }
}

for (const rel of relative) {
  const source = await readFile(path.join(ROOT, rel), 'utf8');
  // Ignore comments: mentioning the guard in documentation is not a call.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const guarded = GUARD_CALL.test(code);

  if (rel === LOGIN_ROUTE) {
    if (guarded) {
      console.error(`${rel}: FAIL (login is public and must not call requireStoreRole)`);
      failed = true;
    } else {
      console.log(`${rel}: OK (public login)`);
    }
    continue;
  }

  if (!guarded) {
    console.error(`${rel}: FAIL (missing requireStoreRole)`);
    failed = true;
    continue;
  }

  if (EXPECTED_OWNER_ROUTES.includes(rel)) {
    if (!OWNER_GUARD_CALL.test(code)) {
      console.error(
        `${rel}: FAIL (must call requireStoreRole('store_owner'))`,
      );
      failed = true;
      continue;
    }
    if (!SAME_ORIGIN_CALL.test(code)) {
      console.error(`${rel}: FAIL (mutating owner route must call assertSameOrigin)`);
      failed = true;
      continue;
    }
    console.log(`${rel}: OK (owner only, same-origin)`);
    continue;
  }

  if (EXPECTED_MUTATING_ROUTES.includes(rel)) {
    if (!SAME_ORIGIN_CALL.test(code)) {
      console.error(`${rel}: FAIL (mutating route must call assertSameOrigin)`);
      failed = true;
      continue;
    }
    console.log(`${rel}: OK (guarded, same-origin mutation)`);
    continue;
  }

  if (EXPECTED_READ_ONLY_ROUTES.includes(rel)) {
    const mutating = MUTATING_EXPORT.exec(code);
    if (mutating) {
      console.error(
        `${rel}: FAIL (read-only catalogue route exports ${mutating[1]})`,
      );
      failed = true;
      continue;
    }
    console.log(`${rel}: OK (guarded, GET only)`);
    continue;
  }

  console.log(`${rel}: OK`);
}

if (failed) {
  process.exit(1);
}

console.log(`\nAll ${relative.length} store-admin routes are guarded.`);
