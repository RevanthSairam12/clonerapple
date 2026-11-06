import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const option = await jiti.import(path.join(root, 'src/lib/storefront/option-selection.ts'));
const rules = await jiti.import(path.join(root, 'src/lib/storefront/availability-rules.ts'));
const { validateVariantInput } = await jiti.import(path.join(root, 'src/lib/store-admin/catalog-crud-rules.ts'));

/*
 * Colour identity comes only from `product_variant_colours`. These fixtures use
 * synthetic models and colours so nothing here depends on a real product name,
 * and every rule is exercised through the same functions the page uses.
 */

const colour = (id, name, hex) => ({ colourId: id, colourName: name, colourHex: hex });
const model = (id, name) => ({ deviceModelId: id, deviceModelName: name });
const row = (id, whichModel, whichColour, pricePaise, extra = {}) => ({
  id,
  sku: `SKU-${id}`,
  label: [whichModel?.deviceModelName, whichColour?.colourName].filter(Boolean).join(' / '),
  ...(whichModel ?? {}),
  ...(whichColour ?? {}),
  pricePaise,
  regularPricePaise: pricePaise,
  inStock: true,
  ...extra,
});

// Two models; the first carries two colours, the second one. A colour that no
// row carries is never offered for that model.
const C_RED = colour('c-red', 'Crimson', '#AA0000');
const C_NAVY = colour('c-navy', 'Navy', '#000080');
const M_A = model('m-a', 'Fixture A');
const M_B = model('m-b', 'Fixture B');
const CATALOGUE = [
  row('a-red', M_A, C_RED, 90000),
  row('a-navy', M_A, C_NAVY, 95000),
  row('b-red', M_B, C_RED, 180000),
];

test('every model offers only the colours its own rows actually carry', () => {
  const steps = option.optionSteps(CATALOGUE);
  assert.deepEqual(steps.models.map((entry) => entry.key), ['m-a', 'm-b']);
  assert.deepEqual(steps.models[0].colours.map((entry) => entry.label), ['Crimson', 'Navy']);
  // Fixture B has no Navy row, so Navy must never appear under it.
  assert.deepEqual(steps.models[1].colours.map((entry) => entry.label), ['Crimson']);
  assert.equal(steps.models.every((entry) => entry.selectable), true);
});

test('a model and colour selection resolves to the exact row, never a sibling', () => {
  for (const expected of CATALOGUE) {
    const found = option.resolveOptionVariant(CATALOGUE, {
      modelKey: expected.deviceModelId,
      colourKey: expected.colourId,
    });
    assert.equal(found?.id, expected.id, `${expected.id} must resolve to itself`);
  }
});

test('a selection that names no colour never silently becomes the first row', () => {
  // Two rows share model A and are distinguished only by their shared colour.
  const ambiguous = option.resolveOptionVariant(CATALOGUE, { modelKey: 'm-a', colourKey: null });
  assert.equal(ambiguous, undefined);
  // An unknown colour is a miss, not a hint.
  assert.equal(option.resolveOptionVariant(CATALOGUE, { modelKey: 'm-b', colourKey: 'c-navy' }), undefined);
});

test('rows with no colour link are unsellable as a group and never guessed', () => {
  const unlinked = [
    row('x-1', M_A, null, 1000),
    row('x-2', M_A, null, 2000),
  ];
  const steps = option.optionSteps(unlinked);
  assert.equal(steps.showModel, true);
  assert.equal(steps.showColour, false);
  assert.equal(steps.models[0].rowCount, 2);
  assert.equal(steps.models[0].selectable, false, 'two indistinguishable rows are not a choice');
  assert.equal(option.resolveOptionVariant(unlinked, { modelKey: 'm-a', colourKey: null }), undefined);
  // Selecting it is refused rather than recorded as an unresolvable selection.
  assert.deepEqual(option.selectModel(unlinked, { modelKey: null, colourKey: null }, 'm-a'), { modelKey: null, colourKey: null });
});

test('a single unlinked row is still an exact identity and stays sellable', () => {
  const single = [row('only', M_A, null, 1000)];
  assert.equal(option.optionSteps(single).models[0].selectable, true);
  assert.equal(option.resolveOptionVariant(single, { modelKey: 'm-a', colourKey: null })?.id, 'only');
});

