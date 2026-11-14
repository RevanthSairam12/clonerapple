import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);

// Same transpileModule + VM pattern as staff-session-monitor/auth-behavior.
// Use real React SSR (effects do not run) and a plain anchor for next/link.
function createLoader({ serverDataOnly = false } = {}) {
  const cache = new Map();
  function load(relativePath) {
    const filename = path.resolve(root, relativePath);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = readFileSync(filename, 'utf8');
    if (serverDataOnly) {
      assert.doesNotMatch(source, /^\s*['"]use client['"]/m, filename);
    }
    const module = { exports: {} };
    cache.set(filename, module);
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      },
      fileName: filename,
    }).outputText, {
      module, exports: module.exports, structuredClone, console,
      require(name) {
        if (name === 'next/link') {
          return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
        }
        if (name.startsWith('@/') || name.startsWith('.')) {
          const target = name.startsWith('@/')
            ? path.join(root, 'src', name.slice(2))
            : path.resolve(path.dirname(filename), name);
          for (const extension of ['.ts', '.tsx']) {
            try { readFileSync(target + extension); } catch { continue; }
            return load(target + extension);
          }
          throw new Error(`Unresolved local import: ${name}`);
        }
        assert.equal(serverDataOnly, false, `Unexpected runtime dependency in server defaults: ${name}`);
        return nativeRequire(name);
      },
    }, { filename });
    return module.exports;
  }
  return load;
}

const loadData = createLoader({ serverDataOnly: true });
const { getCollectionDefaults } = loadData('src/lib/website/defaults.ts');
const { COLLECTIONS, LEGACY_COLLECTION_KEYS, THEME_FIELDS, getCollection } = loadData('src/lib/website/collections.ts');
const { validateLegacyContentWrite } = loadData('src/lib/website/boundary.ts');
const loadComponent = createLoader();
const { getByPath } = loadComponent('src/lib/website/json-path.ts');
const sections = [
  ['gadzio.trust_badges', 'trust/GadzioTrustBar', 'GadzioTrustBar'],
  ['gadzio.category_grid', 'categories/GadzioCategoryGrid', 'GadzioCategoryGrid'],
  ['gadzio.brand_bar', 'brands/GadzioBrandBar', 'GadzioBrandBar'],
  ['gadzio.diwali_campaign', 'diwali/GadzioDiwaliSection', 'GadzioDiwaliSection'],
  ['gadzio.crowd_favorites', 'crowd-favorites/GadzioCrowdFavorites', 'GadzioCrowdFavorites'],
  ['gadzio.event_banner', 'banner/GadzioEventBanner', 'GadzioEventBanner'],
  ['gadzio.sale_banner', 'banner/GadzioSaleBanner', 'GadzioSaleBanner'],
  ['gadzio.reviews', 'reviews/GadzioReviewsSection', 'GadzioReviewsSection'],
  ['gadzio.in_the_wild', 'ugc/GadzioInTheWild', 'GadzioInTheWild'],
];
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const plain = value => JSON.parse(JSON.stringify(value));

for (const [key, file, name] of sections) {
  test(`${key}: untouched editor prefill renders exactly the storefront fallback`, () => {
    const Component = loadComponent(`src/components/${file}.tsx`)[name];
    const defaults = getCollectionDefaults(key);
    assert.equal(render(Component, defaults), render(Component));
    assert.equal(render(Component, { ...defaults, enabled: false }), '');
    assert.equal(validateLegacyContentWrite(key, defaults).ok, true);
  });
}

test('Crowd Favorites uses priceDisplay first, supports legacy price, and keeps commerce rejection', () => {
  const { GadzioCrowdFavorites } = loadComponent('src/components/crowd-favorites/GadzioCrowdFavorites.tsx');
  const item = { title: 'Display test', image: '/test.jpg', href: '/test', price: 'legacy-price' };
  assert.match(render(GadzioCrowdFavorites, { items: [item] }), /legacy-price/);
  const preferred = render(GadzioCrowdFavorites, { items: [{ ...item, priceDisplay: 'display-price' }] });
  assert.match(preferred, /display-price/);
  assert.doesNotMatch(preferred, /legacy-price/);
  assert.doesNotMatch(render(GadzioCrowdFavorites, { items: [{ ...item, priceDisplay: '' }] }), /legacy-price/);
  for (const key of ['gadzio.crowd_favorites', 'apple.footer']) {
    for (const field of ['price', 'sku', 'stock', 'quantity', 'product_id']) {
      assert.equal(validateLegacyContentWrite(key, { items: [{ [field]: 'blocked' }] }).ok, false, field);
    }
  }
  assert.equal(validateLegacyContentWrite('edu.shelf_savings', { cards: [{ price: 'unchanged' }] }).ok, true);
  assert.ok(getCollectionDefaults('gadzio.crowd_favorites').items.every(item => 'priceDisplay' in item && !('price' in item)));
});

