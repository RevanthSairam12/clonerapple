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
  IMAGE_ROLES,
  isLowStock,
  slugify,
  validateAttributeInput,
  validateAttributeOption,
  validateAttributeValue,
  validateBrandInput,
  validateProductImageInput,
  validateProductPatch,
  validateUnitInput,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'catalog-rules.ts'),
);

/* ------------------------------------------------------------- products */

test('product patch accepts the editable fields', () => {
  const result = validateProductPatch({
    name: '  iPhone 16 Pro  ',
    subtitle: 'Titanium.',
    badge: '',
    brand_id: 'apple',
    is_active: true,
    in_stock: false,
    sort_order: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'iPhone 16 Pro');
  assert.equal(result.value.badge, null);
  assert.equal(result.value.brand_id, 'apple');
  assert.equal(result.value.is_active, true);
  assert.equal(result.value.in_stock, false);
  assert.equal(result.value.sort_order, 3);
});

test('product patch refuses every price-shaped key', () => {
  for (const key of ['price_paise', 'compare_at_paise', 'price', 'pricePaise', 'currency']) {
    const result = validateProductPatch({ [key]: 100 });
    assert.equal(result.ok, false, `${key} must be refused`);
    assert.match(result.error, /price cannot be edited/i);
  }
});

test('a price key is refused even when valid fields are present', () => {
  const result = validateProductPatch({ name: 'Fine', price_paise: 999 });
  assert.equal(result.ok, false);
  assert.match(result.error, /price cannot be edited/i);
});

test('product patch refuses unknown fields and an empty patch', () => {
  const unknown = validateProductPatch({ price_tier: 'high' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /not an editable product field/);

  const empty = validateProductPatch({});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /No fields/);

  const notObject = validateProductPatch(null);
  assert.equal(notObject.ok, false);
});

test('product patch enforces types and lengths', () => {
  assert.equal(validateProductPatch({ is_active: 'yes' }).ok, false);
  assert.equal(validateProductPatch({ sort_order: 1.5 }).ok, false);
  assert.equal(validateProductPatch({ sort_order: -1 }).ok, false);
  assert.equal(validateProductPatch({ name: '   ' }).ok, false);
  assert.equal(validateProductPatch({ name: 'x'.repeat(121) }).ok, false);
  assert.equal(validateProductPatch({ badge: 'x'.repeat(41) }).ok, false);
  assert.equal(validateProductPatch({ category_id: null }).ok, false);
  assert.equal(validateProductPatch({ brand_id: null }).ok, true);
});

/* --------------------------------------------------------------- images */

test('image input accepts a local path or an https URL', () => {
  const local = validateProductImageInput({
    url: '/sites/gadzio/products/iphone/hero.png',
    alt: 'iPhone front',
    role: 'primary',
    sort_order: 1,
  });
  assert.equal(local.ok, true);
  assert.equal(local.value.role, 'primary');

  const remote = validateProductImageInput({ url: 'https://cdn.example.com/a.png' });
  assert.equal(remote.ok, true);
  assert.equal(remote.value.role, 'gallery');
  assert.equal(remote.value.sort_order, 0);
});

test('image input refuses executable and protocol-relative URLs', () => {
  for (const url of ['javascript:alert(1)', '//evil.example.com/a.png', 'http://example.com/a.png', 'data:image/png;base64,xx']) {
    const result = validateProductImageInput({ url });
    assert.equal(result.ok, false, `${url} must be refused`);
  }
});

test('image input enforces role, alt and sort order', () => {
  assert.equal(validateProductImageInput({ url: '/a.png', role: 'hero' }).ok, false);
  assert.equal(validateProductImageInput({ url: '/a.png', alt: 'x'.repeat(201) }).ok, false);
  assert.equal(validateProductImageInput({ url: '/a.png', sort_order: -1 }).ok, false);
  assert.deepEqual([...IMAGE_ROLES], ['primary', 'hover', 'gallery']);
});

/* --------------------------------------------------------------- brands */

test('brand input derives an id and slug from the name', () => {
  const result = validateBrandInput({ name: 'Apple Inc.' });
  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'apple-inc');
  assert.equal(result.value.slug, 'apple-inc');
  assert.equal(result.value.is_active, true);
  assert.equal(result.value.logo_url, null);
});

