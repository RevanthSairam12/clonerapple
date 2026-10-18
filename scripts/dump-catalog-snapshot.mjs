/**
 * Dump the runtime catalogue to ../catalog-snapshot.json (outside the repo).
 *
 * The seed and the verifier must agree on exactly what the store charges, so
 * this script loads the project's real data modules through the project's own
 * TypeScript compiler (typescript 5.9.3 is already a devDependency). It does
 * not re-parse the source with regular expressions.
 *
 * Only the twelve kept products (two per category) are exported. Education
 * Store products are deliberately excluded.
 *
 * Usage: node scripts/dump-catalog-snapshot.mjs
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT = path.resolve(ROOT, '..', 'catalog-snapshot.json');

/* ------------------------------------------------------- TypeScript loader */

const moduleCache = new Map();

function resolveModule(specifier, fromFile) {
  let base;
  if (path.isAbsolute(specifier)) {
    base = specifier;
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    base = path.resolve(ROOT, 'src', specifier.slice(2));
  } else {
    throw new Error(
      `Unsupported import "${specifier}" in ${path.relative(ROOT, fromFile)}.`,
    );
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Could not resolve "${specifier}" from ${path.relative(ROOT, fromFile)}.`,
  );
}

function loadModule(filePath) {
  const resolved = resolveModule(filePath, filePath);
  const cached = moduleCache.get(resolved);
  if (cached) return cached.exports;

  const source = readFileSync(resolved, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: resolved,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const module = { exports: {} };
  moduleCache.set(resolved, module);

  const localRequire = (specifier) =>
    loadModule(resolveModule(specifier, resolved));

  const fn = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    transpiled.outputText,
  );
  fn(module.exports, localRequire, module, resolved, path.dirname(resolved));

  return module.exports;
}

/* --------------------------------------------------------- source modules */

const dataDir = path.join(
  ROOT,
  'src/components/sites/accessories/data',
);
const types = loadModule(path.join(dataDir, 'types.ts'));

const ACCESSORY_MODULES = [
  'power-adapter-cable',
  'wired-earphones',
  'cable-plug-case',
  'airpods-case',
  'mobile-cases',
].map((name) => ({
  name,
  ...loadModule(path.join(dataDir, `${name}.ts`)),
}));

const casesModule = loadModule(
  path.join(ROOT, 'src/components/sites/cases-protection/data/products.ts'),
);

/* ------------------------------------------------------------ categories */

// CasesProtectionPage.tsx is a client component and does not export its
// config, so its category metadata is repeated here. Product records still
// come from the runtime module above.
const CASES_CATEGORY = {
  id: 'cases-protection',
  slug: 'cases-protection',
  name: 'Cases & Protection',
  title: 'iPhone Cases & Protection',
  subhead:
    'Explore premium Gadzio protective cases for iPhone with military-grade drop defense, liquid silicone, anti-yellowing crystal clear, and MagSafe compatibility.',
  breadcrumb_leaf: 'Cases & Protection',
  count_noun: 'cases',
  disclaimer:
    'iPhone, MagSafe, and Apple are trademarks of Apple Inc. Gadzio cases and accessories are independently engineered for device compatibility and are not affiliated with, sponsored, or endorsed by Apple Inc.',
  seo_title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
  seo_description:
    'Shop Gadzio protective cases for iPhone. Find MagSafe liquid silicone cases, crystal clear cases, and AeroWeave technical textile cases with military-grade drop defense.',
  nav_label: 'Cases & Protection',
  nav_href: '/in/shop/iphone/accessories/cases-protection',
  sort_order: 0,
  facet_defs: [
    {
      facet_key: 'model',
      label: 'Compatible With',
      options: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 17'],
      is_quick_pill: true,
      sort_order: 0,
    },
    {
      facet_key: 'material',
      label: 'Material',
      options: ['Liquid Silicone', 'Crystal Clear'],
      is_quick_pill: false,
      sort_order: 1,
    },
    {
      facet_key: 'brand',
      label: 'Brand',
      options: ['Gadzio Signature', 'Gadzio Pro'],
      is_quick_pill: false,
      sort_order: 2,
    },
  ],
};

const categories = [CASES_CATEGORY];

for (const mod of ACCESSORY_MODULES) {
  const config = mod.CONFIG;
  const navIndex = types.ACCESSORY_NAV.findIndex((n) => n.slug === config.slug);
  const nav = types.ACCESSORY_NAV[navIndex] ?? {
    slug: config.slug,
    label: config.title,
    href: `/in/shop/iphone/accessories/${config.slug}`,
  };

  categories.push({
    id: config.slug,
    slug: config.slug,
    name: mod.PRODUCTS[0]?.category ?? config.title,
    title: config.title,
    subhead: config.subhead,
    breadcrumb_leaf: config.breadcrumbLeaf,
    count_noun: config.countNoun,
    disclaimer: config.disclaimer,
    seo_title: config.seo.title,
    seo_description: config.seo.description,
    nav_label: nav.label,
    nav_href: nav.href,
    sort_order: navIndex >= 0 ? navIndex : categories.length,
    facet_defs: config.filters.map((facet, index) => ({
      facet_key: facet.id,
      label: facet.label,
      options: facet.options,
      is_quick_pill: config.quickPillFacet === facet.id,
      sort_order: index,
    })),
  });
}

/* -------------------------------------------------------------- products */

const CASE_SPEC_LABELS = {
  material: 'Material',
  weight: 'Weight',
  thickness: 'Thickness',
  magneticHold: 'Magnetic Hold',
  dropProtection: 'Drop Protection',
  warranty: 'Warranty',
};

function imageRows(product) {
  const urls =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images
      : [product.image];

  const rows = urls
    .filter(Boolean)
    .map((url, index) => ({
      url,
      alt: product.name,
      role: index === 0 ? 'primary' : 'gallery',
      sort_order: index,
    }));

  if (product.hoverImage) {
    rows.push({
      url: product.hoverImage,
      alt: `${product.name} — hover`,
      role: 'hover',
      sort_order: 0,
    });
  }
  return rows;
}

function caseFacets(product) {
  const facets = [];
  const seen = new Set();

  for (const model of product.compatibility ?? []) {
    const key = `model::${model}`;
    if (!seen.has(key)) {
      seen.add(key);
      facets.push({ facet_key: 'model', facet_value: model });
    }
  }
  for (const [key, value] of [
    ['material', product.material],
    ['brand', product.brand],
  ]) {
    if (value) {
      const seenKey = `${key}::${value}`;
      if (!seen.has(seenKey)) {
        seen.add(seenKey);
        facets.push({ facet_key: key, facet_value: value });
      }
    }
  }

  return facets.map((facet, index) => ({ ...facet, sort_order: index }));
}

function mapCaseProduct(product, index) {
  return {
    id: product.id,
    category_id: 'cases-protection',
    category_slug: 'cases-protection',
    slug: product.id,
    name: product.name,
    subtitle: product.subtitle ?? '',
    price_rupees: Number(product.price),
    price_paise: Math.round(Number(product.price) * 100),
    price_display: product.priceDisplay,
    currency: 'INR',
    material: product.material ?? '',
    brand: product.brand ?? '',
    description: product.description ?? '',
    badge: product.badge ?? null,
    highlights: product.highlights ?? [],
    in_the_box: product.inTheBox ?? [],
    images: imageRows(product),
    colors: product.colors ?? [],
    compatibility: product.compatibility ?? [],
    facets: caseFacets(product),
    specs: Object.entries(product.specs ?? {}).map(([key, value], specIndex) => ({
      label: CASE_SPEC_LABELS[key] ?? key,
      value: String(value),
      sort_order: specIndex,
    })),
    sort_order: index,
    in_stock: true,
    is_active: true,
  };
}

function mapAccessoryProduct(product, index) {
  return {
    id: product.id,
    category_id: product.categorySlug,
    category_slug: product.categorySlug,
    slug: product.id,
    name: product.name,
    subtitle: product.subtitle ?? '',
    price_rupees: Number(product.price),
    price_paise: Math.round(Number(product.price) * 100),
    price_display: product.priceDisplay,
    currency: 'INR',
    material: product.material ?? '',
    brand: product.brand ?? '',
    description: product.description ?? '',
    badge: product.badge ?? null,
    highlights: product.highlights ?? [],
    in_the_box: product.inTheBox ?? [],
    images: imageRows(product),
    colors: product.colors ?? [],
    compatibility: product.compatibility ?? [],
    facets: Object.entries(product.facets ?? {}).map(
      ([facetKey, facetValue], facetIndex) => ({
        facet_key: facetKey,
        facet_value: facetValue,
        sort_order: facetIndex,
      }),
    ),
    specs: (product.specs ?? []).map((spec, specIndex) => ({
      label: spec.label,
      value: spec.value,
      sort_order: specIndex,
    })),
    sort_order: index,
    in_stock: true,
    is_active: true,
  };
}

const products = [];

casesModule.PRODUCTS.forEach((product, index) => {
  products.push(mapCaseProduct(product, index));
});

for (const mod of ACCESSORY_MODULES) {
  mod.PRODUCTS.forEach((product, index) => {
    products.push(mapAccessoryProduct(product, index));
  });
}

/* ---------------------------------------------------------------- output */

const duplicateIds = products
  .map((product) => product.id)
  .filter((id, index, all) => all.indexOf(id) !== index);

if (duplicateIds.length > 0) {
  console.error(`Duplicate product ids: ${[...new Set(duplicateIds)].join(', ')}`);
  process.exit(1);
}

for (const product of products) {
  if (!Number.isFinite(product.price_paise) || product.price_paise <= 0) {
    console.error(`Invalid price for ${product.id}.`);
    process.exit(1);
  }
  if (!categories.some((category) => category.id === product.category_id)) {
    console.error(`Unknown category "${product.category_id}" for ${product.id}.`);
    process.exit(1);
  }
}

const snapshot = {
  generated_at: new Date().toISOString(),
  source: 'runtime TypeScript modules (typescript transpileModule)',
  categories,
  products,
};

writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

const byCategory = new Map();
for (const product of products) {
  byCategory.set(product.category_id, (byCategory.get(product.category_id) ?? 0) + 1);
}

console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
console.log(
  `Categories: ${categories.length}; products: ${products.length}; ` +
    `facets: ${products.reduce((n, p) => n + p.facets.length, 0)}; ` +
    `images: ${products.reduce((n, p) => n + p.images.length, 0)}; ` +
    `variants: ${products.reduce((n, p) => n + p.colors.length, 0)}.`,
);
for (const category of categories) {
  console.log(`  ${category.slug}: ${byCategory.get(category.id) ?? 0}`);
}
