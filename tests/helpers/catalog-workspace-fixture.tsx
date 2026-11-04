// Test-only composition. All values and responses are synthetic; never imported by the app.
import React, { useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { CatalogueDataWorkspace } from '@/components/store-admin/CatalogueDataWorkspace';
import { MetadataReferenceManager } from '@/components/store-admin/MetadataReferenceManager';
import { CatalogStarterSetup } from '@/components/store-admin/CatalogStarterSetup';
import { ProductWorkflow } from '@/components/store-admin/ProductWorkflow';
import { CATALOG_STARTER_TEMPLATES } from '@/lib/catalog/catalog-starter-rules';
import type { MetadataReferences } from '@/lib/catalog/product-metadata-rules';

const categories = [{ id: 'fixture-cases', name: 'Fixture cases', slug: 'cases-protection', isActive: true }, { id: 'fixture-power', name: 'Fixture power', slug: 'power-adapter-cable', isActive: true }];
const field = { attributeId: 'fixture-material', key: 'material', label: 'Fixture material', dataType: 'text', options: [], isRequired: false, sortOrder: 0, showInSpecs: true, showInFilters: false, showInSearch: false };
const references: MetadataReferences = {
  types: [{ id: 'fixture-case', categoryId: 'fixture-cases', name: 'Fixture case', requiresCompatibility: true, isActive: true, sortOrder: 0, attributes: [field] }, { id: 'fixture-old', categoryId: 'fixture-cases', name: 'Fixture retired type', requiresCompatibility: false, isActive: false, sortOrder: 1, attributes: [] }],
  brands: [{ id: 'fixture-device', name: 'Fixture devices', isActive: true, sortOrder: 0 }, { id: 'fixture-retired-brand', name: 'Fixture retired devices', isActive: false, sortOrder: 1 }],
  models: [{ id: 'fixture-phone', brandId: 'fixture-device', brandName: 'Fixture devices', name: 'Phone A', isActive: true, sortOrder: 0 }, { id: 'fixture-retired-phone', brandId: 'fixture-retired-brand', brandName: 'Fixture retired devices', name: 'Retired Phone', isActive: true, sortOrder: 1 }],
};
const attributes = [{ id: field.attributeId, key: field.key, label: field.label, dataType: 'text', isActive: true, deletedAt: null, options: [], sortOrder: 0 }] as any;
const management = { references, mappings: [{ ...field, productTypeId: 'fixture-case', isActive: true, attributeActive: true }], modelStatus: [{ id: 'fixture-phone', modelActive: true, brandActive: true }, { id: 'fixture-retired-phone', modelActive: true, brandActive: false }] };
let serverSearch = '';
function query() { return new URLSearchParams(typeof window === 'undefined' ? serverSearch : window.location.search); }
export function useRouter() { return { push(path: string) { if (typeof window !== 'undefined') window.__catalogFixture.router.push(path); }, refresh() { if (typeof window !== 'undefined') window.__catalogFixture.refreshes++; } }; }
function Hydrated({ children }: { children: React.ReactNode }) { useEffect(() => { document.documentElement.dataset.hydrated = 'true'; }, []); return <>{children}</>; }
export function createFixture(search: string) {
  serverSearch = search;
  const params = query();
  const canEdit = params.get('mode') !== 'viewer';
  const manager = (group: 'types' | 'brands' | 'models' | 'attributes') => <MetadataReferenceManager references={references} categories={categories} attributes={attributes} management={management} canEdit={canEdit} group={group} initialCategory={params.get('category') || ''} />;
  const product = { id: 'fixture-product', name: 'Fixture product draft', slug: 'fixture-product', categoryId: 'fixture-cases', pricePaise: 10000, isActive: false, images: [], variants: [], stock: null, description: '', highlights: [], specs: [], inTheBox: [], inventoryMode: 'product' } as any;
  const body = params.get('mode') === 'product' ? <ProductWorkflow categories={categories} brands={[]} conditions={[]} metadataReferences={references} product={product} /> : <CatalogueDataWorkspace canEdit={canEdit}
    starter={canEdit ? <CatalogStarterSetup categories={categories} available /> : null}
    types={manager('types')}
    details={<><p className="sa-notice">Synthetic field definitions supplied as props. This fixture tests the real assignment manager, not field definition writes.</p>{manager('attributes')}</>}
    devices={<>{manager('brands')}{manager('models')}</>}
    other={<label className="sa-field"><span className="sa-label">Fixture other-reference draft</span><input className="sa-input" defaultValue="Synthetic draft" /></label>} />;
  return <Hydrated><main className="fixture-main"><header className="fixture-banner">TEST-ONLY CATALOGUE WORKSPACE · synthetic props and in-memory fetch · no backend or database</header><h1 className="sa-page-title">Catalogue data fixture</h1>{body}</main></Hydrated>;
}
if (typeof window !== 'undefined') {
  window.__catalogFixture = { requests: [], router: [], refreshes: 0, unexpectedFetch: [] };
  window.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    window.__catalogFixture.requests.push({ url, method, body });
    if (url === '/api/store-admin/catalog/metadata/types' && method === 'GET') return response({ references, state: null });
    if (/^\/api\/store-admin\/catalog\/metadata\/(types|brands|models|attributes)$/.test(url) && method === 'PUT') return response({ ok: true });
    if (url === '/api/store-admin/catalog/setup/preview' && method === 'POST') {
      const conflict = query().get('scenario') === 'conflict';
      const rows = body.selections.map((item: { templateId: string }) => ({ templateId: item.templateId, kind: 'type', id: item.templateId, label: CATALOG_STARTER_TEMPLATES.find(template => template.id === item.templateId)?.name || item.templateId, status: conflict ? 'conflict' : 'create', message: conflict ? 'Fixture conflict: inactive record is never reactivated.' : 'Fixture only: create optional shared references.' }));
      return response({ preview: { selections: body.selections, rows, summary: { create: rows.length, reuse: 0, conflict: conflict ? 1 : 0, missing: 0, types: rows.length, attributes: 1, mappings: 1 }, schema: { missing: [], rlsDisabled: [] }, canApply: !conflict, fingerprint: 'a'.repeat(64) } });
    }
    if (url === '/api/store-admin/catalog/setup/apply' && method === 'POST') {
      if (query().get('scenario') === 'stale') return response({ error: 'Fixture preview is stale. Review again.' }, 409);
      return response({ applied: { types: body.selections.length, attributes: 1, mappings: 1 }, noop: false });
    }
    window.__catalogFixture.unexpectedFetch.push(url);
    throw new Error(`Fixture blocked unexpected fetch: ${url}`);
  };
  hydrateRoot(document.getElementById('root')!, createFixture(window.location.search));
}
declare global { interface Window { __catalogFixture: { requests: Array<{ url: string; method: string; body: any }>; router: string[]; refreshes: number; unexpectedFetch: string[] } } }
