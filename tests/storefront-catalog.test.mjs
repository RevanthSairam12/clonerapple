import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const {
  chooseCatalogSource,
  mergeFacets,
  mergeSpecRows,
  normaliseKey,
  stockStateFrom,
} = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'catalog-rules.ts'),
);
const {
  accessoryProductFromDatabase,
  caseProductFromDatabase,
  collectionProductFromDatabase,
  mergeAccessoryProduct,
  mergeCaseProduct,
  refFromDatabase,
} = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'catalog-merge.ts'),
);
const { CATALOG_CACHE_TAG, productCacheTag } = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'catalog-tags.ts'),
);
const {
  STATIC_PRODUCT_REFS,
  getStaticCaseProduct,
  getStaticCategoryConfig,
  getStaticProduct,
} = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'static-catalog.ts'),
);
const { normalizeProduct } = await jiti.import(
  path.join(root, 'src', 'components', 'collection', 'types.ts'),
);

/* --------------------------------------------------------------- fixtures */

function staticAccessory(overrides = {}) {
  return {
    id: 'pa-test',
    name: 'Static Adapter',
    subtitle: 'Static subtitle',
    price: 999,
    priceDisplay: '₹999.00',
    image: '/static/primary.jpg',
    images: ['/static/primary.jpg', '/static/second.jpg'],
    colors: [{ name: 'Black', hex: '#1d1d1f' }],
    compatibility: ['iPhone 17'],
    material: 'Silicone',
    brand: 'Gadzio',
    category: 'Power Adapter & Cable',
    categorySlug: 'power-adapter-cable',
    facets: { wattage: '20W', brand: 'Gadzio' },
    features: ['Static feature'],
    description: 'Static description',
    highlights: [{ title: 'Static feature', desc: 'Static highlight' }],
    specs: [
      { label: 'Material', value: 'Silicone' },
      { label: 'Warranty', value: '1-Year' },
    ],
    inTheBox: ['Static box'],
    href: '/shop/product/pa-test',
    ...overrides,
  };
}

function databaseProduct(overrides = {}) {
  return {
    id: 'pa-test',
    name: 'Database Adapter',
    subtitle: '',
    price: 1299,
    pricePaise: 129900,
    priceDisplay: '₹1,299.00',
    image: '/database/primary.jpg',
    gallery: ['/database/primary.jpg', '/database/second.jpg'],
    colors: [],
    compatibility: [],
    material: '',
    brand: '',
    description: '',
    highlights: [],
    features: [],
    specs: [{ label: 'material', value: 'TPU' }],
    inTheBox: [],
    inStock: true,
    categoryName: 'Power Adapter & Cable',
    categorySlug: 'power-adapter-cable',
    facets: { wattage: '35W' },
    href: '/shop/product/pa-test',
    ...overrides,
  };
}

function staticCase(overrides = {}) {
  return {
    id: 'case-test',
    name: 'Static Case',
    subtitle: 'Clear',
    price: 3499,
    priceDisplay: '₹3,499.00',
    image: '/static/case.jpg',
    colors: [{ name: 'Diamond Clear', hex: '#e8e8ed' }],
    compatibility: ['iPhone 18 Pro Max'],
    material: 'Crystal Clear',
    brand: 'Gadzio Pro',
    features: ['Static case feature'],
    description: 'Static case description',
    highlights: [{ title: 'Static case feature', desc: 'Static case highlight' }],
    specs: {
      material: 'Static polycarbonate',
      weight: '32g',
      thickness: '1.5mm',
      magneticHold: '1,150g Hold Force',
      dropProtection: '10ft',
      warranty: '1-Year',
    },
    inTheBox: ['Static case box'],
    href: '/shop/product/case-test',
    ...overrides,
  };
}

/* --------------------------------------------------------- DB wins, static fills */

