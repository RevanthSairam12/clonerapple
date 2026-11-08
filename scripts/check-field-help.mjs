/**
 * Verify that every Store Admin field descriptor, settings-list field,
 * website collection/theme field, and product field help entry carries
 * plain-language help text.
 *
 * Usage: node scripts/check-field-help.mjs
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  jsx: true,
  alias: { '@': path.join(ROOT, 'src') },
});

const { SETTING_FIELDS, SETTING_SECTIONS } = await jiti.import(
  path.join(ROOT, 'src', 'lib', 'store-admin', 'settings-rules.ts'),
);
const { LIST_KINDS } = await jiti.import(
  path.join(ROOT, 'src', 'lib', 'store-admin', 'setting-lists.ts'),
);
const { COLLECTIONS, THEME_FIELDS } = await jiti.import(
  path.join(ROOT, 'src', 'lib', 'website', 'collections.ts'),
);
const { productHelpText } = await jiti.import(
  path.join(ROOT, 'src', 'components', 'store-admin', 'ProductHelp.tsx'),
);

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

// 1. Store settings sections and fields
for (const section of SETTING_SECTIONS) {
  if (!section.description || section.description.trim().length < 10) {
    fail(`setting section "${section.key}" is missing a plain-language description.`);
  }
}

let settingFieldCount = 0;
for (const field of SETTING_FIELDS) {
  settingFieldCount += 1;
  const help = typeof field.help === 'string' ? field.help.trim() : '';
  if (help.length < 10) {
    fail(`store_settings field "${field.key}" (${field.label}) is missing help text.`);
  }
}
console.log(`OK: ${settingFieldCount} store_settings fields have help text.`);

// 2. Structured settings-list tables and fields
let listKindCount = 0;
let listFieldCount = 0;
for (const [kindKey, kind] of Object.entries(LIST_KINDS)) {
  listKindCount += 1;
  if (!kind.description || kind.description.trim().length < 10) {
    fail(`setting list "${kindKey}" is missing a description.`);
  }
  for (const field of kind.fields) {
    listFieldCount += 1;
    const help = typeof field.help === 'string' ? field.help.trim() : '';
    if (help.length < 10) {
      fail(`setting list "${kindKey}" field "${field.column}" (${field.label}) is missing help text.`);
    }
  }
}
console.log(`OK: ${listFieldCount} fields across ${listKindCount} settings lists have help text.`);

// 3. Website content collections and theme fields
let websiteFieldCount = 0;
for (const collection of COLLECTIONS) {
  for (const field of collection.fields) {
    websiteFieldCount += 1;
    const hint = typeof field.hint === 'string' ? field.hint.trim() : '';
    if (hint.length < 8) {
      fail(`website collection "${collection.key}" field "${field.path}" is missing hint text.`);
    }
  }
  for (const list of collection.lists ?? []) {
    for (const itemField of list.itemFields) {
      websiteFieldCount += 1;
      const hint = typeof itemField.hint === 'string' ? itemField.hint.trim() : '';
      if (hint.length < 8) {
        fail(
          `website collection "${collection.key}" list "${list.path}" item field "${itemField.path}" is missing hint text.`,
        );
      }
    }
  }
}
for (const field of THEME_FIELDS) {
  websiteFieldCount += 1;
  const hint = typeof field.hint === 'string' ? field.hint.trim() : '';
  if (hint.length < 8) {
    fail(`website theme field "${field.path}" is missing hint text.`);
  }
}
console.log(`OK: ${websiteFieldCount} Website content and theme fields have hint text.`);

// 4. Product editor field help coverage
const REQUIRED_PRODUCT_LABELS = [
  'Product name',
  'Category',
  'Brand',
  'Subtitle',
  'Sell by',
  'SKU pattern',
  'Price',
  'Sale price',
  'In stock',
  'Limit my stock',
  'Warn me when below',
  'Held in checkouts',
  'Available to buy',
  'Short description',
  'Alt text',
  'Compatible devices',
];
for (const label of REQUIRED_PRODUCT_LABELS) {
  const help = productHelpText(label);
  if (!help || help.trim().length < 15) {
    fail(`productHelpText("${label}") returned insufficient help text.`);
  }
}
console.log(`OK: ${REQUIRED_PRODUCT_LABELS.length} core product editor labels verified in ProductHelp.`);

if (failures > 0) {
  console.error(`\nField help check FAILED (${failures} issue(s)).`);
  process.exit(1);
}
console.log('\nAll admin field help checks passed.');
