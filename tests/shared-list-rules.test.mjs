// Offline only: transpile the pure planner in an import-denying VM. No database/network/filesystem writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/catalog/shared-list-rules.ts');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module, exports: module.exports, TextEncoder,
  require(name) { throw new Error(`Unexpected offline import: ${name}`); },
}, { filename: file });
const { SharedListError, SHARED_IMPORT_MAX_BYTES, SHARED_IMPORT_MAX_ROWS, normalizeSharedName, parseSharedInput, planSharedImport, safeSharedCsv, sharedTemplate } = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const brand = (id = 'brand-a', name = 'Example Brand', isActive = true) => ({ id, name, isActive, sortOrder: 0 });
const model = (id, name, brandId = 'brand-a', isActive = true) => ({ id, name, brandId, isActive, sortOrder: 0 });
const colour = (id, name, hex, isActive = true) => ({ id, name, hex, isActive, sortOrder: 0 });
const snapshot = overrides => ({ brands: [brand()], models: [], colours: [], ...overrides });
const models = (text, options = {}, refs = snapshot()) => planSharedImport({ kind: 'models', format: 'paste', text, brandId: 'brand-a', ...options }, refs);
const colours = (text, options = {}, refs = snapshot()) => planSharedImport({ kind: 'colours', format: 'paste', text, ...options }, refs);
const bad = (run, pattern) => assert.throws(run, error => error instanceof SharedListError && error.status === 400 && pattern.test(error.message));

test('normalization pins NFKC, per-codepoint Unicode lowercase, then Unicode Letter/Number retention', () => {
  const vectors = [
    ['  ＭＯＤＥＬ—① + 𝟚 ', 'model12'], ['Café', 'café'], ['Café', 'café'],
    ['ÉCOLE', 'école'], ['中文 型号 ٣', '中文型号٣'], ['İ', 'i'],
    ['ΟΣ', 'οσ'], ['ΟΣΑ', 'οσα'], // Not whole-string final sigma folding (ΟΣ.toLowerCase() === ος).
    ['ẞ', 'ß'], ['Straße', 'straße'], ['STRAẞE', 'straße'], ['©-_😃', ''],
  ];
  for (const [input, expected] of vectors) assert.equal(normalizeSharedName(input), expected);
  assert.notEqual(normalizeSharedName('Straße'), normalizeSharedName('Strasse'));
  assert.notEqual(normalizeSharedName('Café'), normalizeSharedName('Cafe'));
});

test('input validation is strict, has safe status errors, and rejects lone surrogates', () => {
  const valid = { kind: 'models', format: 'paste', text: 'M', brandId: 'brand-a' };
  assert.deepEqual(plain(parseSharedInput(valid)), valid);
  for (const raw of [null, [], '', {}, { ...valid, kind: 'brands' }, { ...valid, format: 'json' },
    { ...valid, text: 1 }, { ...valid, extra: true }, { ...valid, brandId: '../bad' },
    { ...valid, brandId: null }, { ...valid, kind: 'colours' }, { ...valid, text: '\uD800' },
    { ...valid, text: '\uDC00' }, { ...valid, text: 'a\uD800b' }]) {
    assert.throws(() => parseSharedInput(raw), SharedListError);
  }
  assert.equal(parseSharedInput({ ...valid, text: '😀' }).text, '😀');
  assert.equal(new SharedListError('safe').status, 400);
  assert.equal(new SharedListError('safe', 409).name, 'SharedListError');
});

test('1 MB allowance counts UTF-8 BOM, header and CRLF, not UTF-16 length', () => {
  assert.equal(SHARED_IMPORT_MAX_BYTES, 1_000_000);
  const prefix = '﻿name,hex\r\n';
  const bytes = new TextEncoder().encode(prefix).length;
  const text = prefix + 'é'.repeat(Math.floor((SHARED_IMPORT_MAX_BYTES - bytes) / 2)) + 'x'.repeat((SHARED_IMPORT_MAX_BYTES - bytes) % 2);
  assert.equal(new TextEncoder().encode(text).length, SHARED_IMPORT_MAX_BYTES);
  assert.equal(parseSharedInput({ kind: 'colours', format: 'csv', text }).text, text);
  assert.throws(() => parseSharedInput({ kind: 'colours', format: 'csv', text: text + '\n' }),
    error => error instanceof SharedListError && error.status === 413);
  assert.throws(() => colours('é'.repeat(500001)), error => error.status === 413);
});