test('database values win and static fields fill the gaps', () => {
  const merged = mergeAccessoryProduct(staticAccessory(), databaseProduct());

  assert.equal(merged.name, 'Database Adapter');
  assert.equal(merged.subtitle, 'Static subtitle');
  assert.equal(merged.price, 1299);
  assert.equal(merged.priceDisplay, '₹1,299.00');
  assert.equal(merged.image, '/database/primary.jpg');
  assert.deepEqual(merged.images, ['/database/primary.jpg', '/database/second.jpg']);
  assert.deepEqual(merged.colors, staticAccessory().colors);
  assert.deepEqual(merged.compatibility, []);
  assert.equal(merged.material, '');
  assert.equal(merged.brand, 'Gadzio');
  assert.equal(merged.description, 'Static description');
  assert.deepEqual(merged.features, ['Static feature']);
  assert.deepEqual(merged.inTheBox, ['Static box']);

  // Managed data is authoritative, including empty lists; no static refill.
  assert.deepEqual(merged.specs, [{ label: 'material', value: 'TPU' }]);
  assert.deepEqual(merged.facets, { wattage: '35W' });
});

test('case specs project normalised labels without static-only rows', () => {
  const merged = mergeCaseProduct(
    staticCase(),
    databaseProduct({
      id: 'case-test',
      name: 'DB Case',
      pricePaise: 350900,
      priceDisplay: '₹3,509.00',
      specs: [
        { label: 'Material', value: 'Database polycarbonate' },
        { label: 'Drop Protection', value: 'MIL-STD' },
      ],
    }),
  );

  assert.equal(merged.name, 'DB Case');
  assert.equal(merged.price, 3509);
  assert.equal(merged.priceDisplay, '₹3,509.00');
  assert.equal(merged.specs.material, 'Database polycarbonate');
  assert.equal(merged.specs.dropProtection, 'MIL-STD');
  assert.equal(merged.specs.weight, '');
  assert.equal(merged.specs.warranty, '');
});

test('a database-only product renders without a static record', () => {
  const accessory = accessoryProductFromDatabase(
    databaseProduct({ id: 'new-product', name: 'New Product', pricePaise: 50000 }),
  );
  assert.equal(accessory.id, 'new-product');
  assert.equal(accessory.price, 500);

  const kase = caseProductFromDatabase(
    databaseProduct({ id: 'new-case', name: 'New Case', pricePaise: 70000 }),
  );
  assert.equal(kase.id, 'new-case');
  assert.equal(kase.price, 700);

  const card = collectionProductFromDatabase(
    databaseProduct({ id: 'new-product', name: 'New Product', pricePaise: 50000 }),
  );
  assert.equal(card.id, 'new-product');
  assert.equal(card.inStock, true);
});

/* --------------------------------------------------------------- fallback */

test('an unreachable database falls back to static data', () => {
  const fallback = { id: 'static' };
  assert.deepEqual(chooseCatalogSource(false, null, fallback), {
    source: 'static',
    value: fallback,
  });
  assert.deepEqual(chooseCatalogSource(false, { id: 'db' }, fallback), {
    source: 'static',
    value: fallback,
  });
});

test('a reachable database that lacks the row is a 404, not a stale static product', () => {
  assert.deepEqual(chooseCatalogSource(true, null, { id: 'static' }), {
    source: 'missing',
    value: null,
  });
  assert.deepEqual(chooseCatalogSource(true, { id: 'db' }, { id: 'static' }), {
    source: 'db',
    value: { id: 'db' },
  });
});

test('the static bundle covers every product in the registry', () => {
  assert.equal(STATIC_PRODUCT_REFS.length, 12);
  const ids = new Set(STATIC_PRODUCT_REFS.map((ref) => ref.id));
  assert.equal(ids.size, STATIC_PRODUCT_REFS.length);
  for (const ref of STATIC_PRODUCT_REFS) {
    assert.ok(ref.name);
    assert.ok(Number.isInteger(ref.pricePaise) && ref.pricePaise > 0);
    assert.equal(ref.inStock, true);
    assert.equal('cost' in ref, false);
  }
  for (const slug of [
    'cases-protection',
    'power-adapter-cable',
    'wired-earphones',
    'cable-plug-case',
    'airpods-case',
    'mobile-cases',
  ]) {
    assert.ok(getStaticCategoryConfig(slug), slug);
  }
  assert.equal(getStaticProduct('iphone17-silicone-black')?.kind, 'case');
  assert.equal(getStaticProduct('ac-gadzio-silicone-pro3')?.kind, 'accessory');
  assert.ok(getStaticCaseProduct('IPHONE17-SILICONE-BLACK'));
});