test('products with no colour options at all still resolve on the step they have', () => {
  const modelOnly = [row('m1', M_A, null, 1000), row('m2', M_B, null, 2000)];
  const steps = option.optionSteps(modelOnly);
  assert.equal(steps.showModel, true);
  assert.equal(steps.showColour, false);
  assert.equal(option.resolveOptionVariant(modelOnly, { modelKey: 'm-b', colourKey: null })?.id, 'm2');

  // A colour-only product: no device model, colours carry the identity.
  const colourOnly = [row('c1', null, C_RED, 1000), row('c2', null, C_NAVY, 2000)];
  const colourSteps = option.optionSteps(colourOnly);
  assert.equal(colourSteps.showModel, false);
  assert.equal(colourSteps.showColour, true);
  assert.deepEqual(colourSteps.colours.map((entry) => entry.label), ['Crimson', 'Navy']);
  assert.equal(option.resolveOptionVariant(colourOnly, { modelKey: null, colourKey: 'c-navy' })?.id, 'c2');

  // A product with a single option row needs no step to be exact.
  const oneRow = [row('solo', null, null, 1000)];
  assert.equal(option.optionSteps(oneRow).showModel, false);
  assert.equal(option.resolveOptionVariant(oneRow, option.defaultOptionSelection(oneRow))?.id, 'solo');
});

test('two rows claiming the same model and colour are a duplicate relationship, not a pick', () => {
  const duplicate = [row('dup-1', M_A, C_RED, 1000), row('dup-2', M_A, C_RED, 2000)];
  assert.equal(option.resolveOptionVariant(duplicate, { modelKey: 'm-a', colourKey: 'c-red' }), undefined);
  // The colour step still shows one swatch for that identity.
  assert.deepEqual(option.optionSteps(duplicate).models[0].colours.map((entry) => entry.key), ['c-red']);
});

test('normal mode disables a sold-out row; sale mode leaves it selectable', () => {
  const soldOut = { ...CATALOGUE[0], inStock: false };
  assert.equal(option.optionStock(soldOut, false).blocked, true);
  assert.equal(option.optionStock(soldOut, false).selectable, false);
  assert.equal(option.optionStock(soldOut, true).blocked, false, 'sale mode never blocks presentation');
  assert.equal(option.optionStock(soldOut, true).selectable, true);
  // Presentation is not permission: the stock check still refuses the unit.
  assert.equal(rules.supportsQuantity({ id: 'p', inStock: false, tracked: true, available: 0, lowStockThreshold: null }, 1), false);
});

test('availability aggregation never counts an unlinked sibling as a different colour', () => {
  // Two colours of one model: one sold out, one available.
  const variants = [
    { id: 'p', variantId: 'a-red', inStock: false, tracked: true, available: 0, lowStockThreshold: null },
    { id: 'p', variantId: 'a-navy', inStock: true, tracked: true, available: 3, lowStockThreshold: null },
  ];
  const aggregate = rules.aggregateVariantAvailability('p', variants);
  assert.equal(aggregate.inStock, true, 'the product is buyable while one exact row has stock');
  assert.equal(aggregate.available, 3, 'only the option rows are counted');
  assert.equal(rules.supportsQuantity(variants[1], 3), true);
  assert.equal(rules.supportsQuantity(variants[1], 4), false);
});

test('the shared colour reference is the only colour input the variant form accepts', () => {
  const base = { optionName: 'Colour', optionValue: 'Anything', sku: 'SKU-1', combinationKey: 'key-1', isPurchasable: true, deviceModelId: null };
  assert.equal(validateVariantInput({ ...base, colourId: 'c-red' }).ok, true);
  assert.equal(validateVariantInput({ ...base, colourId: 'c-red' }).value.colourId, 'c-red');
  // Omitted means "leave the saved link alone".
  assert.equal('colourId' in validateVariantInput(base).value, false);
  // Empty means "no link", never a colour invented from the label.
  assert.equal(validateVariantInput({ ...base, colourId: '' }).value.colourId, null);
  assert.equal(validateVariantInput({ ...base, colourId: 'not a valid id' }).ok, false);
  assert.equal(validateVariantInput({ ...base, colourId: 42 }).ok, false);
});

function colourTx({ link = null, colourExists = true } = {}) {
  const events = [];
  const tx = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    events.push({ query, values });
    if (query.startsWith('select colour_id from product_variant_colours')) return link ? [{ colour_id: link }] : [];
    if (query.startsWith('select id from colours')) return colourExists ? [{ id: values[0] }] : [];
    return [];
  };
  return { tx, events };
}

test('saving an option attaches its first shared colour link inside the caller transaction', async () => {
  const crud = await jiti.import(path.join(root, 'src/lib/store-admin/variant-colour.ts'));
  const { tx, events } = colourTx();
  const result = await crud.saveVariantColourUsing(tx, 'product-1', 'variant-1', 'c-red');
  assert.equal(result, 'c-red');
  const insert = events.find((event) => event.query.startsWith('insert into product_variant_colours'));
  assert.ok(insert, 'the relationship must actually be written');
  assert.deepEqual(insert.values, ['variant-1', 'product-1', 'c-red']);
});

