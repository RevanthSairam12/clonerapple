import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  jsx: true,
  alias: { '@': path.join(ROOT, 'src') },
});

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

test('Stage 5(1): cancelled orders hide active shipment details and log shipment_cancelled', async () => {
  const { toDeliverySnapshot } = await jiti.import(
    path.join(ROOT, 'src', 'lib', 'account', 'order-live.ts'),
  );

  // Even if shipmentStarted was true historically, a CANCELED delivery row returns null
  assert.equal(
    toDeliverySnapshot(
      {
        status: 'CANCELED',
        method: 'courier',
        courier_name: 'BlueDart',
        tracking_number: 'AWB12345',
        tracking_url: 'https://bluedart.example/track?awb=AWB12345',
      },
      true,
    ),
    null,
  );

  const returnsSrc = read('src/lib/store-admin/returns.ts');
  assert.match(returnsSrc, /'shipment_cancelled'/);

  const adminDetailSrc = read('src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/page.tsx');
  assert.match(adminDetailSrc, /Shipment cancelled\. Original shipment details are retained in the audit log only\./);

  const packingSlipSrc = read(
    'src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/packing-slip/page.tsx',
  );
  assert.match(packingSlipSrc, /Shipment cancelled/);
});

test('Stage 5(5): scripts/check-field-help.mjs verifies help text across all admin registries', () => {
  const output = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-field-help.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /All admin field help checks passed\./);
});

test('Stage 5(6): /account/* and /auth use Gadzio design tokens (#ffe100, #1d1d1f, transducer) and shared header/footer', () => {
  const accountFiles = [
    ...walkFiles(path.join(ROOT, 'src', 'app', 'account')),
    ...walkFiles(path.join(ROOT, 'src', 'components', 'account')),
    ...walkFiles(path.join(ROOT, 'src', 'app', 'auth')),
    ...walkFiles(path.join(ROOT, 'src', 'components', 'auth')),
  ];

  for (const file of accountFiles) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      src,
      /#0071e3|#0077ed/i,
      `Legacy Apple blue found in ${path.relative(ROOT, file)}`,
    );
  }

  const accountFrame = read('src/components/account/AccountFrame.tsx');
  assert.match(accountFrame, /GadzioHeader/);
  assert.match(accountFrame, /GlobalFooter/);
  assert.match(accountFrame, /transducer/);
  assert.match(accountFrame, /#ffe100/);

  const authPage = read('src/app/auth/page.tsx');
  assert.match(authPage, /GadzioHeader/);
  assert.match(authPage, /GlobalFooter/);
  assert.match(authPage, /transducer/);
});

test('Stage 5(7): /privacy, /terms and /support render inside normal layout, read store_pages/settings, and pass check-links', async () => {
  for (const pagePath of ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx', 'src/app/support/page.tsx']) {
    const src = read(pagePath);
    assert.match(src, /GadzioHeader/, `${pagePath} must render GadzioHeader`);
    assert.match(src, /GlobalFooter/, `${pagePath} must render GlobalFooter`);
    assert.match(src, /readStorePageAndContact/, `${pagePath} must read store_pages & contact`);
    assert.match(src, /Last updated:/, `${pagePath} must show Last updated date`);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, `${pagePath} must never inject raw HTML`);
  }

  const { parseSafePageParagraphs } = await jiti.import(
    path.join(ROOT, 'src', 'lib', 'storefront', 'site-pages.ts'),
  );
  const parsed = parseSafePageParagraphs('# Heading One\nFirst paragraph line 1\nline 2.\n\n## Second\nAnother.');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].heading, 'Heading One');
  assert.equal(parsed[0].paragraphs[0], 'First paragraph line 1 line 2.');
  assert.equal(parsed[1].heading, 'Second');

  const linkOutput = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-links.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(linkOutput, /All internal links resolve to valid routes\./);
});