test('CSV accepts a BOM, arbitrary documented header order, quotes and escaped quotes', () => {
  const plan = models('﻿active,model,sort_order,brand\r\nfalse,"Fold, ""Edition""",9999,Example Brand\r\n', { format: 'csv' });
  assert.deepEqual(plain(plan.rows[0]), {
    row: 2, status: 'new', name: 'Fold, "Edition"', sortOrder: 9999, isActive: false,
    reason: 'New entry.', suggestions: [], brandId: 'brand-a',
  });
  assert.deepEqual(plain(plan.counts), { new: 1, existing: 0, near: 0, invalid: 0 });
  assert.equal(colours('hex,name\n#aBcDeF,Ocean\n', { format: 'csv' }).rows[0].hex, '#ABCDEF');
});

test('CSV syntax and header errors fail closed rather than guessing', () => {
  for (const text of ['', 'name\nA', 'name,hex,other\nA,#FFFFFF,x', 'name,hex,name',
    'Name,hex', 'name,hex,', '=name,hex', 'name,hex\n"open,#FFFFFF',
    'name,hex\nA"B,#FFFFFF', 'name,hex\n"A"x,#FFFFFF', 'name,hex\n "A",#FFFFFF']) {
    bad(() => colours(text, { format: 'csv' }), /header|quote|CSV/i);
  }
  assert.equal(colours(' name , hex \nA,#123456', { format: 'csv' }).rows[0].status, 'new');
  for (const text of ['name,hex\nA', 'name,hex\nA,#FFFFFF,extra', 'name,hex\n\n']) {
    assert.equal(colours(text, { format: 'csv' }).rows[0].status, 'invalid');
  }
});

test('quoted newlines parse as one CSV record and are invalid name controls, not extra rows', () => {
  const plan = colours('name,hex\n"First\nSecond",#123456\nThird,#654321', { format: 'csv' });
  assert.deepEqual(plain(plan.rows.map(row => [row.row, row.status])), [[2, 'invalid'], [3, 'new']]);
  assert.match(plan.rows[0].reason, /Control/);
});

test('2,000 data records permitted, 2,001 refused, headers excluded, blank paste lines ignored', () => {
  assert.equal(SHARED_IMPORT_MAX_ROWS, 2_000);
  const lines = Array.from({ length: SHARED_IMPORT_MAX_ROWS }, (_, index) => `Ref${String.fromCodePoint(0x4e00 + index)}`);
  assert.equal(models(lines.join('\n')).rows.length, SHARED_IMPORT_MAX_ROWS);
  assert.equal(models('\n\n' + lines.join('\r\n\r\n') + '\r\n').rows.length, SHARED_IMPORT_MAX_ROWS);
  bad(() => models([...lines, 'Extra'].join('\n')), /2,000/);
  const csv = 'brand,model\n' + lines.map(line => `Example Brand,${line}`).join('\n') + '\n';
  assert.equal(models(csv, { format: 'csv' }).rows.length, SHARED_IMPORT_MAX_ROWS);
  bad(() => models(csv + 'Example Brand,Extra', { format: 'csv' }), /2,000/);
  // A blank CSV record is still a data record, unlike a blank paste line.
  bad(() => models(csv + '\n', { format: 'csv' }), /2,000/);
});

test('paste uses physical line numbers, selected brands or explicit Brand,Model records', () => {
  assert.deepEqual(plain(models('\nOne\n\nTwo\n').rows.map(row => row.row)), [2, 4]);
  const plan = models('Example Brand,One\n"Example Brand","Two, Max"', { brandId: undefined });
  assert.deepEqual(plain(plan.rows.map(row => [row.name, row.brandId, row.status])),
    [['One', 'brand-a', 'new'], ['Two, Max', 'brand-a', 'new']]);
  assert.equal(models('Missing separator', { brandId: undefined }).rows[0].status, 'invalid');
  assert.equal(models('A,B,C', { brandId: undefined }).rows[0].status, 'invalid');
  assert.equal(models('"broken', { brandId: undefined }).rows[0].status, 'invalid');
  assert.equal(models('Model, With Comma').rows[0].name, 'Model, With Comma');
});