test('an already-saved link is reused and a different colour is refused, never rewritten', async () => {
  const crud = await jiti.import(path.join(root, 'src/lib/store-admin/variant-colour.ts'));
  const same = colourTx({ link: 'c-red' });
  assert.equal(await crud.saveVariantColourUsing(same.tx, 'product-1', 'variant-1', 'c-red'), 'c-red');
  assert.equal(same.events.some((event) => event.query.startsWith('insert')), false);

  const changed = colourTx({ link: 'c-red' });
  await assert.rejects(
    crud.saveVariantColourUsing(changed.tx, 'product-1', 'variant-1', 'c-navy'),
    /cannot be changed/,
    'links are append-only; the correction is archive and replace',
  );
  assert.equal(changed.events.some((event) => event.query.startsWith('insert')), false);
});

test('omitting a colour leaves the saved link untouched and an inactive colour is refused', async () => {
  const crud = await jiti.import(path.join(root, 'src/lib/store-admin/variant-colour.ts'));
  const omitted = colourTx({ link: 'c-red' });
  assert.equal(await crud.saveVariantColourUsing(omitted.tx, 'product-1', 'variant-1', undefined), null);
  assert.equal(await crud.saveVariantColourUsing(omitted.tx, 'product-1', 'variant-1', null), null);
  assert.equal(omitted.events.length, 0, 'no colour write without a colour');

  const missing = colourTx({ colourExists: false });
  await assert.rejects(crud.saveVariantColourUsing(missing.tx, 'product-1', 'variant-1', 'c-gone'), /active shared colour/);
});

test('the product draft carries the chosen colour through parsing, never a guess', async () => {
  const draftRules = await jiti.import(path.join(root, 'src/lib/store-admin/product-draft-rules.ts'));
  const product = { id: 'product-a', name: 'Fixture Case', slug: 'fixture-case', categoryId: 'cases', pricePaise: 10000 };
  const option = (extra) => ({ sku: 'SKU-1', optionName: 'Colour', optionValue: 'Crimson', combinationKey: 'key-1', optionIdentity: 'crimson', isPurchasable: true, isActive: false, ...extra });
  const linked = draftRules.parseProductDraft({ id: 'product-a', product, options: [option({ colourId: 'c-red' })] });
  assert.equal(linked.options[0].input.colourId, 'c-red', 'the chosen shared colour survives parsing');
  // No choice means no link from this save; the parser never invents one.
  const unlinked = draftRules.parseProductDraft({ id: 'product-a', product, options: [option({})] });
  assert.equal('colourId' in unlinked.options[0].input, false);
  assert.throws(
    () => draftRules.parseProductDraft({ id: 'product-a', product, options: [option({ colourId: 'not a valid id' })] }),
    /shared colour/,
  );
});

test('both admin save paths persist the link in the same transaction as the row', async () => {
  // The dedicated variant route.
  const source = await readFile(path.join(root, 'src/lib/store-admin/catalog-crud.ts'), 'utf8');
  const saved = source.indexOf('saveVariantIdentityUsing(tx,productId,input,staffId)');
  const linked = source.indexOf('await saveVariantColourUsing(tx, productId, saved.id, input.colourId)');
  assert.ok(saved > -1 && linked > saved, 'the link is attached after the row it points at exists');

  // The atomic product draft the admin screen actually saves through.
  const draft = await readFile(path.join(root, 'src/lib/store-admin/product-draft.ts'), 'utf8');
  const draftSaved = draft.indexOf('saveVariantIdentityUsing(tx,id,v,staffId,request)');
  const draftLinked = draft.indexOf('await saveVariantColourUsing(tx,id,saved.id,v.colourId)');
  assert.ok(draftSaved > -1 && draftLinked > draftSaved, 'the draft path must not drop the colour');
  // The admin read must surface the saved link rather than infer it from a hex.
  const admin = await readFile(path.join(root, 'src/lib/store-admin/catalog.ts'), 'utf8');
  assert.match(admin, /left join product_variant_colours pvc/);
  assert.match(admin, /colourId:row\.colour_id==null\?null/);
  const workflow = await readFile(path.join(root, 'src/components/store-admin/ProductWorkflow.tsx'), 'utf8');
  assert.match(workflow, /colourId: option\.colourId \?\? ''/);
  // The screen must actually submit the chosen link with the row it belongs to.
  assert.match(workflow, /\.\.\.\(option\.colourId \? \{ colourId: option\.colourId \} : \{\}\)/);
  assert.doesNotMatch(workflow, /option\.optionHex && colour\.hex/, 'hex never stands in for colour identity');
});
