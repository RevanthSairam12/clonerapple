import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { module, exports: module.exports, require(name) { if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.tsx`)); return name === 'next/navigation' ? { useRouter: () => ({ refresh() {} }) } : require(name); } });
  return module.exports;
}
const references = { types: [{ id: 'case', categoryId: 'cases', name: 'Phone Case', requiresCompatibility: true, isActive: true, sortOrder: 0, attributes: [] }], brands: [{ id: 'device', name: 'Device Brand', isActive: false, sortOrder: 0 }], models: [{ id: 'phone', brandId: 'device', brandName: 'Device Brand', name: 'Phone', isActive: false, sortOrder: 0 }] };
const management = { references, mappings: [{ productTypeId: 'case', attributeId: 'material', label: 'Material', isActive: false, attributeActive: true, isRequired: false, sortOrder: 0, showInSpecs: true, showInFilters: false, showInSearch: false }], modelStatus: [{ id: 'phone', modelActive: true, brandActive: false }] };
const props = { references, management, categories: [{ id: 'cases', name: 'Cases' }], attributes: [], canEdit: false };
test('workspace separates tasks and keeps inactive panels mounted with accessible tabs', () => {
  const { CatalogueDataWorkspace } = load('src/components/store-admin/CatalogueDataWorkspace.tsx');
  const html = renderToStaticMarkup(React.createElement(CatalogueDataWorkspace, { types: 'type-panel', details: 'detail-panel', devices: 'device-panel', other: 'other-panel', starter: null, canEdit: false }));
  for (const label of ['Product types', 'Detail fields', 'Compatible devices', 'Other references']) assert.ok(html.includes(label));
  assert.match(html, /role="tablist"/); assert.match(html, /aria-selected="true"/);
  assert.match(html, /detail-panel/); assert.match(html, /hidden=""/); assert.match(html, /store owner/);
});
test('management shows inactive mappings without exposing owner mutations', () => {
  const { MetadataReferenceManager } = load('src/components/store-admin/MetadataReferenceManager.tsx');
  const html = renderToStaticMarkup(React.createElement(MetadataReferenceManager, { ...props, group: 'attributes' }));
  assert.match(html, /Phone Case \/ Material/); assert.match(html, />Inactive</);
  assert.doesNotMatch(html, />Save reference</); assert.doesNotMatch(html, />Edit</);
});
test('management explains parent-brand inactivity independently of model status', () => {
  const { MetadataReferenceManager } = load('src/components/store-admin/MetadataReferenceManager.tsx');
  const html = renderToStaticMarkup(React.createElement(MetadataReferenceManager, { ...props, group: 'models' }));
  assert.match(html, /Device brand is inactive/); assert.match(html, /Device Brand Phone/);
});
test('reference refresh does not broaden active-only product mapping eligibility', () => {
  const service = readFileSync('src/lib/store-admin/product-metadata.ts', 'utf8');
  assert.match(service, /where m\.is_active and a\.is_active/);
  assert.match(service, /export async function loadMetadataManagement/);
  const page = readFileSync('src/app/(store-admin)/store-admin/(protected)/catalog/page.tsx', 'utf8');
  assert.doesNotMatch(page, /seed-store-catalog/);
  assert.doesNotMatch(page, /conditionsResult\.ok \? conditionsResult\.data : \[\]/);
  assert.match(page, /conditions\.ok \? <ConditionManager/);
});
