import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { IMPORT_COLUMNS, EXPORT_COLUMNS, metadataCsvCells, parseCsv, templateCsv, toCsv, validateImportRows } =
  await jiti.import(path.join(root, 'src/lib/store-admin/catalog-csv.ts'));

const context = {
  categories: [{ id: 'cat_power', slug: 'power', name: 'Power' }],
  brands: [],
  conditions: [],
  existing: new Map([['charger', { slug: 'charger' }]]),
};

function validate(values = {}, update = false) {
  const data = { ...(update ? { product_id: 'charger' } : {}), name: update ? 'Charger' : 'New Charger', category: 'Power', price: '10', ...values };
  const header = Object.keys(data);
  return validateImportRows(header, [header.map(key => String(data[key]))], context);
}

function only(values, update = false) {
  const result = validate(values, update);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

test('old CSV columns preserve update metadata and activity; creates default to draft', () => {
  const update = only({}, true);
  assert.deepEqual(update.metadata, {});
  assert.equal(update.isActive, undefined);
  const create = only();
  assert.deepEqual(create.metadata, {});
  assert.equal(create.isActive, false);
  assert.equal(only({ is_active: '   ' }).isActive, false);
  assert.equal(only({ is_active: '' }, true).isActive, undefined);
  assert.equal(only({ is_active: 'true' }).isActive, true);
  assert.equal(only({ is_active: 'false' }, true).isActive, false);
});

test('metadata CSV uses stable IDs and preserves JSON primitives without coercion', () => {
  const metadata = {
    productTypeId: 'type_charger',
    deviceModelIds: ['device_iphone_17', 'device_ipad_air'],
    attributeValues: { attr_watts: 65, attr_fast: true, attr_label: '65 W, "GaN"\nUSB-C', attr_optional: null },
  };
  const cells = metadataCsvCells(metadata);
  const header = ['name', 'category', 'price', 'product_type_id', 'device_model_ids', 'attribute_values'];
  const parsed = parseCsv(toCsv(header, [['New Charger', 'Power', '10', ...cells]]));
  assert.equal(parsed.ok, true);
  const result = validateImportRows(parsed.header, parsed.rows, context);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[0].metadata, metadata);
});

test('literal null clears type, [] explicitly clears models, {} is an attribute no-op', () => {
  const row = only({ product_type_id: 'null', device_model_ids: '[]', attribute_values: '{}' }, true);
  assert.deepEqual(row.metadata, { productTypeId: null, deviceModelIds: [], attributeValues: {} });
  const archive = only({ attribute_values: '{"attr_watts":null}' }, true);
  assert.deepEqual(archive.metadata, { attributeValues: { attr_watts: null } });
});

test('omitting any metadata column preserves only that part of metadata', () => {
  assert.deepEqual(only({ device_model_ids: '["device_1"]' }, true).metadata, { deviceModelIds: ['device_1'] });
  assert.deepEqual(only({ product_type_id: 'type_charger' }, true).metadata, { productTypeId: 'type_charger' });
  assert.deepEqual(only({ attribute_values: '{}' }, true).metadata, { attributeValues: {} });
});

test('blank metadata cells cannot silently clear or preserve data', () => {
  for (const column of ['product_type_id', 'device_model_ids', 'attribute_values']) {
    for (const value of ['', '   ']) {
      const result = validate({ [column]: value }, true);
      assert.equal(result.rows.length, 0);
      assert.equal(result.errors[0].column, column);
      assert.equal(result.errors[0].rowNumber, 2);
      assert.match(result.errors[0].message, /omit the column/);
    }
  }
});

test('invalid JSON and incorrect metadata shapes produce actionable column errors', () => {
  const invalid = {
    product_type_id: ['bad type', '"type_charger"', '[]'],
    device_model_ids: ['not json', 'null', '{}', '[1]', '["device_1","device_1"]', '["bad id"]'],
    attribute_values: ['not json', 'null', '[]', '{"attr_watts":{}}', '{"attr_watts":[]}', '{"bad id":3}', '{"attr_watts":1e999}'],
  };
  for (const [column, values] of Object.entries(invalid)) {
    for (const value of values) {
      const result = validate({ [column]: value });
      assert.equal(result.rows.length, 0, `${column}: ${value}`);
      assert.equal(result.errors[0].column, column);
      assert.ok(result.errors[0].message.length > 0);
    }
  }
});

