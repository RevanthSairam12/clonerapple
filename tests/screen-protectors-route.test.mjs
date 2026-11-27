import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);

function load(relative) {
  const filename = path.resolve(root, relative);
  const module = { exports: {} };
  const outputText = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name) {
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        for (const ext of ['.ts', '.tsx']) {
          try {
            readFileSync(target + ext);
            return load(target + ext);
          } catch {}
        }
      }
      return nativeRequire(name);
    },
    console,
  });
  return module.exports;
}

test('mobile-cases config displays Screen Protectors while preserving DB category slug', () => {
  const { CONFIG } = load('src/components/sites/accessories/data/mobile-cases.ts');
  assert.equal(CONFIG.slug, 'mobile-cases');
  assert.equal(CONFIG.title, 'Screen Protectors');
  assert.equal(CONFIG.breadcrumbLeaf, 'Screen Protectors');
  assert.equal(CONFIG.countNoun, 'screen protectors');
  assert.match(CONFIG.subhead, /screen protectors/i);
  assert.equal(CONFIG.seo.title, 'Screen Protectors | Gadzio Store');
  assert.match(CONFIG.seo.description, /screen protectors/i);

  const { buildCategoryLinks } = load('src/components/sites/accessories/data/types.ts');
  const links = buildCategoryLinks(CONFIG.slug);
  const activeLink = links.find((link) => link.active);
  assert.deepEqual(JSON.parse(JSON.stringify(activeLink)), {
    label: 'Screen Protectors',
    href: '/in/shop/iphone/accessories/screen-protectors',
    active: true,
  });
});

test('screen-protectors route renders AccessoryCategoryPage with mobile-cases DB slug', () => {
  const route = readFileSync(
    path.join(root, 'src/app/in/shop/iphone/accessories/screen-protectors/page.tsx'),
    'utf8',
  );
  assert.match(route, /@\/components\/sites\/accessories\/data\/mobile-cases/);
  assert.match(route, /siteOpenGraphUrl\('\/in\/shop\/iphone\/accessories\/screen-protectors'\)/);
  assert.match(route, /getAccessoryProductsView\(CONFIG\.slug\)/);
  assert.match(route, /config=\{\{ \.\.\.CONFIG, filters, quickPillFacet, quickPills \}\}/);
});

test('next.config.ts defines permanent 301 redirect from /mobile-cases to /screen-protectors', async () => {
  const { default: nextConfig } = load('next.config.ts');
  const redirects = await nextConfig.redirects();
  assert.ok(
    redirects.some(
      (r) =>
        r.source === '/in/shop/iphone/accessories/mobile-cases' &&
        r.destination === '/in/shop/iphone/accessories/screen-protectors' &&
        r.statusCode === 301,
    ),
  );
});

test('header, footer, sale, search, and tiles point to /screen-protectors without legacy /mobile-cases links', () => {
  const files = [
    'src/components/sites/accessories/data/types.ts',
    'src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav.ts',
    'src/components/footer/GadzioFooter.tsx',
    'src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer.ts',
    'src/app/sale/page.tsx',
    'src/components/search/SearchPageView.tsx',
    'src/lib/search/searchService.ts',
    'src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts',
  ];
  for (const rel of files) {
    const content = readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(
      content,
      /\/in\/shop\/iphone\/accessories\/mobile-cases/,
      `${rel} should use /in/shop/iphone/accessories/screen-protectors`,
    );
    assert.match(
      content,
      /\/in\/shop\/iphone\/accessories\/screen-protectors/,
      `${rel} must link to /in/shop/iphone/accessories/screen-protectors`,
    );
  }
});