test('all editable collections have clone-isolated defaults and no non-Education commerce fields', () => {
  for (const collection of COLLECTIONS) {
    const defaults = getCollectionDefaults(collection.key);
    assert.ok(defaults, collection.key);
    assert.equal(validateLegacyContentWrite(collection.key, defaults).ok, true, collection.key);
    const original = plain(defaults);
    defaults.__test = true;
    assert.deepEqual(plain(getCollectionDefaults(collection.key)), original);
    // Required rendered fields must resolve; optional strings may be omitted.
    for (const field of collection.fields) {
      if (field.type === 'boolean') assert.equal(typeof getByPath(defaults, field.path), 'boolean');
    }
  }
  assert.equal(getCollectionDefaults('unknown'), null);
});

test('brand links remain safe when a newly added link-only item moves into the first slot', () => {
  const { GadzioBrandBar } = loadComponent('src/components/brands/GadzioBrandBar.tsx');
  assert.doesNotThrow(() => render(GadzioBrandBar, { items: [{ href: '/new-brand' }] }));
});

test('brand wordmarks ignore stale saved names while preserving links', () => {
  const { GadzioBrandBar } = loadComponent('src/components/brands/GadzioBrandBar.tsx');
  const html = render(GadzioBrandBar, { items: Array.from({ length: 6 }, (_, index) => ({ name: 'Retired brand label', href: `/brand-${index}` })) });
  assert.doesNotMatch(html, /Retired brand label/);
  assert.match(html, /GADZIO SIGNATURE/);
  for (let index = 0; index < 6; index++) assert.ok(html.includes(`href="/brand-${index}"`));
});

test('editor drops dead paths without exposing retired OPPO keys', () => {
  assert.equal(COLLECTIONS.length, 33);
  assert.equal(COLLECTIONS.filter(collection => collection.key.startsWith('edu.')).length, 11);
  assert.equal(LEGACY_COLLECTION_KEYS.length, 11);
  for (const key of LEGACY_COLLECTION_KEYS) {
    assert.match(key, /^oppo\./);
    assert.equal(getCollection(key), undefined);
    assert.equal(getCollectionDefaults(key), null);
  }
  const paths = key => getCollection(key).fields.map(field => field.path);
  const itemPaths = key => getCollection(key).lists.flatMap(list => list.itemFields.map(field => field.path));
  assert.ok(paths('apple.footer').includes('copyright'));
  assert.ok(!paths('apple.footer').includes('footnotesHtml'));
  assert.ok(!paths('apple.gallery').includes('heading'));
  assert.ok(!paths('cases.page_header').includes('sortLabel'));
  assert.ok(!itemPaths('apple.hero_video').includes('label'));
  assert.ok(!itemPaths('gadzio.reviews').includes('rating'));
  assert.deepEqual(plain(itemPaths('gadzio.brand_bar')), ['href']);
  assert.ok(!paths('gadzio.brand_bar').includes('items[0].name'));
  assert.deepEqual(plain(THEME_FIELDS.map(field => field.path)), ['homepageUiMode', 'fontFamily', 'appleCopyright']);
});

test('labels and view-on-site paths reflect actual consumers', () => {
  for (const key of ['apple.hero_tiles', 'apple.hero_video']) {
    assert.match(getCollection(key).label, /Old UI only/);
  }
  assert.match(getCollection('apple.locale_banner').description, /Not currently shown/);
  assert.match(getCollection('edu.hero').description, /Not currently rendered/);
  assert.deepEqual(plain(getCollection('apple.footer').sitePaths), ['/']);
  assert.ok(getCollection('apple.nav').sitePaths.includes('/'));
  assert.ok(getCollection('apple.nav').sitePaths.includes('/support'));
  for (const key of ['cases.category_links', 'cases.page_header']) {
    assert.deepEqual(plain(getCollection(key).sitePaths), ['/in/shop/iphone/accessories/cases-protection', '/shop/iphone/accessories/cases-protection']);
  }
  assert.deepEqual(plain(getCollection('cases.seo').sitePaths), ['/in/shop/iphone/accessories/cases-protection']);
  assert.match(getCollection('cases.seo').description, /static metadata/);
  assert.match(getCollection('apple.nav').lists[0].itemFields.find(field => field.path === 'href').hint, /Editable link/);
  assert.ok(getCollection('apple.nav').lists.some(list => list.path === 'secondaryLinks'));
  assert.match(THEME_FIELDS.find(field => field.path === 'fontFamily').hint, /some homepage sections set their own face/);
  assert.match(THEME_FIELDS.find(field => field.path === 'appleCopyright').hint, /homepage only/);
});

test('opt-in sections remain hidden on no-op save', () => {
  assert.equal(getCollectionDefaults('apple.hero_video').enabled, false);
  assert.equal(getCollectionDefaults('apple.gallery').enabled, false);
  const hero = readFileSync(path.join(root, 'src/components/sites/www-apple-com-736d3707/root-8a5edab2/HeroSection.tsx'), 'utf8');
  assert.match(hero, /video\?\.enabled === true/);
});