test('archived and inactive products are excluded by the read query', async () => {
  const source = await readFile(
    path.join(root, 'src', 'lib', 'catalog', 'storefront.ts'),
    'utf8',
  );
  assert.match(source, /p\.deleted_at is null/);
  assert.match(source, /p\.is_active/);
  assert.match(source, /c\.is_active/);
});

/* ------------------------------------------------------------------ stock */

test('stock state uses available units and the low-stock threshold', () => {
  const tracked = (onHand, reserved, threshold, inStock = true) =>
    stockStateFrom(
      {
        on_hand: onHand,
        reserved,
        low_stock_threshold: threshold,
        track_inventory: true,
      },
      inStock,
    );

  assert.deepEqual(tracked(10, 2, 5), {
    state: 'in_stock',
    available: 8,
    threshold: 5,
    tracked: true,
  });
  assert.equal(tracked(6, 1, 5).state, 'low_stock'); // available 5 == threshold
  assert.equal(tracked(5, 1, 5).state, 'low_stock'); // available 4 < threshold
  assert.equal(tracked(2, 2, 5).state, 'out_of_stock');
  assert.equal(tracked(10, 0, 5, false).state, 'out_of_stock');
});

test('untracked stock follows the products.in_stock gate', () => {
  assert.equal(
    stockStateFrom(
      { on_hand: 0, reserved: 0, low_stock_threshold: 1, track_inventory: false },
      true,
    ).state,
    'in_stock',
  );
  assert.equal(stockStateFrom(null, false).state, 'out_of_stock');
  assert.equal(stockStateFrom(null, true).available, null);
});

test('an out-of-stock accessory reaches the existing Sold Out card state', () => {
  const available = mergeAccessoryProduct(staticAccessory(), databaseProduct());
  const soldOut = mergeAccessoryProduct(
    staticAccessory(),
    databaseProduct({ inStock: false }),
  );

  assert.equal(available.inStock, true);
  assert.equal(soldOut.inStock, false);
  assert.equal(normalizeProduct(soldOut).inStock, false);
  assert.equal(
    collectionProductFromDatabase(databaseProduct({ inStock: false })).inStock,
    false,
  );
  assert.equal(
    accessoryProductFromDatabase(databaseProduct({ inStock: false })).inStock,
    false,
  );

  // A static product still has no stock opinion, so it stays addable.
  assert.equal(normalizeProduct(staticAccessory()).inStock, true);
});

/* ------------------------------------------------------- reviews / payload */

test('no storefront read pulls review or internal commerce data', async () => {
  for (const file of [
    path.join(root, 'src', 'lib', 'catalog', 'storefront.ts'),
    path.join(root, 'src', 'lib', 'storefront', 'catalog.ts'),
    path.join(root, 'src', 'lib', 'storefront', 'catalog-merge.ts'),
  ]) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /product_reviews/i, file);
    assert.doesNotMatch(source, /cost_paise/i, file);
    assert.doesNotMatch(source, /internal_notes/i, file);
    assert.doesNotMatch(source, /select\s+\*/i, file);
  }
});

test('search/bag rows carry only public display fields', () => {
  const ref = refFromDatabase(databaseProduct(), 'Power Adapter & Cable');
  assert.deepEqual(Object.keys(ref).sort(), [
    'categoryName',
    'categorySlug',
    'id',
    'image',
    'inStock',
    'inventoryMode',
    'keywords',
    'name',
    'priceDisplay',
    'pricePaise',
    'purchasableVariants',
    'subtitle',
  ]);
  assert.equal(ref.inventoryMode, 'product');
  assert.deepEqual(ref.purchasableVariants, []);
  assert.doesNotMatch(JSON.stringify(ref), /on_hand|reserved|cost_paise|internal_notes/);
  assert.equal(ref.pricePaise, 129900);
  assert.equal(ref.priceDisplay, '₹1,299.00');
  assert.match(ref.keywords.join(' '), /database adapter/);
});