test('metadata limits are shared with the product metadata input parser', () => {
  const cases = [
    ['device_model_ids', JSON.stringify(Array.from({ length: 501 }, (_, index) => `device_${index}`))],
    ['attribute_values', JSON.stringify(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`attr_${index}`, index])))],
    ['attribute_values', JSON.stringify({ attr_label: 'x'.repeat(2001) })],
    ['product_type_id', 'x'.repeat(81)],
  ];
  for (const [column, value] of cases) {
    const result = validate({ [column]: value });
    assert.equal(result.rows.length, 0);
    assert.equal(result.errors[0].column, column);
  }
});

test('metadata export cells have explicit empty representations and no unrelated keys', () => {
  assert.deepEqual(metadataCsvCells({ productTypeId: null, deviceModelIds: [], attributeValues: {} }), ['null', '[]', '{}']);
  assert.deepEqual(EXPORT_COLUMNS.slice(-7), ['product_type_id', 'device_model_ids', 'attribute_values', 'short_description', 'description_sections', 'created_at', 'updated_at']);
});

test('template is a valid draft import with explicit empty metadata', () => {
  const parsed = parseCsv(templateCsv());
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.header, [...IMPORT_COLUMNS]);
  const result = validateImportRows(parsed.header, parsed.rows, { ...context, conditions: [{ id: 'new', label: 'New' }] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].isActive, false);
  assert.deepEqual(result.rows[0].metadata, { productTypeId: null, deviceModelIds: [], attributeValues: {} });
});

test('description CSV omissions and blanks preserve content, while null and [] are explicit', () => {
  for (const values of [{}, { short_description: '', description_sections: '  ' }]) {
    const row = only(values, true);
    assert.equal(row.shortDescription, undefined);
    assert.equal(row.descriptionSections, undefined);
  }
  const cleared = only({ short_description: 'null', description_sections: 'null' }, true);
  assert.equal(cleared.shortDescription, null);
  assert.equal(cleared.descriptionSections, null);
  assert.deepEqual(only({ description_sections: '[]' }, true).descriptionSections, []);
});

test('description sections survive CSV quoting in saved order with visibility and safe formatting', () => {
  const sections = [
    { id: 'faq', title: 'Questions, answered', hidden: true, type: 'faq', items: [] },
    { id: 'overview', title: 'Overview', hidden: false, type: 'text', blocks: [
      { type: 'paragraph', content: [
        { text: 'Safe "link"\ntext', bold: true, href: 'https://example.com/help' },
        { text: 'Unsafe', href: 'javascript:alert(1)', onclick: 'alert(1)' },
      ] },
    ] },
  ];
  const header = ['product_id', 'name', 'category', 'price', 'short_description', 'description_sections'];
  const parsed = parseCsv(toCsv(header, [['charger', 'Charger', 'Power', '10', 'Compact, "fast"\ncharger', JSON.stringify(sections)]]));
  assert.equal(parsed.ok, true);
  const result = validateImportRows(parsed.header, parsed.rows, context);
  assert.deepEqual(result.errors, []);
  const row = result.rows[0];
  assert.equal(row.shortDescription, 'Compact, "fast"\ncharger');
  assert.deepEqual(row.descriptionSections.map(section => [section.id, section.hidden]), [['faq', true], ['overview', false]]);
  assert.deepEqual(row.descriptionSections[1].blocks[0].content, [
    { text: 'Safe "link"\ntext', bold: true, href: 'https://example.com/help' },
    { text: 'Unsafe' },
  ]);
});

test('description CSV rejects malformed shapes and oversized summaries per column', () => {
  for (const value of ['{', '{}', '[null]', JSON.stringify([{ id: 'x', title: '', hidden: false, type: 'unsupported' }])]) {
    const result = validate({ description_sections: value }, true);
    assert.equal(result.rows.length, 0);
    assert.equal(result.errors[0].column, 'description_sections');
  }
  const result = validate({ short_description: 'x'.repeat(1001) }, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors[0].column, 'short_description');
});

test('duplicate normalized headers cannot hide a metadata or activation column', () => {
  for (const column of ['product_type_id', 'device_model_ids', 'attribute_values', 'is_active']) {
    const parsed = parseCsv(`name,category,price,${column},${column.toUpperCase()}\nCharger,Power,10,a,b`);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /duplicate/);
  }
});