test('unknown, ambiguous and selected mismatched brands never create implicit brands', () => {
  const refs = snapshot(); const before = JSON.stringify(refs);
  const unknown = models('Unknown,One', { brandId: undefined }, refs).rows[0];
  assert.equal(unknown.status, 'invalid'); assert.match(unknown.reason, /unknown.*explicitly/);
  assert.equal(models('One', { brandId: 'missing' }, refs).rows[0].status, 'invalid');
  assert.equal(models('Example Brand,One', { format: 'csv', text: 'brand,model\nOther,One' },
    snapshot({ brands: [brand(), brand('other', 'Other')] })).rows[0].status, 'invalid');
  const ambiguous = models('Example Brand,One', { brandId: undefined }, snapshot({ brands: [brand(), brand('b', 'Example-Brand')] }));
  assert.match(ambiguous.rows[0].reason, /ambiguous/);
  assert.equal(JSON.stringify(refs), before);
});

test('inactive brands block new models but retain existing no-op rows', () => {
  const refs = snapshot({ brands: [brand('brand-a', 'Example Brand', false)], models: [model('one', 'One')] });
  const plan = models('One\nTwo', {}, refs);
  assert.equal(plan.rows[0].status, 'existing');
  assert.equal(plan.rows[1].status, 'invalid'); assert.match(plan.rows[1].reason, /active brand/);
});

test('optional sort and activity are bounded, explicit and defaulted', () => {
  for (const value of ['true', '1', 'YES', 'active', '']) {
    assert.equal(colours(`name,hex,active\nOcean,#123456,${value}`, { format: 'csv' }).rows[0].isActive, true);
  }
  for (const value of ['false', '0', 'NO', 'inactive']) {
    assert.equal(colours(`name,hex,active\nOcean,#123456,${value}`, { format: 'csv' }).rows[0].isActive, false);
  }
  for (const [order, active] of [['10000', 'true'], ['1.2', 'true'], ['x', 'true'], ['0', 'maybe']]) {
    assert.equal(colours(`name,hex,sort_order,active\nOcean,#123456,${order},${active}`, { format: 'csv' }).rows[0].status, 'invalid');
  }
  const row = colours('Ocean #123456').rows[0];
  assert.equal(row.sortOrder, 0); assert.equal(row.isActive, true);
});

test('reject formulas after all leading whitespace/control handling in every cell and format', () => {
  const dangerous = ['=SUM(1)', ' \t+cmd', '\u0001-1', '​@call', '＝1', '﻿=1'];
  for (const value of dangerous) {
    assert.equal(models(value).rows[0].status, 'invalid', JSON.stringify(value));
    assert.equal(colours(`${value} #123456`).rows[0].status, 'invalid', JSON.stringify(value));
  }
  for (const [header, cells] of [
    ['brand,model', ['=X', 'Normal']], ['brand,model', ['Example Brand', '\t@X']],
    ['name,hex', ['Ocean', ' =X']], ['name,hex,sort_order', ['Ocean', '#123456', '\u0001+1']],
    ['name,hex,active', ['Ocean', '#123456', ' -1']],
  ]) {
    // Construct cells directly; using the safe exporter would already neutralize them.
    const text = header + '\n' + cells.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',');
    const plan = header.startsWith('brand') ? models(text, { format: 'csv' }) : colours(text, { format: 'csv' });
    assert.equal(plan.rows[0].status, 'invalid'); assert.match(plan.rows[0].reason, /Formula/);
  }
});

test('names and hex are strictly validated without silently rewriting display names', () => {
  for (const line of ['Ocean #123', 'Ocean #GGGGGG', 'Ocean 123456', '#123456', '--- #123456',
    'A'.repeat(101) + ' #123456', 'Oc\u0000ean #123456', 'Oc​ean #123456']) {
    assert.equal(colours(line).rows[0].status, 'invalid', JSON.stringify(line));
  }
  assert.equal(models('A'.repeat(120)).rows[0].status, 'new');
  assert.equal(models('A'.repeat(121)).rows[0].status, 'invalid');
  assert.equal(colours('A'.repeat(100) + ' #aabbcc').rows[0].status, 'new');
  assert.equal(models('  Ｍodel-X  ').rows[0].name, 'Ｍodel-X');
});

