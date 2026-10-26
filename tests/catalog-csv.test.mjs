import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  normalizeHeader,
  parseBoolean,
  parseCsv,
  parseImageUrls,
  parseInteger,
  parseMoneyToPaise,
  templateCsv,
  toCsv,
  validateImportRows,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'catalog-csv.ts'));

/* ------------------------------------------------------------------ parse */

test('a header and simple rows parse', () => {
  const parsed = parseCsv('name,category,price\nGaN Charger,Power,3499\n');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.header, ['name', 'category', 'price']);
  assert.deepEqual(parsed.rows, [['GaN Charger', 'Power', '3499']]);
});

test('quoted fields keep commas, newlines and doubled quotes', () => {
  const csv = 'name,category,price\r\n"Charger, 65W","Power",3499\r\n"Line ""one""\nline two",Power,10\r\n';
  const parsed = parseCsv(csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows[0][0], 'Charger, 65W');
  assert.equal(parsed.rows[1][0], 'Line "one"\nline two');
});

test('short rows are padded and long rows are refused', () => {
  const padded = parseCsv('name,category,price\nCharger,Power\n');
  assert.equal(padded.ok, true);
  assert.deepEqual(padded.rows[0], ['Charger', 'Power', '']);

  const long = parseCsv('name,category,price\nCharger,Power,10,extra\n');
  assert.equal(long.ok, false);
  assert.match(long.error, /more cells/);
});

test('the parser refuses empty files, bad quotes and missing columns', () => {
  assert.equal(parseCsv('').ok, false);
  assert.equal(parseCsv('   \n  ').ok, false);
  assert.equal(parseCsv('name,category\nCharger,Power\n').ok, false);
  assert.equal(parseCsv('name,category,price\n"open,Power,10\n').ok, false);
  assert.equal(parseCsv('name,category,price\nCha"rger,Power,10\n').ok, false);
});

test('a leading byte-order mark is ignored', () => {
  const parsed = parseCsv('﻿name,category,price\nCharger,Power,10\n');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.header, ['name', 'category', 'price']);
});

test('more than 5,000 data rows is refused', () => {
  const header = 'name,category,price';
  const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `P${index},Power,10`);
  const parsed = parseCsv([header, ...body].join('\n'));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /5000/);
});

test('headers normalise case, spaces and punctuation', () => {
  assert.equal(normalizeHeader(' Compare At Price '), 'compare_at_price');
  assert.equal(normalizeHeader('﻿Name'), 'name');
  assert.equal(normalizeHeader('__price__'), 'price');
});

/* ---------------------------------------------------------------- values */

test('money parses rupees and paise, and rejects nonsense', () => {
  assert.equal(parseMoneyToPaise('3499'), 349900);
  assert.equal(parseMoneyToPaise('3499.00'), 349900);
  assert.equal(parseMoneyToPaise('₹1,29,900.50'), 12990050);
  assert.equal(parseMoneyToPaise('12.345'), null);
  assert.equal(parseMoneyToPaise('-5'), null);
  assert.equal(parseMoneyToPaise('free'), null);
});

test('integers and booleans accept the usual spellings', () => {
  assert.equal(parseInteger(' 12 '), 12);
  assert.equal(parseInteger('1.5'), null);
  assert.equal(parseInteger('abc'), null);

  assert.equal(parseBoolean(''), true);
  assert.equal(parseBoolean('YES'), true);
  assert.equal(parseBoolean('0'), false);
  assert.equal(parseBoolean('inactive'), false);
  assert.equal(parseBoolean('maybe'), undefined);
});

test('image URLs split on pipes and cap at twelve', () => {
  assert.deepEqual(parseImageUrls('https://a.test/1.jpg|/api/media/2'), {
    urls: ['https://a.test/1.jpg', '/api/media/2'],
    error: null,
  });
  assert.equal(parseImageUrls('javascript:alert(1)').error !== null, true);
  assert.equal(
    parseImageUrls(Array.from({ length: 13 }, (_, i) => `https://a.test/${i}.jpg`).join('|')).error,
    'At most 12 image URLs are allowed.',
  );
});

/* ------------------------------------------------------------ validation */

const CONTEXT = {
  categories: [{ id: 'cat_power', slug: 'power', name: 'Power' }],
  brands: [{ id: 'brd_gadzio', name: 'Gadzio', slug: 'gadzio' }],
  conditions: [{ id: 'cond_new', label: 'New' }],
  existing: new Map(),
};

function row(values) {
  return IMPORT_COLUMNS.map((column) => (values[column] === undefined ? '' : String(values[column])));
}

function validate(rows, context = CONTEXT) {
  return validateImportRows([...IMPORT_COLUMNS], rows.map(row), context);
}

