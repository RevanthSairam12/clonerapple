import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'src/app/api/account');
const ROUTE_FILE = /^route\.(?:ts|tsx|js|jsx|mts)$/;
const SESSION_CALL = /\brequireAccountSessionApi\s*\(/;
const OWNERSHIP_CALL = /auth\.session\.userId/;

async function collectRoutes(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectRoutes(full)));
    else if (ROUTE_FILE.test(entry.name)) files.push(full);
  }
  return files;
}

let routes;
try {
  routes = await collectRoutes(ROOT);
} catch {
  console.error('Could not read src/app/api/account.');
  process.exit(1);
}
if (routes.length === 0) {
  console.error('No account API routes found.');
  process.exit(1);
}

let failed = false;
for (const file of routes) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  const source = (await readFile(file, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (!SESSION_CALL.test(source)) {
    console.error(`${relative}: FAIL (missing customer session guard)`);
    failed = true;
    continue;
  }
  if (relative.includes('orders/') && !OWNERSHIP_CALL.test(source)) {
    console.error(`${relative}: FAIL (missing session-user ownership scope)`);
    failed = true;
    continue;
  }
  console.log(`${relative}: OK`);
}
if (failed) process.exit(1);
console.log(`\nAll ${routes.length} account API routes check the customer session and ownership boundary.`);