test('existing normalized names include inactive entries, scoped by brand, and never update attributes', () => {
  const refs = snapshot({ models: [model('one', 'MODEL-X', 'brand-a', false), model('two', 'Other', 'brand-b')] });
  const before = JSON.stringify(refs);
  const row = models('brand,model,sort_order,active\nExample Brand,ｍodel x,9,true', { format: 'csv' }, refs).rows[0];
  assert.equal(row.status, 'existing'); assert.match(row.reason, /inactive/);
  assert.equal(models('Other', {}, refs).rows[0].status, 'new');
  const colourRow = colours('Ocean #aabbcc', {}, snapshot({ colours: [colour('c', 'OCEAN', '#AABBCC', false)] })).rows[0];
  assert.equal(colourRow.status, 'existing'); assert.match(colourRow.reason, /inactive/);
  assert.equal(JSON.stringify(refs), before);
});

test('input duplicates cannot result in a second insertion, even with different status/order', () => {
  const plan = models('brand,model,active,sort_order\nExample Brand,Model-X,true,1\nExample Brand,ｍodel x,false,2', { format: 'csv' });
  assert.deepEqual(plain(plan.rows.map(row => row.status)), ['new', 'invalid']);
  assert.match(plan.rows[1].reason, /record 2/);
  assert.deepEqual(plain(colours('Ocean #AABBCC\nOCEAN #aabbcc').counts), { new: 1, existing: 0, near: 0, invalid: 1 });
  const existing = models('One\nONE', {}, snapshot({ models: [model('one', 'One', 'brand-a', false)] }));
  assert.deepEqual(plain(existing.rows.map(row => row.status)), ['existing', 'invalid']);
});

test('colour name/hex conflicts against catalogue are invalid, never guessed matches', () => {
  const refs = snapshot({ colours: [colour('ocean', 'Ocean', '#123456', false), colour('sand', 'Sand', '#ABCDEF')] });
  for (const line of ['Ocean #654321', 'Different #123456', 'Ocean #ABCDEF']) {
    const row = colours(line, {}, refs).rows[0];
    assert.equal(row.status, 'invalid'); assert.match(row.reason, /conflict/);
  }
  const collision = colours('Ocean #123456', {}, snapshot({ colours: [colour('a', 'Ocean', '#123456'), colour('b', 'Ocean!', '#123456')] }));
  assert.equal(collision.rows[0].status, 'invalid'); assert.match(collision.rows[0].reason, /ambiguous/);
});

test('all conflicting input name/hex participants are invalid regardless of input order', () => {
  for (const lines of [
    ['Ocean #123456', 'OCEAN #654321'], ['Ocean #123456', 'Sand #123456'],
    ['Ocean #123456', 'Sand #123456', 'Ocean #ABCDEF'],
  ]) {
    for (const input of [lines, [...lines].reverse()]) {
      const plan = colours(input.join('\n'));
      assert.equal(plan.counts.invalid, lines.length); assert.equal(plan.counts.new, 0);
      assert.ok(plan.rows.every(row => /conflict/.test(row.reason)));
    }
  }
});

test('near matches include inactive entries, require acknowledgement, and never auto-correct', () => {
  const plan = models('Model X2', {}, snapshot({ models: [model('x1', 'Model X1', 'brand-a', false)] }));
  assert.equal(plan.rows[0].status, 'near'); assert.equal(plan.rows[0].name, 'Model X2');
  assert.deepEqual(plain(plan.rows[0].suggestions), ['Model X1']);
  assert.match(plan.rows[0].reason, /explicit acknowledgement/);
  assert.equal(models('Model X2', {}, snapshot({ models: [model('x1', 'Model X1', 'other')] })).rows[0].status, 'new');
  assert.equal(models('Model X1\nModel X2').rows[1].status, 'near');
  assert.equal(models('AB', {}, snapshot({ models: [model('a', 'AC')] })).rows[0].status, 'new');
});