test('a valid row becomes a create with resolved references', () => {
  const { rows, errors } = validate([
    {
      name: 'GaN Charger 65W',
      category: 'Power',
      condition: 'New',
      brand: 'Gadzio',
      price: '₹3,499',
      compare_at_price: '3999',
      stock: '25',
      low_stock_threshold: '5',
      image_urls: 'https://a.test/front.jpg|https://a.test/side.jpg',
      is_active: 'true',
      seo_title: 'GaN Charger',
      seo_description: 'A compact 65W charger.',
    },
  ]);

  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  const [only] = rows;
  assert.equal(only.mode, 'create');
  assert.equal(only.productId, 'gan-charger-65w');
  assert.equal(only.slug, 'gan-charger-65w');
  assert.equal(only.categoryId, 'cat_power');
  assert.equal(only.brandId, 'brd_gadzio');
  assert.equal(only.conditionId, 'cond_new');
  assert.equal(only.pricePaise, 349900);
  assert.equal(only.compareAtPaise, 399900);
  assert.equal(only.stock, 25);
  assert.equal(only.lowStockThreshold, 5);
  assert.deepEqual(only.imageUrls, ['https://a.test/front.jpg', 'https://a.test/side.jpg']);
  assert.equal(only.isActive, true);
  assert.equal(only.rowNumber, 2);
});

test('product_id switches a row to update mode', () => {
  const context = {
    ...CONTEXT,
    existing: new Map([['prod_1', { slug: 'old-slug' }]]),
  };
  const { rows, errors } = validate(
    [
      {
        product_id: 'PROD_1',
        name: 'Renamed charger',
        slug: 'old-slug',
        category: 'power',
        price: '10',
      },
    ],
    context,
  );

  assert.deepEqual(errors, []);
  assert.equal(rows[0].mode, 'update');
  // The id wins even though the slug differs from the name.
  assert.equal(rows[0].productId, 'prod_1');
  assert.equal(rows[0].slug, 'old-slug');
});

test('unknown references are reported, not guessed', () => {
  const { rows, errors } = validate([
    { name: 'Mystery', category: 'Nope', condition: 'Broken', price: '10' },
  ]);
  assert.equal(rows.length, 0);
  const columns = errors.map((error) => error.column);
  assert.ok(columns.includes('category'));
  assert.ok(columns.includes('condition'));
  assert.ok(errors.every((error) => error.rowNumber === 2));
});

test('price, stock and SEO limits are enforced', () => {
  const { errors } = validate([
    {
      name: 'Bad',
      category: 'Power',
      price: '0',
      compare_at_price: '-1',
      stock: '-1',
      low_stock_threshold: 'lots',
      is_active: 'maybe',
      seo_title: 'x'.repeat(121),
    },
  ]);
  const columns = errors.map((error) => error.column);
  for (const column of ['price', 'compare_at_price', 'stock', 'low_stock_threshold', 'is_active', 'seo_title']) {
    assert.ok(columns.includes(column), `expected an error on ${column}`);
  }
});

test('the compare-at price cannot sit below the price', () => {
  const { errors } = validate([
    { name: 'Cheap', category: 'Power', price: '100', compare_at_price: '90' },
  ]);
  assert.equal(errors.some((error) => error.message.includes('below the price')), true);
});

test('duplicate ids and slugs inside one file are refused', () => {
  const { errors } = validate([
    { name: 'Charger', category: 'Power', price: '10', slug: 'charger' },
    { name: 'Charger again', category: 'Power', price: '10', slug: 'charger' },
  ]);
  assert.equal(errors.filter((error) => error.column === 'slug').length >= 1, true);
  assert.equal(errors.some((error) => error.rowNumber === 3), true);
});

test('creating a product whose slug already exists needs a product_id', () => {
  const context = { ...CONTEXT, existing: new Map([['charger', { slug: 'charger' }]]) };
  const { errors } = validate(
    [{ name: 'Charger', slug: 'charger', category: 'Power', price: '10' }],
    context,
  );
  assert.equal(errors.some((error) => error.message.includes('exists')), true);
});

/* ----------------------------------------------------------- serialising */

test('values with commas, quotes or newlines are escaped', () => {
  const csv = toCsv(['a', 'b'], [['plain', 'x,y'], ['quote"d', 'line\nbreak']]);
  assert.equal(csv, 'a,b\r\nplain,"x,y"\r\n"quote""d","line\nbreak"');
});

test('the template carries the header and one example row', () => {
  const csv = templateCsv();
  const [header, example] = csv.split('\r\n');
  assert.equal(header, IMPORT_COLUMNS.join(','));
  assert.equal((example.match(/,/g) ?? []).length >= IMPORT_COLUMNS.length - 1, true);
});
