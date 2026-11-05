/**
 * Phase 6 owner-facing evidence, checked offline.
 *
 * The one-page guide, its screenshots, the plain help vocabulary and the refusal
 * guards on the rehearsal script are all local files. None of these tests touch a
 * database, a browser or the network, so they run everywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guidePath = 'PRODUCTS_AND_CATALOG_SIMPLE_GUIDE.md';
const appendixPath = 'docs/advanced-products-and-catalog-guide.md';
const guide = readFileSync(guidePath, 'utf8');

function loadTsx(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText, { module, exports: module.exports, require, URL, console }, { filename: file });
  return module.exports;
}

test('the one-page guide exists with the required sections, in order', () => {
  for (const heading of [
    '# Add a product with models and colours',
    '## What you need first',
    '## 1. Put the models and colours in the shared lists',
    '### Models by CSV (owner)',
    '### Colours by paste (owner)',
    '## 2. Start the product',
    '## 3. Choose how you sell it',
    '## 4. Fill the table',
    '## 5. Give each colour its photos',
    '## 6. Publish and check as a customer',
    '## If something looks wrong',
    '## Advanced appendix',
  ]) {
    assert.ok(guide.includes(heading), `guide is missing "${heading}"`);
  }
  const order = [
    '## What you need first',
    '## 1. Put the models and colours in the shared lists',
    '## 2. Start the product',
    '## 3. Choose how you sell it',
    '## 4. Fill the table',
    '## 5. Give each colour its photos',
    '## 6. Publish and check as a customer',
  ].map(heading => guide.indexOf(heading));
  assert.deepEqual(order, [...order].sort((left, right) => left - right), 'sections are out of order');
  assert.ok(guide.split('\n').length < 170, 'the guide is meant to stay one readable page');
});

test('the guide walks through the CSV import a first-time owner can follow', () => {
  for (const step of [
    'Import, preview and downloads',
    'Download header-only template',
    'brand,model,sort_order,active',
    'UTF-8 CSV file',
    'Preview shared list',
    'New',
    'Already in the list',
    'Did you mean',
    'Confirm valid new rows',
    '2,000 data rows and 1 MB',
  ]) {
    assert.ok(guide.includes(step), `guide does not mention "${step}"`);
  }
});

test('the guide uses the plain option vocabulary and keeps the long guide as an appendix', () => {
  assert.ok(!/sub-item/i.test(guide), 'guide still says "sub-item"');
  for (const word of ['Sell by', 'By model and colour', 'Limit my stock', 'options']) {
    assert.ok(guide.toLowerCase().includes(word.toLowerCase()), `guide never says "${word}"`);
  }
  assert.ok(existsSync(appendixPath), 'the old long guide was not kept');
  const appendix = readFileSync(appendixPath, 'utf8');
  assert.ok(appendix.includes('advanced-products-and-catalog-guide') || appendix.length > 5_000);
  assert.ok(guide.includes('docs/advanced-products-and-catalog-guide.md'), 'guide does not link the appendix');
  assert.ok(/Screenshots use sample data\./.test(guide), 'guide does not say the screenshots are samples');
});

test('every screenshot the guide shows exists and is a real image', () => {
  const images = [...guide.matchAll(/!\[[^\]]*\]\(([^)]+\.png)\)/g)].map(match => match[1]);
  assert.ok(images.length >= 5, `expected at least 5 screenshots, found ${images.length}`);
  for (const image of images) {
    const file = path.resolve(image);
    assert.ok(existsSync(file), `screenshot is missing: ${image}`);
    assert.ok(statSync(file).size > 5_000, `screenshot looks empty: ${image}`);
  }
  const png = readFileSync(path.resolve(images[0]));
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47], 'first screenshot is not a PNG');
});

test('the screenshot script can only write under docs/images and names the five files', () => {
  const script = readFileSync('scripts/phase6-guide-screenshots.py', 'utf8');
  assert.ok(script.includes("root / 'docs' / 'images'"), 'script does not restrict output to docs/images');
  for (const name of ['01-options-table', '02-sell-by', '03-model-import', '04-colour-paste', '05-stock']) {
    assert.ok(script.includes(name), `script does not capture ${name}`);
  }
  assert.ok(!/set_input_files|upload/i.test(script), 'script must not upload anything');
});

test('the product help text uses plain words and never the old locked-price wording', () => {
  const { productHelpText } = loadTsx('src/components/store-admin/ProductHelp.tsx');
  const forbid = [/sub-item/i, /read-only/i, /remains locked/i, /price editing remains/i];
  for (const label of ['Sell by', 'SKU pattern', 'Sale price', 'Price ₹', 'options', 'Option type', 'Limit my stock', 'In stock', 'Paste prices and stock', 'Move existing stock']) {
    const text = productHelpText(label);
    assert.ok(text.length > 20, `help for "${label}" is too short to explain anything`);
    for (const pattern of forbid) {
      assert.doesNotMatch(text, pattern, `help for "${label}" still says ${pattern}`);
    }
  }
  assert.match(productHelpText('Sell by'), /saved options are never rewritten/i);
  assert.match(productHelpText('SKU pattern'), /A saved SKU never changes/i);
  assert.match(productHelpText('Paste prices and stock'), /Nothing is applied until every line reads correctly/i);
  assert.match(productHelpText('Price ₹'), /An option can have its own price and sale price/);
});

test('no store-admin component still uses the old sub-item wording', () => {
  const files = [
    'src/components/store-admin/ProductWorkflow.tsx',
    'src/components/store-admin/VariantEditor.tsx',
    'src/components/store-admin/ProductMetadataFields.tsx',
    'src/components/store-admin/ProductHelp.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/sub-item/i.test(source), `${file} still says "sub-item"`);
    assert.ok(!/prices? remain read-only/i.test(source), `${file} still claims option prices are read-only`);
  }
});

test('the rehearsal script refuses to touch a database without both approvals', () => {
  const base = { ...process.env };
  delete base.DATABASE_URL;
  delete base.REHEARSE_MIGRATIONS;
  delete base.REHEARSE_TARGET;

  // A loopback URL that nothing listens on: the guard must stop before any
  // connection attempt, and the messages say so.
  const fakeUrl = 'postgresql://user:pass@127.0.0.1:5432/example';

  const noApproval = spawnSync(process.execPath, ['scripts/rehearse-options-migrations.mjs'], {
    env: { ...base, DATABASE_URL: fakeUrl, REHEARSE_TARGET: '127.0.0.1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(noApproval.status, 2, 'script did not stop without REHEARSE_MIGRATIONS=yes');
  assert.match(noApproval.stderr, /set REHEARSE_MIGRATIONS=yes only after approving the exact target/);
  assert.match(noApproval.stderr, /Nothing was contacted\./);

  const wrongTarget = spawnSync(process.execPath, ['scripts/rehearse-options-migrations.mjs'], {
    env: { ...base, DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/example', REHEARSE_MIGRATIONS: 'yes', REHEARSE_TARGET: 'not-the-host' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(wrongTarget.status, 2, 'script did not stop when REHEARSE_TARGET did not match');
  assert.match(wrongTarget.stderr, /REHEARSE_TARGET must equal the approved host/);
  assert.doesNotMatch(wrongTarget.stderr, /user:pass/, 'script printed the connection string');
});

test('the rollout plan records the backup, order, smoke checks and rollback limits', () => {
  const plan = readFileSync('docs/phase6-rollout-plan-20261105.md', 'utf8');
  for (const section of ['What ships', 'Before the window', 'Maintenance window', 'Migration order', 'Smoke checks after deploy', 'Rollback limits', 'First-week watch list', 'What is not covered']) {
    assert.match(plan, new RegExp(`^#+ .*${section}`, 'im'), `rollout plan has no "${section}" section`);
  }
  for (const word of ['backup', 'restore', 'read-only']) {
    assert.ok(plan.toLowerCase().includes(word), `rollout plan never mentions "${word}"`);
  }
  assert.match(plan, /0058/);
  assert.match(plan, /0061/);
});
