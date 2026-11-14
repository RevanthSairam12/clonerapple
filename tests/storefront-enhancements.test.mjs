import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: true,
  jsx: true,
  alias: { '@': path.join(root, 'src') },
});

const {
  getPincodeLocation,
  getUniqueByFrequency,
  getMostFrequent,
  isValidIndianPincode,
} = await jiti.import(path.join(root, 'src/lib/storefront/pincode.ts'));

const { GET: pincodeRouteGet } = await jiti.import(
  path.join(root, 'src/app/api/pincode/[pincode]/route.ts'),
);

const { selectSalePageProducts } = await jiti.import(
  path.join(root, 'src/lib/storefront/sale-page.ts'),
);

const { GadzioTrustBar } = await jiti.import(
  path.join(root, 'src/components/trust/GadzioTrustBar.tsx'),
);

const { StorefrontTrustBarProvider } = await jiti.import(
  path.join(root, 'src/components/trust/StorefrontTrustBarContext.tsx'),
);

const { GadzioSaleBanner } = await jiti.import(
  path.join(root, 'src/components/banner/GadzioSaleBanner.tsx'),
);

async function source(relPath) {
  return readFile(path.join(root, relPath), 'utf8');
}

/* ------------------------------------------- 1. Pincode lookup & 7-9 days */

test('getUniqueByFrequency and getMostFrequent rank occurrences accurately', () => {
  assert.deepEqual(
    getUniqueByFrequency(['Visakhapatnam', 'Vizianagaram', 'Visakhapatnam']),
    ['Visakhapatnam', 'Vizianagaram'],
  );
  assert.equal(getMostFrequent(['Bhimavaram', 'Mogalturu', 'Bhimavaram']), 'Bhimavaram');
  assert.equal(getMostFrequent([]), null);
});

test('getPincodeLocation strips (mdl), skips NA, and preserves frequency-sorted districts for border PINs', () => {
  const sample = [
    {
      Message: 'Number of Post office(s) found:3',
      Status: 'Success',
      PostOffice: [
        {
          Name: 'Bheemunipatnam',
          District: 'Visakhapatnam',
          Division: 'Visakhapatnam',
          Block: 'Bheemunipatnam(mdl)',
          State: 'Andhra Pradesh',
          Pincode: '531162',
        },
        {
          Name: 'Border BO 1',
          District: 'Visakhapatnam',
          Division: 'Visakhapatnam',
          Block: 'Bheemunipatnam (Mdl)',
          State: 'Andhra Pradesh',
          Pincode: '531162',
        },
        {
          Name: 'Border BO 2',
          District: 'Vizianagaram',
          Division: 'Vizianagaram',
          Block: 'NA',
          State: 'Andhra Pradesh',
          Pincode: '531162',
        },
      ],
    },
  ];

  assert.deepEqual(getPincodeLocation(sample), {
    pincode: '531162',
    town: 'Bheemunipatnam',
    defaultDistrict: 'Visakhapatnam',
    districts: ['Visakhapatnam', 'Vizianagaram'],
    state: 'Andhra Pradesh',
  });
});

test('getPincodeLocation falls back to Division then District when Block is NA', () => {
  const withDivision = [
    {
      Status: 'Success',
      PostOffice: [
        { District: 'Mumbai', Division: 'Mumbai GPO', Block: 'NA', State: 'Maharashtra', Pincode: '400001' },
      ],
    },
  ];
  assert.equal(getPincodeLocation(withDivision).town, 'Mumbai GPO');

  const withDistrictOnly = [
    {
      Status: 'Success',
      PostOffice: [
        { District: 'Pune', Division: 'NA', Block: 'NA', State: 'Maharashtra', Pincode: '411001' },
      ],
    },
  ];
  assert.equal(getPincodeLocation(withDistrictOnly).town, 'Pune');
});

