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

function createLoader() {
  const cache = new Map();
  function load(relativePath) {
    const filename = path.resolve(root, relativePath);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = readFileSync(filename, 'utf8');
    const module = { exports: {} };
    cache.set(filename, module);
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: filename,
      }).outputText,
      {
        module,
        exports: module.exports,
        structuredClone,
        console,
        window: undefined,
        document: undefined,
        require(name) {
          if (name === 'next/link') {
            return {
              __esModule: true,
              default: ({ children, ...props }) => React.createElement('a', props, children),
            };
          }
          if (name.startsWith('@/') || name.startsWith('.')) {
            const target = name.startsWith('@/')
              ? path.join(root, 'src', name.slice(2))
              : path.resolve(path.dirname(filename), name);
            for (const extension of ['.ts', '.tsx']) {
              try {
                readFileSync(target + extension);
              } catch {
                continue;
              }
              return load(target + extension);
            }
            throw new Error(`Unresolved local import: ${name}`);
          }
          return nativeRequire(name);
        },
      },
      { filename },
    );
    return module.exports;
  }
  return load;
}

const load = createLoader();
const {
  HERO_OVERLAY_COLLECTION_KEY,
  HERO_OVERLAY_DEFAULTS,
  HERO_OVERLAY_TARGET_ID,
  computeHeroOverlayGeometry,
  computeTapeImageStyle,
  isHeroOverlayActive,
  isSafeOverlayImageUrl,
  normalizeHeroOverlayConfig,
  validateHeroOverlayConfig,
} = load('src/lib/website/hero-overlay.ts');
const { getCollection } = load('src/lib/website/collections.ts');
const { getCollectionDefaults } = load('src/lib/website/defaults.ts');
const { GadzioHeroSection } = load('src/components/hero/GadzioHeroSection.tsx');

const render = (props = {}) => renderToStaticMarkup(React.createElement(GadzioHeroSection, props));
const plain = (value) => JSON.parse(JSON.stringify(value));

test('hero overlay validation & active guard enforce uploaded image presence and safe URLs', () => {
  assert.equal(HERO_OVERLAY_COLLECTION_KEY, 'gadzio.hero_overlay');
  assert.equal(HERO_OVERLAY_TARGET_ID, 'homepage-hero-tiles-new-ui');
  assert.deepEqual(plain(HERO_OVERLAY_DEFAULTS), { enabled: false, tapeImage1: '', tapeImage2: '' });

  // Disabled with missing images is allowed (safe default / incomplete draft)
  assert.equal(validateHeroOverlayConfig({ enabled: false, tapeImage1: '', tapeImage2: '' }), null);
  assert.equal(isHeroOverlayActive({ enabled: false, tapeImage1: '', tapeImage2: '' }), false);

  // Enabled with missing tape 1, tape 2, or both is rejected cleanly
  assert.match(
    validateHeroOverlayConfig({ enabled: true, tapeImage1: '/api/media/tape-1', tapeImage2: '' }) ?? '',
    /Upload both Tape image 1 and Tape image 2/,
  );
  assert.match(
    validateHeroOverlayConfig({ enabled: true, tapeImage1: '', tapeImage2: '/api/media/tape-2' }) ?? '',
    /Upload both Tape image 1 and Tape image 2/,
  );
  assert.equal(
    isHeroOverlayActive({ enabled: true, tapeImage1: '/api/media/tape-1', tapeImage2: '' }),
    false,
  );

  // Unsafe URLs are blocked on both validation and runtime guard
  for (const unsafe of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//evil.example/x.png', '/api/media/']) {
    assert.equal(isSafeOverlayImageUrl(unsafe), false);
    assert.ok(validateHeroOverlayConfig({ enabled: false, tapeImage1: unsafe, tapeImage2: '' }));
    assert.equal(isHeroOverlayActive({ enabled: true, tapeImage1: unsafe, tapeImage2: '/api/media/tape-2' }), false);
  }

  // Valid pair passes validation and activates overlay
  const valid = {
    enabled: true,
    tapeImage1: '/api/media/11111111-1111-4111-8111-111111111111',
    tapeImage2: '/api/media/22222222-2222-4222-8222-222222222222',
  };
  assert.equal(validateHeroOverlayConfig(valid), null);
  assert.equal(isHeroOverlayActive(valid), true);
  assert.deepEqual(plain(normalizeHeroOverlayConfig({ enabled: true, tapeImage1: '  /api/media/a  ' })), {
    enabled: true,
    tapeImage1: '/api/media/a',
    tapeImage2: '',
  });
});

test('responsive X-overlay geometry scales proportionally and preserves independent aspect ratios across all viewports', () => {
  const viewports = [
    { name: 'small-mobile', width: 359, height: 924 },
    { name: 'large-mobile', width: 600, height: 1020 },
    { name: 'tablet', width: 820, height: 620 },
    { name: 'desktop', width: 1560, height: 680 },
  ];

  for (const vp of viewports) {
    const geom = computeHeroOverlayGeometry(vp.width, vp.height);
    assert.ok(geom.diagonal > 0, vp.name);
    assert.ok(geom.spanPx >= geom.diagonal, `${vp.name}: span covers diagonal`);
    assert.ok(geom.angleDeg >= 26 && geom.angleDeg <= 66, `${vp.name}: clamped balanced angle (${geom.angleDeg})`);

    // Distinct vertical aspect ratios for Tape 1 and Tape 2 preserve intrinsic ratio (width: auto)
    const vertical1 = computeTapeImageStyle(geom, 1, { width: 300, height: 1400 });
    const vertical2 = computeTapeImageStyle(geom, -1, { width: 420, height: 1200 });
    assert.equal(vertical1.width, 'auto');
    assert.equal(vertical1.height, `${geom.spanPx}px`);
    assert.equal(vertical2.width, 'auto');
    assert.equal(vertical2.height, `${geom.spanPx}px`);
    assert.match(vertical1.transform, new RegExp(`rotate\\(${geom.angleDeg}deg\\)`));
    assert.match(vertical2.transform, new RegExp(`rotate\\(-${geom.angleDeg}deg\\)`));

    // Horizontal upload fallback keeps aspect ratio without distortion
    const horizontal = computeTapeImageStyle(geom, 1, { width: 1200, height: 300 });
    assert.equal(horizontal.height, 'auto');
    assert.equal(horizontal.width, `${geom.spanPx}px`);
  }
});

