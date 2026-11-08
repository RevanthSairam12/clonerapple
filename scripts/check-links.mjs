/**
 * Verify that internal storefront links across /privacy, /terms, /support,
 * /auth, GadzioHeader, GadzioFooter, and navigation data resolve to real
 * pages or routes in the app.
 *
 * Usage: node scripts/check-links.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'src', 'app');

function collectPagePatterns(dir, relPrefix = '') {
  const patterns = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'api') continue;
      const isRouteGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
      const nextRel = isRouteGroup
        ? relPrefix
        : `${relPrefix}/${entry.name}`;
      patterns.push(...collectPagePatterns(full, nextRel));
    } else if (entry.name === 'page.tsx' || entry.name === 'route.ts') {
      const routePath = relPrefix || '/';
      patterns.push(routePath);
    }
  }
  return patterns;
}

const routePatterns = collectPagePatterns(APP_DIR);
const routeRegexes = routePatterns.map((pattern) => {
  const escaped = pattern
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (/^\[\.\.\..+\]$/.test(segment)) return '.+';
      if (/^\[.+\]$/.test(segment)) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${escaped || '/'}$`);
});

function routeExists(href) {
  const clean = href.split('#')[0].split('?')[0] || '/';
  return routeRegexes.some((re) => re.test(clean));
}

const FILES_TO_CHECK = [
  'src/app/privacy/page.tsx',
  'src/app/terms/page.tsx',
  'src/app/support/page.tsx',
  'src/app/auth/page.tsx',
  'src/components/header/GadzioHeader.tsx',
  'src/components/footer/GadzioFooter.tsx',
  'src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav.ts',
  'src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer.ts',
];

let checkedCount = 0;
let failures = 0;

for (const relFile of FILES_TO_CHECK) {
  const absFile = path.join(ROOT, relFile);
  if (!existsSync(absFile)) {
    console.error(`FAIL: missing file ${relFile}`);
    failures += 1;
    continue;
  }
  const source = readFileSync(absFile, 'utf8');
  const matches = [
    ...source.matchAll(/\bhref\s*[:=]\s*['"](\/[^'"]*)['"]/g),
  ];
  for (const match of matches) {
    const href = match[1];
    checkedCount += 1;
    if (!routeExists(href)) {
      console.error(`FAIL: broken internal link "${href}" in ${relFile}`);
      failures += 1;
    }
  }
}

console.log(`OK: verified ${checkedCount} internal links across ${FILES_TO_CHECK.length} files.`);
if (failures > 0) {
  console.error(`\nLink check FAILED (${failures} broken link(s)).`);
  process.exit(1);
}
console.log('All internal links resolve to valid routes.');