test('brand input refuses unsafe ids and logos', () => {
  assert.equal(validateBrandInput({ name: 'Ok', id: 'Not Valid' }).ok, false);
  assert.equal(validateBrandInput({ name: 'Ok', logo_url: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateBrandInput({ name: '' }).ok, false);
  assert.equal(validateBrandInput({ name: 'x'.repeat(121) }).ok, false);
  assert.equal(validateBrandInput({ name: 'Ok', slug: 'Not Valid' }).ok, false);
});

test('slugify normalises punctuation and accents', () => {
  assert.equal(slugify('Apple Inc.'), 'apple-inc');
  assert.equal(slugify('  Beats® by Dre  '), 'beats-by-dre');
  assert.equal(slugify(''), '');
});

/* ---------------------------------------------------------------- units */

test('unit input normalises the code', () => {
  const result = validateUnitInput({ code: ' KG ', label: 'Kilogram', dimension: 'mass' });
  assert.equal(result.ok, true);
  assert.equal(result.value.code, 'kg');
  assert.equal(result.value.id, 'kg');
  assert.equal(result.value.factor, 1);
  assert.equal(result.value.base_code, null);
});

test('unit input refuses bad dimensions, codes and factors', () => {
  assert.equal(validateUnitInput({ code: 'kg', label: 'Kg', dimension: 'weight' }).ok, false);
  assert.equal(validateUnitInput({ code: 'k g', label: 'Kg', dimension: 'mass' }).ok, false);
  assert.equal(validateUnitInput({ code: 'kg', label: '', dimension: 'mass' }).ok, false);
  assert.equal(validateUnitInput({ code: 'kg', label: 'Kg', dimension: 'mass', factor: 0 }).ok, false);
  assert.equal(validateUnitInput({ code: 'kg', label: 'Kg', dimension: 'mass', factor: -2 }).ok, false);
});

/* ----------------------------------------------------------- attributes */

test('attribute input accepts the four data types', () => {
  for (const dataType of ['text', 'number', 'boolean', 'enum']) {
    const result = validateAttributeInput({
      key: 'screen_size',
      label: 'Screen size',
      data_type: dataType,
    });
    assert.equal(result.ok, true, dataType);
    assert.equal(result.value.data_type, dataType);
  }
});

test('attribute input only allows a unit on a number', () => {
  const withUnit = validateAttributeInput({
    key: 'weight',
    label: 'Weight',
    data_type: 'number',
    unit_id: 'g',
  });
  assert.equal(withUnit.ok, true);
  assert.equal(withUnit.value.unit_id, 'g');

  const textWithUnit = validateAttributeInput({
    key: 'finish',
    label: 'Finish',
    data_type: 'text',
    unit_id: 'g',
  });
  assert.equal(textWithUnit.ok, false);
});

test('attribute input refuses bad keys and flags', () => {
  assert.equal(validateAttributeInput({ key: 'Bad Key', label: 'x', data_type: 'text' }).ok, false);
  assert.equal(validateAttributeInput({ key: '_x', label: 'x', data_type: 'text' }).ok, false);
  assert.equal(validateAttributeInput({ key: 'x', label: 'x', data_type: 'date' }).ok, false);
  assert.equal(
    validateAttributeInput({ key: 'x', label: 'x', data_type: 'text', is_filterable: 'yes' }).ok,
    false,
  );
});

test('attribute values are shaped for the declared type', () => {
  const text = validateAttributeValue('text', { value: '  Titanium ' });
  assert.deepEqual(text, {
    ok: true,
    value: { value_text: 'Titanium', value_number: null, value_bool: null, option_value: null },
  });

  const number = validateAttributeValue('number', { value: '6.7' });
  assert.equal(number.ok, true);
  assert.equal(number.value.value_number, 6.7);

  const bool = validateAttributeValue('boolean', { value: true });
  assert.equal(bool.value.value_bool, true);

  const option = validateAttributeValue('enum', { value: 'Space Black' });
  assert.equal(option.value.option_value, 'Space Black');
});

test('attribute values are refused when they do not match the type', () => {
  assert.equal(validateAttributeValue('number', { value: 'heavy' }).ok, false);
  assert.equal(validateAttributeValue('boolean', { value: 'true' }).ok, false);
  assert.equal(validateAttributeValue('text', { value: '   ' }).ok, false);
  assert.equal(validateAttributeValue('text', { value: 'x'.repeat(201) }).ok, false);
});

test('attribute option must be a short non-empty string', () => {
  assert.equal(validateAttributeOption(' 128GB ').value, '128GB');
  assert.equal(validateAttributeOption('').ok, false);
  assert.equal(validateAttributeOption('x'.repeat(81)).ok, false);
});

/* ------------------------------------------------------------- low stock */

test('isLowStock compares available against the threshold', () => {
  assert.equal(isLowStock(10, 2, 5), false);
  assert.equal(isLowStock(10, 5, 5), true);
  assert.equal(isLowStock(0, 0, 0), true);
});
