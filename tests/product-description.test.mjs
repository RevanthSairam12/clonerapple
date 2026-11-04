import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') }, jsx: true });
const rules = await jiti.import('../src/lib/catalog/product-description.ts');
const { parseProductDescription, parseDescriptionSections, sanitizeDescriptionSections, sanitizeDescriptionUrl, convertLegacyProductDescription, createDescriptionSection, reorderDescriptionSections, DESCRIPTION_LIMITS } = rules;
const { ProductDescriptionSections } = await jiti.import('../src/components/shop/ProductDescriptionSections.tsx');
const { ProductDescriptionEditor } = await jiti.import('../src/components/store-admin/ProductDescriptionEditor.tsx');
const textSection = (overrides = {}) => ({ id: 'overview', title: 'Overview', hidden: false, type: 'text', blocks: [{ type: 'paragraph', content: [{ text: 'Useful detail' }] }], ...overrides });

test('all four section types and structured formatting round-trip without input mutation', () => {
  const sections = ['text', 'bullets', 'specs', 'faq'].map((type, i) => createDescriptionSection(type, `s${i}`));
  sections[0].blocks = [{ type: 'paragraph', content: [{ text: 'Hello', bold: true, italic: true, href: 'https://example.com' }] }, { type: 'list', ordered: true, items: [[{ text: 'First' }]] }];
  const input = { shortDescription: '', sections };
  const snapshot = JSON.stringify(input);
  assert.deepEqual(parseProductDescription(input), input);
  assert.equal(JSON.stringify(input), snapshot);
});
test('null means legacy fallback; explicit empty remains intentionally empty', () => {
  assert.deepEqual(parseProductDescription({ shortDescription: null, sections: null }), { shortDescription: null, sections: null });
  assert.deepEqual(convertLegacyProductDescription({ description: 'Old', sections: [] }), { shortDescription: null, sections: [] });
  assert.throws(() => parseProductDescription({}));
});
test('malformed shapes, IDs, flags and oversized collections reject instead of coercing', () => {
  for (const input of [{}, 'html', 1, [null], [textSection({ type: 'html' })], [textSection({ id: '../bad' })], [textSection(), textSection()], [textSection({ hidden: 'false' })], [textSection({ blocks: [{ type: 'html', html: '<b>bad</b>' }] })], Array.from({ length: 25 }, (_, i) => textSection({ id: `s${i}` }))]) assert.throws(() => parseDescriptionSections(input));
  assert.throws(() => parseProductDescription({ shortDescription: 'x'.repeat(1001), sections: [] }));
  assert.throws(() => parseDescriptionSections([textSection({ blocks: [{ type: 'paragraph', content: [{ text: 1 }] }] })]));
  assert.deepEqual(sanitizeDescriptionSections({ html: '<script>bad</script>' }), []);
});
test('per-node and aggregate bounds constrain input', () => {
  assert.throws(() => parseDescriptionSections([textSection({ title: 'x'.repeat(161) })]));
  assert.throws(() => parseDescriptionSections([textSection({ blocks: [{ type: 'paragraph', content: [{ text: 'x'.repeat(8001) }] }] })]));
  assert.throws(() => parseDescriptionSections([textSection({ blocks: [{ type: 'paragraph', content: Array.from({ length: 14 }, () => ({ text: 'x'.repeat(8000) })) }] })]));
  assert.throws(() => parseDescriptionSections([textSection({ blocks: Array.from({ length: DESCRIPTION_LIMITS.blocks + 1 }, () => ({ type: 'paragraph', content: [] })) })]));
});
test('protocol allowlist rejects executable, obfuscated, credential and protocol-relative targets', () => {
  for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,test', '//example.com', '/local', 'java\nscript:alert(1)', 'https://example.com\\@evil.com', 'https://user:pass@example.com', 'https://example.com/a b', 'mailto:', 'tel:', 'javascript&#58;alert(1)']) assert.equal(sanitizeDescriptionUrl(value), undefined, value);
  for (const value of ['https://example.com/a?q=1', 'http://example.com', 'mailto:shop@example.com', 'tel:+911234567890']) assert.equal(sanitizeDescriptionUrl(value), value);
});
test('sanitization drops unknown fields and unsafe links while preserving literal text and marks', () => {
  const result = parseDescriptionSections([textSection({ script: 'ignored', blocks: [{ type: 'paragraph', content: [{ text: '<img src=x onerror=alert(1)>\u0000', href: 'javascript:alert(1)', bold: true, onclick: 'bad' }] }] })]);
  assert.deepEqual(result[0].blocks[0].content, [{ text: '<img src=x onerror=alert(1)>', bold: true }]);
  assert.equal('script' in result[0], false);
});
test('legacy conversion is deterministic, idempotent and preserves factual fields only', () => {
  const input = { description: 'Legacy <b>text</b>', highlights: [{ title: 'Fast', desc: 'Measured' }], specs: [{ label: 'Weight', value: '10g' }], inTheBox: ['Cable'] };
  const snapshot = JSON.stringify(input);
  const result = convertLegacyProductDescription(input);
  assert.equal(result.shortDescription, null);
  assert.deepEqual(result.sections.map(section => section.id), ['legacy-overview', 'legacy-highlights', 'legacy-specs', 'legacy-box']);
  assert.deepEqual(convertLegacyProductDescription(result), result);
  assert.deepEqual(convertLegacyProductDescription(input), result);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(convertLegacyProductDescription({}), { shortDescription: null, sections: [] });
});
test('reordering preserves IDs, hidden content and the original array', () => {
  const sections = [textSection(), createDescriptionSection('faq', 'faq'), textSection({ id: 'hidden', hidden: true })];
  assert.deepEqual(reorderDescriptionSections(sections, 2, 0).map(section => section.id), ['hidden', 'overview', 'faq']);
  assert.equal(sections[0].id, 'overview');
  assert.deepEqual(reorderDescriptionSections(sections, -1, 1), sections);
  assert.deepEqual(reorderDescriptionSections(sections, 0, NaN), sections);
});
test('renderer escapes hostile strings, removes unsafe links and hidden sections, and renders valid semantics', () => {
  const sections = [textSection({ title: '<script>Title</script>', blocks: [{ type: 'paragraph', content: [{ text: '<img src=x onerror=alert(1)>', href: 'javascript:alert(1)' }, { text: 'Safe link', bold: true, italic: true, href: 'https://example.com' }] }, { type: 'list', ordered: true, items: [[{ text: 'Item' }]] }] }), textSection({ id: 'hidden', title: 'Secret heading', hidden: true }), { ...createDescriptionSection('specs', 'specs'), rows: [{ label: 'Weight', value: '10g' }] }, { ...createDescriptionSection('faq', 'faq'), items: [{ question: 'Fits?', answer: [{ type: 'paragraph', content: [{ text: 'Review model list.' }] }] }] }];
  const html = renderToStaticMarkup(React.createElement(ProductDescriptionSections, { sections }));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>') && !html.includes('<img') && !html.includes('javascript:') && !html.includes('Secret heading'));
  assert.ok(html.includes('rel="nofollow noopener noreferrer"'));
  for (const tag of ['<details', '<summary', '<strong>', '<em>', '<ol', '<dl', '<dt', '<dd', '<h3']) assert.ok(html.includes(tag), tag);
  assert.equal(renderToStaticMarkup(React.createElement(ProductDescriptionSections, { sections: [{ type: 'html' }] })), '');
});
test('controlled editor exposes formatting, starter, visibility and accessible reorder controls without saving', () => {
  const sections = ['text', 'bullets', 'specs', 'faq'].map((type, i) => createDescriptionSection(type, `s${i}`));
  const html = renderToStaticMarkup(React.createElement(ProductDescriptionEditor, { value: { shortDescription: '', sections }, onChange() {}, disabled: true }));
  for (const value of ['Short description', 'Add text section', 'Bold', 'Italic', 'Move up', 'Move down', 'Hide from storefront', 'Remove section', 'aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"', 'disabled=""']) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('contenteditable') && !html.includes('<form'));
});
test('migration is additive, nullable and contains no data writes or RLS side effects', async () => {
  const sql = await readFile(new URL('../migrations/0054_product_descriptions.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists short_description text/);
  assert.match(sql, /add column if not exists description_sections jsonb/);
  assert.doesNotMatch(sql, /\b(update|insert|delete|drop|default|not null|enable row level security)\b/i);
});