test('near-match suggestions are deterministic, bounded to five, and exclude unrelated names', () => {
  const candidates = ['Model 0', 'Model 1', 'Model 2', 'Model 3', 'Model 4', 'Model 5', 'Model 6']
    .map((name, index) => model(`m${index}`, name));
  const first = models('Model 9', {}, snapshot({ models: candidates })).rows[0];
  const second = models('Model 9', {}, snapshot({ models: [...candidates].reverse() })).rows[0];
  assert.deepEqual(plain(first.suggestions), ['Model 0', 'Model 1', 'Model 2', 'Model 3', 'Model 4']);
  assert.deepEqual(plain(first.suggestions), plain(second.suggestions));
  assert.equal(models('Entirely unrelated', {}, snapshot({ models: candidates })).rows[0].status, 'new');
  const ranked = ['Model A00', 'Model X16', 'Model X15', 'Model X14', 'Model X13', 'Model X12', 'Model X11', 'Model X11', 'MODEL X11']
    .map((name, index) => model(`rank-${index}`, name));
  for (const order of [ranked, [...ranked].reverse()]) {
    assert.deepEqual(plain(models('Model X10', {}, snapshot({ models: order })).rows[0].suggestions),
      ['MODEL X11', 'Model X11', 'Model X12', 'Model X13', 'Model X14']);
  }
});

test('safe CSV neutralizes formulas, quotes cells, and templates contain headers only', () => {
  assert.equal(safeSharedCsv([['name', 'hex'], ['a,b', '"quoted"'], ['line\nnext', null]]),
    'name,hex\r\n"a,b","""quoted"""\r\n"line\nnext",\r\n');
  for (const value of ['=1', ' \t+2', '\u0001-3', '​@x', '＝1', '﻿=1']) {
    assert.equal(safeSharedCsv([[value]]), `'${value}\r\n`);
  }
  assert.equal(safeSharedCsv([[true, 12, undefined]]), 'true,12,\r\n');
  assert.equal(safeSharedCsv([]), '');
  assert.equal(sharedTemplate('models'), 'brand,model,sort_order,active\r\n');
  assert.equal(sharedTemplate('colours'), 'name,hex,sort_order,active\r\n');
  bad(() => sharedTemplate('brands'), /models or colours/);
  assert.equal(models(sharedTemplate('models'), { format: 'csv' }).rows.length, 0);
  assert.equal(colours(sharedTemplate('colours'), { format: 'csv' }).rows.length, 0);
});

test('same model name may be new for another brand and catalogue collisions fail closed', () => {
  const refs = snapshot({ brands: [brand(), brand('brand-b', 'Other Brand')], models: [model('a', 'Exact')] });
  const plan = models('brand,model\nExample Brand,Exact\nOther Brand,Exact', { format: 'csv', brandId: undefined }, refs);
  assert.deepEqual(plain(plan.rows.map(row => [row.brandId, row.status])), [['brand-a', 'existing'], ['brand-b', 'new']]);
  const duplicate = models('Exact', {}, snapshot({ models: [model('a', 'Exact'), model('b', 'ＥＸＡＣＴ', 'brand-a', false)] }));
  assert.equal(duplicate.rows[0].status, 'invalid'); assert.match(duplicate.rows[0].reason, /ambiguous/);
});

test('replanning after inserting valid new rows yields existing no-ops without changing the snapshot', () => {
  const input = { kind: 'colours', format: 'csv', text: 'name,hex,sort_order,active\nOcean,#abcdef,8,false' };
  const first = planSharedImport(input, snapshot());
  const created = first.rows.filter(row => row.status === 'new').map((row, index) => ({ ...row, id: `created-${index}` }));
  const refs = snapshot({ colours: created });
  const before = JSON.stringify(refs);
  const second = planSharedImport(input, refs);
  assert.deepEqual(plain(second.counts), { new: 0, existing: 1, near: 0, invalid: 0 });
  assert.match(second.rows[0].reason, /inactive/);
  assert.equal(JSON.stringify(refs), before);
});

test('planning is pure and repeatable, and counts include every preview row', () => {
  const refs = snapshot({ models: [model('existing', 'Existing')] });
  Object.freeze(refs); Object.freeze(refs.models); Object.freeze(refs.brands); Object.freeze(refs.colours);
  refs.models.forEach(Object.freeze); refs.brands.forEach(Object.freeze);
  const input = Object.freeze({ kind: 'models', format: 'paste', text: 'Existing\nBrandnew\nBrandnew2\n=bad', brandId: 'brand-a' });
  const a = planSharedImport(input, refs); const b = planSharedImport(input, refs);
  assert.deepEqual(plain(a), plain(b));
  assert.deepEqual(plain(a.counts), { new: 1, existing: 1, near: 1, invalid: 1 });
  assert.equal(Object.values(a.counts).reduce((sum, count) => sum + count, 0), a.rows.length);
});