test('Stage 5(7): /api/search/suggest matcher returns safe fields, caps at 6, and respects sale mode', async () => {
  const { matchSearchSuggestions, MAX_SEARCH_SUGGESTIONS } = await jiti.import(
    path.join(ROOT, 'src', 'lib', 'storefront', 'search-suggest.ts'),
  );

  const sampleProducts = Array.from({ length: 8 }, (_, idx) => ({
    id: `case-${idx + 1}`,
    name: `MagSafe Silicone Case ${idx + 1} for iPhone 16 Pro`,
    subtitle: 'Soft-touch silicone',
    brand: 'Gadzio',
    category: 'cases-protection',
    price: 1499,
    regularPrice: 1999,
    pricePaise: 149900,
    regularPricePaise: 199900,
    onSale: true,
    priceDisplay: '₹1,499.00',
    wasPriceDisplay: '₹1,999.00',
    image: '/images/case.png',
    href: `/shop/product/case-${idx + 1}`,
    inStock: idx % 2 === 0,
    inventoryMode: 'product',
    variants: [],
    optionConfig: {
      sellBy: 'none',
      models: [],
      colours: [],
      combinations: [],
      defaultImages: [],
      colourImages: {},
      cheapestPricePaise: 149900,
      cheapestRegularPricePaise: 199900,
      cheapestPriceDisplay: '₹1,499.00',
      cheapestWasPriceDisplay: '₹1,999.00',
      anyOnSale: true,
    },
    compatibility: ['iPhone 16 Pro'],
    scopedAttributes: {},
    keywords: ['magsafe', 'iphone 16 pro', `sku-${idx + 1}`],
    rating: 4.8,
    reviewCount: 12,
  }));

  // Below 2 chars -> empty
  assert.deepEqual(matchSearchSuggestions(sampleProducts, 'm', false), []);

  // Normal mode -> capped at 6, out-of-stock items have stockBlocked: true
  const normalResults = matchSearchSuggestions(sampleProducts, 'iphone 16', false);
  assert.equal(normalResults.length, MAX_SEARCH_SUGGESTIONS);
  assert.equal(normalResults[1].stockBlocked, true);
  assert.equal('cost_paise' in normalResults[0], false);
  assert.equal('availableStock' in normalResults[0], false);

  // Sale mode -> stockBlocked is always false
  const saleResults = matchSearchSuggestions(sampleProducts, 'iphone 16', true);
  assert.equal(saleResults.every((item) => item.stockBlocked === false && item.inStock === true), true);

  // Header combobox wiring
  const headerSrc = read('src/components/header/GadzioHeader.tsx');
  assert.match(headerSrc, /\/api\/search\/suggest\?q=/);
  assert.match(headerSrc, /role="combobox"/);
  assert.match(headerSrc, /role="listbox"/);
  assert.match(headerSrc, /See all results for/);
});

test('Stage 5(8): unwired settings are clearly labelled "Not active yet" in admin help text', async () => {
  const { SETTING_FIELDS } = await jiti.import(
    path.join(ROOT, 'src', 'lib', 'store-admin', 'settings-rules.ts'),
  );
  const { LIST_KINDS } = await jiti.import(
    path.join(ROOT, 'src', 'lib', 'store-admin', 'setting-lists.ts'),
  );

  for (const key of [
    'cod_enabled',
    'login_heading',
    'login_subheading',
    'login_background_media_id',
    'recaptcha_site_key',
    'recaptcha_status',
  ]) {
    const field = SETTING_FIELDS.find((f) => f.key === key);
    assert.ok(field, `Expected setting field ${key}`);
    assert.match(field.help, /Not active yet/i, `${key} help text must state "Not active yet"`);
  }

  for (const listKey of ['social-links', 'analytics-scripts', 'integrations']) {
    const list = LIST_KINDS[listKey];
    assert.ok(list, `Expected list kind ${listKey}`);
    assert.match(list.description, /Not active yet/i, `${listKey} description must state "Not active yet"`);
  }
});
