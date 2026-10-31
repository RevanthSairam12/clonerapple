/**
 * The account boundary checker.
 *
 * Every customer account API route must:
 *   1. call `requireAccountSessionApi()` (the customer session, not a staff one),
 *   2. scope its reads/writes by `auth.session.userId` (owner scope), so a
 *      route can never fall back to an id taken from the request,
 *   3. call `assertSameOrigin(request)` on every mutating handler.
 *
 * Every customer account page must call `requireAccountPageSession(...)` and be
 * explicitly dynamic, so one customer's page can never be cached or served to
 * another.
 *
 * It also fails if an account file imports a staff/admin identity helper, which
 * is the reuse the account boundary exists to prevent.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const API_ROOT = path.resolve(process.cwd(), 'src/app/api/account');
const PAGE_ROOT = path.resolve(process.cwd(), 'src/app/account');
const ROUTE_FILE = /^route\.(?:ts|tsx|js|jsx|mts)$/;
const PAGE_FILE = /^page\.(?:ts|tsx|js|jsx)$/;
const MUTATION = /\bexport\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/;

const SESSION_CALL = /\brequireAccountSessionApi\s*\(/;
const OWNERSHIP_CALL = /auth\.session\.userId/;
const SAME_ORIGIN_CALL = /\bassertSameOrigin\s*\(/;
const PAGE_SESSION_CALL = /\brequireAccountPageSession\s*\(/;
const DYNAMIC_EXPORT = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/;
const STAFF_IDENTITY = /\b(requireStoreRole|requireStoreSession|requireAdmin|admin_session|store_admin_session|store_admin_sessions|admin_sessions)\b/;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function collect(dir, pattern) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full, pattern)));
    else if (pattern.test(entry.name)) files.push(full);
  }
  return files;
}

let routes;
try {
  routes = await collect(API_ROOT, ROUTE_FILE);
} catch {
  console.error('Could not read src/app/api/account.');
  process.exit(1);
}
if (routes.length === 0) {
  console.error('No account API routes found.');
  process.exit(1);
}

let pages;
try {
  pages = await collect(PAGE_ROOT, PAGE_FILE);
} catch {
  console.error('Could not read src/app/account.');
  process.exit(1);
}

let failed = false;

for (const file of routes) {
  const relative = `api/account/${path.relative(API_ROOT, file).split(path.sep).join('/')}`;
  const source = stripComments(await readFile(file, 'utf8'));

  if (!SESSION_CALL.test(source)) {
    console.error(`${relative}: FAIL (missing customer session guard)`);
    failed = true;
    continue;
  }
  if (!OWNERSHIP_CALL.test(source)) {
    console.error(`${relative}: FAIL (missing session-user ownership scope)`);
    failed = true;
    continue;
  }
  if (MUTATION.test(source) && !SAME_ORIGIN_CALL.test(source)) {
    console.error(`${relative}: FAIL (mutating handler without assertSameOrigin)`);
    failed = true;
    continue;
  }
  if (STAFF_IDENTITY.test(source)) {
    console.error(`${relative}: FAIL (account route references a staff/admin identity)`);
    failed = true;
    continue;
  }
  console.log(`${relative}: OK`);
}

for (const file of pages) {
  const relative = `account/${path.relative(PAGE_ROOT, file).split(path.sep).join('/')}`;
  const source = stripComments(await readFile(file, 'utf8'));

  if (!PAGE_SESSION_CALL.test(source)) {
    console.error(`${relative}: FAIL (missing customer page session guard)`);
    failed = true;
    continue;
  }
  if (!DYNAMIC_EXPORT.test(source)) {
    console.error(`${relative}: FAIL (account page is not force-dynamic)`);
    failed = true;
    continue;
  }
  if (STAFF_IDENTITY.test(source)) {
    console.error(`${relative}: FAIL (account page references a staff/admin identity)`);
    failed = true;
    continue;
  }
  console.log(`${relative}: OK`);
}

if (failed) process.exit(1);
console.log(
  `\nAll ${routes.length} account API routes check the customer session and ownership boundary, ` +
    `and all ${pages.length} account pages are session-guarded and dynamic.`,
);