test('GadzioHeroSection disabled state restores exact original links without overlay markup', () => {
  for (const prop of [undefined, { enabled: false, tapeImage1: '/api/media/1', tapeImage2: '/api/media/2' }, { enabled: true, tapeImage1: '/api/media/1', tapeImage2: '' }]) {
    const html = render(prop ? { campaignOverlay: prop } : {});
    assert.match(html, /href="\/in\/shop\/iphone\/accessories\/cases-protection"/);
    assert.match(html, /href="\/shop\/product\/we-gadzio-pulse-usbc"/);
    assert.match(html, /href="\/in\/shop\/iphone\/accessories\/airpods-case"/);
    assert.doesNotMatch(html, /data-hero-campaign-overlay/);
    assert.doesNotMatch(html, /data-hero-campaign-trigger/);
    assert.doesNotMatch(html, /<button/);
  }
});

test('GadzioHeroSection enabled state renders both uploaded tapes over parent container and disables all nested links', () => {
  const tape1 = '/api/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tape2 = '/api/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const html = render({
    campaignOverlay: { enabled: true, tapeImage1: tape1, tapeImage2: tape2 },
  });
  const sectionStart = html.indexOf('<section');
  assert.ok(sectionStart >= 0);
  const sectionHtml = html.slice(sectionStart);

  // Zero underlying anchor tags or hrefs inside the hero section (no nested interactive controls)
  assert.doesNotMatch(sectionHtml, /<a\b/);
  assert.doesNotMatch(sectionHtml, /\bhref=/);

  // Underlying CTA copy remains visibly preserved inside the inert/aria-hidden 3-tile grid
  assert.match(sectionHtml, /SHOP ALL ACCESSORIES/);
  assert.match(sectionHtml, /SHOP EARPHONES/);
  assert.match(sectionHtml, /SHOP AIRPODS CASES/);
  assert.match(sectionHtml, /aria-hidden="true"/);

  // Exactly one accessible button covering the entire combined hero
  const triggers = sectionHtml.match(/data-hero-campaign-trigger="true"/g) ?? [];
  assert.equal(triggers.length, 1);
  assert.match(sectionHtml, /<button[^>]*type="button"[^>]*aria-label="Explore featured campaign showcase"/);

  // Both actual uploaded assets appear once each inside the single parent overlay container
  assert.equal(sectionHtml.split(tape1).length - 1, 1);
  assert.equal(sectionHtml.split(tape2).length - 1, 1);
  assert.match(sectionHtml, /data-hero-overlay-tape="1"/);
  assert.match(sectionHtml, /data-hero-overlay-tape="2"/);
});

test('Store Admin collection schema, defaults, ImageField Remove control, and API validation are wired securely', () => {
  const collection = getCollection('gadzio.hero_overlay');
  assert.ok(collection);
  assert.equal(collection.label, 'Hero Section Campaign Overlay');
  assert.equal(collection.disablable, undefined);
  assert.deepEqual(
    plain(collection.fields.map((f) => [f.path, f.type])),
    [
      ['enabled', 'boolean'],
      ['tapeImage1', 'image'],
      ['tapeImage2', 'image'],
    ],
  );
  assert.deepEqual(plain(getCollectionDefaults('gadzio.hero_overlay')), {
    enabled: false,
    tapeImage1: '',
    tapeImage2: '',
  });

  const fieldsSrc = readFileSync(path.join(root, 'src/components/store-admin/website/WebsiteFields.tsx'), 'utf8');
  assert.match(fieldsSrc, /onClick=\{\(\) => onChange\(''\)\}[\s\S]*?>\s*Remove\s*<\/button>/);

  const routeSrc = readFileSync(path.join(root, 'src/app/api/store-admin/website/content/[key]/route.ts'), 'utf8');
  assert.match(routeSrc, /assertSameOrigin\(request\)/);
  assert.match(routeSrc, /requireStoreRole\('store_owner'\)/);
  assert.match(routeSrc, /validateHeroOverlayConfig\(value\)/);
  assert.match(routeSrc, /invalid_hero_overlay/);

  const homeSrc = readFileSync(path.join(root, 'src/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage.tsx'), 'utf8');
  assert.match(homeSrc, /<GadzioHeroSection campaignOverlay=\{overrides\?\.heroOverlay\} \/>/);
  assert.match(homeSrc, /id=\{HERO_OVERLAY_TARGET_ID\}/);

  const eduSrc = readFileSync(path.join(root, 'src/components/sites/edu-store/EduStorePage.tsx'), 'utf8');
  assert.match(eduSrc, /<GadzioHeroSection \/>/);
});