/* -------------------------------------------------------------- cache tags */

test('the catalogue cache is a 30-second safety net that never holds the sale switch', async () => {
  const source = await readFile(
    path.join(root, 'src', 'lib', 'storefront', 'catalog.ts'),
    'utf8',
  );
  assert.match(source, /unstable_cache\(/);
  assert.match(source, /revalidate:\s*30/);
  // The cached rows are regular-priced; the switch is read per request and
  // applied with applySaleDisplay(), so a sale boundary is exact.
  assert.match(source, /const getSaleState = cache\(async \(\) => readSaleState\(\)\)/);
  assert.match(source, /applySaleDisplay\(/);
});

test('catalogue tags are stable and case-insensitive per product', () => {
  assert.equal(CATALOG_CACHE_TAG, 'storefront-catalog');
  assert.equal(productCacheTag('  ABC-1 '), 'storefront-product:abc-1');
  assert.equal(productCacheTag('abc-1'), productCacheTag(' ABC-1 '));
});

test('every catalogue-changing store-admin write revalidates the catalogue', async () => {
  const files = [
    'src/app/api/store-admin/catalog/products/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/price/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/variants/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/variants/[variantId]/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/images/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/images/[imageId]/route.ts',
    'src/app/api/store-admin/catalog/products/[id]/attributes/route.ts',
    'src/app/api/store-admin/catalog/categories/route.ts',
    'src/app/api/store-admin/catalog/categories/[id]/route.ts',
    'src/app/api/store-admin/catalog/import/route.ts',
    'src/app/api/store-admin/stock/[productId]/route.ts',
    'src/app/api/store-admin/stock/[productId]/adjust/route.ts',
    'src/app/api/store-admin/reviews/[id]/route.ts',
    'src/app/api/store-admin/pos/sales/route.ts',
    'src/app/api/store-admin/orders/[txnid]/cancel/route.ts',
    'src/app/api/store-admin/orders/[txnid]/void/route.ts',
    'src/app/api/store-admin/returns/[id]/route.ts',
  ];

  for (const relative of files) {
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.match(source, /revalidateCatalog\s*\(/, relative);
  }

  const helper = await readFile(
    path.join(root, 'src', 'lib', 'storefront', 'revalidate.ts'),
    'utf8',
  );
  assert.match(helper, /CATALOG_CACHE_TAG/);
  assert.match(helper, /productCacheTag/);
  assert.match(helper, /expire:\s*0/);
});

/* ------------------------------------------------ display price == charged */

test('the displayed price is the same price_paise checkout resolves', async () => {
  const db = databaseProduct({ pricePaise: 129900 });
  const ref = refFromDatabase(db);
  const merged = mergeAccessoryProduct(staticAccessory(), db);

  assert.equal(ref.pricePaise, 129900);
  assert.equal(merged.price, 1299);
  assert.equal(merged.priceDisplay, ref.priceDisplay);

  const checkout = await readFile(
    path.join(root, 'src', 'lib', 'payu', 'db-catalog.ts'),
    'utf8',
  );
  assert.match(checkout, /select p\.id, p\.name, p\.subtitle, p\.price_paise/);
  assert.match(checkout, /price_paise/);

  const reader = await readFile(
    path.join(root, 'src', 'lib', 'catalog', 'storefront.ts'),
    'utf8',
  );
  assert.match(reader, /p\.price_paise/);
});

/* ---------------------------------------------------------- pure helpers */

test('spec and facet merge helpers ignore blanks', () => {
  assert.equal(normaliseKey('Drop Protection'), 'dropprotection');
  assert.deepEqual(
    mergeSpecRows(
      [{ label: 'Material', value: 'Static' }],
      [{ label: 'material', value: '  ' }, { label: 'Weight', value: '30g' }],
    ),
    [
      { label: 'Material', value: 'Static' },
      { label: 'Weight', value: '30g' },
    ],
  );
  assert.deepEqual(
    mergeFacets({ wattage: '20W', brand: 'Gadzio' }, { wattage: '35W', brand: ' ' }),
    { wattage: '35W', brand: 'Gadzio' },
  );
});
