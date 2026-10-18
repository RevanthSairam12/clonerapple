/**
 * Guard against an unprotected store-admin API route.
 *
 * Every `route.*` file under src/app/api/store-admin must call
 * `requireStoreRole(...)` — except the login route, which is public by design.
 * New routes are picked up automatically; no list to maintain.
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

/**
 * Catalogue routes are read-only in this release. Price and stock writes stay
 * disabled until checkout reads prices from the database.
 */
const EXPECTED_READ_ONLY_ROUTES = [
  'catalog/products/route.ts',
  'catalog/products/[id]/route.ts',
];
const EXPECTED_ROUTES = [LOGIN_ROUTE, ...EXPECTED_READ_ONLY_ROUTES];

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