test('getPincodeLocation returns null on No records found / Error / null payloads', () => {
  assert.equal(
    getPincodeLocation([{ Message: 'No records found', Status: 'Error', PostOffice: null }]),
    null,
  );
  assert.equal(getPincodeLocation([]), null);
  assert.equal(getPincodeLocation(null), null);
  assert.equal(isValidIndianPincode('400001'), true);
  assert.equal(isValidIndianPincode('000001'), false);
  assert.equal(isValidIndianPincode('4000'), false);
});

test('/api/pincode/[pincode] validates format, parses upstream success, and safely falls back on Error', async () => {
  const bad = await pincodeRouteGet(new Request('http://localhost/api/pincode/123'), {
    params: Promise.resolve({ pincode: '123' }),
  });
  assert.equal(bad.status, 400);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            Status: 'Success',
            PostOffice: [
              { District: 'West Godavari', Division: 'Bhimavaram', Block: 'Bhimavaram(mdl)', State: 'Andhra Pradesh', Pincode: '534201' },
            ],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const good = await pincodeRouteGet(new Request('http://localhost/api/pincode/534201'), {
      params: Promise.resolve({ pincode: '534201' }),
    });
    assert.equal(good.status, 200);
    const goodBody = await good.json();
    assert.equal(goodBody.ok, true);
    assert.equal(goodBody.location.town, 'Bhimavaram');

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([{ Message: 'No records found', Status: 'Error', PostOffice: null }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const missing = await pincodeRouteGet(new Request('http://localhost/api/pincode/999999'), {
      params: Promise.resolve({ pincode: '999999' }),
    });
    assert.equal(missing.status, 200);
    const missingBody = await missing.json();
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.location, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeliveryOptionsModal and product pages display 7-9 Business Days and zero 2-3 Business Days', async () => {
  const modal = await source('src/components/shop/DeliveryOptionsModal.tsx');
  const productDetail = await source('src/components/shop/ProductDetailPage.tsx');
  const accessoryDetail = await source('src/components/sites/accessories/AccessoryDetailPage.tsx');

  assert.match(modal, /FREE \(7-9 Business Days\)/);
  assert.doesNotMatch(modal, /2-3 Business Days/);
  assert.doesNotMatch(productDetail, /2-3 Business Days/);
  assert.doesNotMatch(accessoryDetail, /2-3 Business Days/);
  assert.match(productDetail, /<DeliveryOptionsModal/);
  assert.match(accessoryDetail, /<DeliveryOptionsModal/);
});

/* ------------------------------------------- 2. /sale page & Sale Banner */

function baseStorefrontProduct(overrides = {}) {
  return {
    id: 'prod-1',
    slug: 'prod-1',
    name: 'Crystal Case',
    subtitle: 'Clear MagSafe',
    price: 999,
    pricePaise: 99900,
    priceDisplay: '₹999.00',
    regularPricePaise: 99900,
    salePricePaise: null,
    onSale: false,
    compareAtPaise: null,
    image: '/case.jpg',
    gallery: ['/case.jpg'],
    images: [],
    colors: [],
    facets: {},
    facetValues: {},
    facetLabels: {},
    searchValues: [],
    compatibility: [],
    compatibilityModels: [],
    material: '',
    brand: 'Gadzio',
    description: '',
    shortDescription: null,
    descriptionSections: null,
    highlights: [],
    features: [],
    specs: [],
    inTheBox: [],
    inStock: true,
    stockState: 'in_stock',
    availableStock: 10,
    lowStockThreshold: 2,
    trackInventory: true,
    inventoryMode: 'product',
    purchasableVariants: [],
    categoryId: 'cat-1',
    categorySlug: 'cases-protection',
    categoryName: 'Cases & Protection',
    href: '/shop/product/prod-1',
    ...overrides,
  };
}

test('selectSalePageProducts includes live sales and compare-at discounted items without leaking future sales', () => {
  const saleItem = baseStorefrontProduct({
    id: 'sale-1',
    name: 'Flash Charger',
    regularPricePaise: 199900,
    pricePaise: 199900,
    salePricePaise: 149900,
  });
  const compareDiscountItem = baseStorefrontProduct({
    id: 'mrp-1',
    name: 'Braided Cable',
    regularPricePaise: 79900,
    pricePaise: 79900,
    compareAtPaise: 119900,
  });
  const regularItem = baseStorefrontProduct({
    id: 'reg-1',
    name: 'Standard Adapter',
    regularPricePaise: 129900,
    pricePaise: 129900,
  });
  const variantSaleItem = baseStorefrontProduct({
    id: 'var-1',
    name: 'Variant Case',
    inventoryMode: 'variant',
    purchasableVariants: [
      {
        id: 'v1',
        sku: 'VC-1',
        label: 'Black',
        deviceModelId: null,
        deviceModelName: null,
        deviceModelBrandId: null,
        deviceModelBrandName: null,
        deviceModelEligible: true,
        optionName: 'Color',
        optionValue: 'Black',
        combinationKey: 'black',
        colourId: null,
        colourName: 'Black',
        colourHex: '#000000',
        pricePaise: 99900,
        regularPricePaise: 99900,
        salePricePaise: 69900,
        onSale: false,
        inStock: true,
      },
    ],
  });

  const whenSaleOff = selectSalePageProducts(
    [saleItem, compareDiscountItem, regularItem, variantSaleItem],
    false,
  );
  assert.deepEqual(
    whenSaleOff.map((p) => p.id),
    ['mrp-1'],
    'only compare-at discounted items show while sale mode is off',
  );
  assert.equal(whenSaleOff[0].wasPriceDisplay, '₹1,199.00');
  assert.equal(whenSaleOff[0].regularPrice, undefined);

  const whenSaleLive = selectSalePageProducts(
    [saleItem, compareDiscountItem, regularItem, variantSaleItem],
    true,
  );
  assert.deepEqual(
    whenSaleLive.map((p) => p.id),
    ['sale-1', 'mrp-1', 'var-1'],
  );
  assert.equal(whenSaleLive[0].price, 1499);
  assert.equal(whenSaleLive[0].wasPriceDisplay, '₹1,999.00');
});

test('/sale page renders cleanly without 404, places editable banner under nav strip, and links from Store Admin Sale', async () => {
  const salePage = await source('src/app/sale/page.tsx');
  const collectionPage = await source('src/components/collection/CollectionPage.tsx');
  const adminSalePage = await source('src/app/(store-admin)/store-admin/(protected)/sale/page.tsx');

  assert.doesNotMatch(salePage, /notFound\(/);
  assert.match(salePage, /selectSalePageProducts\(/);
  assert.match(salePage, /gadzio\.sale_banner/);
  assert.match(salePage, /readTrustBarContent\(\)/);

  const navStripIdx = collectionPage.indexOf('gz-collection-nav-strip');
  const bannerIdx = collectionPage.indexOf('<GadzioSaleBanner');
  const containerIdx = collectionPage.indexOf('<div className="gz-collection-container flex-1">');
  assert.ok(navStripIdx !== -1 && bannerIdx > navStripIdx && bannerIdx < containerIdx);

  assert.match(adminSalePage, /\/store-admin\/website\/content\/gadzio\.sale_banner/);

  const bannerHtml = renderToStaticMarkup(
    React.createElement(GadzioSaleBanner, {
      kicker: 'DIWALI DROP',
      heading: 'Festive Deals Live',
      subtitle: 'Limited stock savings across audio & cases.',
      badgeText: 'FLASH',
      ctaLabel: 'Browse Offers',
      ctaHref: '#collection-grid-content',
    }),
  );
  assert.match(bannerHtml, /DIWALI DROP/);
  assert.match(bannerHtml, /Festive Deals Live/);
  assert.equal(
    renderToStaticMarkup(React.createElement(GadzioSaleBanner, { enabled: false })),
    '',
  );
});

/* ------------------------------------------- 3. Shared Trust Badges Bar */

test('GadzioTrustBar inherits admin content from StorefrontTrustBarProvider across pages', async () => {
  const customBadges = [
    { title: 'EXPRESS DISPATCH', subtitle: 'Ships within 24h', icon: 'shipping' },
    { title: '1-YEAR WARRANTY', subtitle: 'Hassle-free replacement', icon: 'shield' },
  ];

  const inheritedHtml = renderToStaticMarkup(
    React.createElement(
      StorefrontTrustBarProvider,
      { value: { enabled: true, items: customBadges } },
      React.createElement(GadzioTrustBar),
    ),
  );
  assert.match(inheritedHtml, /EXPRESS DISPATCH/);
  assert.match(inheritedHtml, /1-YEAR WARRANTY/);

  const hiddenHtml = renderToStaticMarkup(
    React.createElement(
      StorefrontTrustBarProvider,
      { value: { enabled: false, items: customBadges } },
      React.createElement(GadzioTrustBar),
    ),
  );
  assert.equal(hiddenHtml, '');

  const productPage = await source('src/app/shop/product/[productId]/page.tsx');
  const buyPage = await source('src/app/shop/buy/[productId]/page.tsx');
  const searchPage = await source('src/app/search/page.tsx');
  const rootLayout = await source('src/app/layout.tsx');
  const contentApi = await source('src/app/api/store-admin/website/content/[key]/route.ts');

  for (const fileText of [productPage, buyPage, searchPage, rootLayout]) {
    assert.match(fileText, /readTrustBarContent/);
  }
  assert.match(contentApi, /gadzio\.trust_badges/);
  assert.match(contentApi, /revalidatePath\('\/', 'layout'\)/);
});

/* ------------------------------------------- 4. Spin & Win Desktop Popup */

test('HomeSpinPopup modal overlays sticky header and floating brand switcher cleanly', async () => {
  const popup = await source('src/components/spin-wheel/HomeSpinPopup.tsx');
  const header = await source('src/components/header/GadzioHeader.tsx');
  const switcher = await source('src/components/common/FloatingBrandSwitcher.tsx');

  const headerZMatch = header.match(/className="gz-header[^"]*z-\[(\d+)\]/);
  const switcherZMatch = switcher.match(/className="[^"]*z-\[(\d+)\]/);
  const popupZMatch = popup.match(/role="dialog"[\s\S]*?z-\[(\d+)\]/);

  assert.ok(headerZMatch && switcherZMatch && popupZMatch);
  const headerZ = Number(headerZMatch[1]);
  const switcherZ = Number(switcherZMatch[1]);
  const popupZ = Number(popupZMatch[1]);

  assert.ok(
    popupZ > headerZ && popupZ > switcherZ,
    `HomeSpinPopup z-[${popupZ}] must sit above header z-[${headerZ}] and switcher z-[${switcherZ}]`,
  );
});

/* ------------------------------------------- 5. Cart Delivery Strip & Trust Bar */

test('CartPageView omits Free 7-day returns and syncs Trust Badges Bar above footer with admin content', async () => {
  const cartView = await source('src/components/cart/CartPageView.tsx');
  const cartPage = await source('src/app/cart/page.tsx');
  const bagPage = await source('src/app/bag/page.tsx');

  assert.match(cartView, /Delivery across India\./);
  assert.doesNotMatch(cartView, /Free 7-day returns/i);
  assert.match(cartView, /<GadzioTrustBar\s+items=\{trustBar\?\.items\}\s+enabled=\{trustBar\?\.enabled\}\s*\/>/);
  assert.doesNotMatch(cartView, /DEFAULT_TRUST_BADGES/);
  assert.match(cartPage, /readTrustBarContent/);
  assert.match(cartPage, /trustBar=\{trustBar\}/);
  assert.match(bagPage, /readTrustBarContent/);
  assert.match(bagPage, /trustBar=\{trustBar\}/);
});
