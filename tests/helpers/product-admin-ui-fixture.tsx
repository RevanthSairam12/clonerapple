// Test-only composition of real UI. Never import this helper from the application.
import React, { useEffect, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ProductWorkflow } from '@/components/store-admin/ProductWorkflow';
import ProductsPage from '@/app/(store-admin)/store-admin/(protected)/products/page';
import type { MetadataReferences } from '@/lib/catalog/product-metadata-rules';
import type { CatalogProductDetail } from '@/lib/store-admin/catalog';
import type { ProductMetadataState } from '@/lib/store-admin/product-metadata';

const stamp = '2026-11-03T10:00:00.000Z';
export const categories = [{ id: 'fixture-cases', name: 'Cases', productCount: 2 }];
const attributes = [
  { attributeId: 'fixture-material', key: 'material', label: 'Case material', dataType: 'text', options: [], isRequired: true },
  { attributeId: 'fixture-weight', key: 'weight', label: 'Weight (g)', dataType: 'number', options: [], isRequired: false },
  { attributeId: 'fixture-finish', key: 'finish', label: 'Finish', dataType: 'enum', options: ['Matte', 'Gloss'], isRequired: false },
  { attributeId: 'fixture-wireless', key: 'wireless', label: 'Wireless charging', dataType: 'boolean', options: [], isRequired: false },
].map((item, sortOrder) => ({ ...item, sortOrder, showInSpecs: true, showInFilters: false, showInSearch: false }));
export const references: MetadataReferences = {
  types: [{ id: 'fixture-case', categoryId: 'fixture-cases', name: 'Protective case', requiresCompatibility: true, isActive: true, sortOrder: 0, attributes }],
  brands: [{ id: 'fixture-device-brand', name: 'Example devices', isActive: true, sortOrder: 0 }],
  models: ['Phone A', 'Phone B'].map((name, index) => ({ id: `fixture-phone-${index}`, name, brandId: 'fixture-device-brand', brandName: 'Example devices', isActive: true, sortOrder: index })),
};
export const metadataState: ProductMetadataState = {
  productTypeId: 'fixture-case', deviceModelIds: ['fixture-phone-0'], reviewed: true, needsCompatibilityReview: false, problems: [],
  attributes: attributes.map((item, index) => ({ attributeId: item.attributeId, key: item.key, label: item.label, value: ['Silicone', 35, 'Matte', true][index], archived: false, applicable: true })),
};
const stock = (onHand: number, reserved: number) => ({ onHand, reserved, lowStockThreshold: 3, trackInventory: true, updatedAt: stamp });
export const product: CatalogProductDetail = {
  catalogRevision: 0,
  id: 'fixture-case-blue', slug: 'fixture-case-blue', name: 'Fixture protective case', subtitle: 'Synthetic data — not a real product',
  pricePaise: 129900, salePricePaise: 99900, currency: 'INR', isActive: true, inStock: true, trackInventory: true,
  optionCount: 2, inventoryMode: 'variant', available: 15, stockStatus: 'limited', sortOrder: 0, updatedAt: stamp,
  categoryId: 'fixture-cases', categorySlug: 'cases', categoryName: 'Cases', deviceModels: [{ id: 'fixture-phone-0', name: 'Phone A' }],
  description: '', shortDescription: 'A synthetic case for fixture browser verification.',
  descriptionSections: [
    { id: 'fixture-text', type: 'text', title: 'Overview', hidden: false, blocks: [{ type: 'paragraph', content: [{ text: 'Synthetic product text', bold: true }, { text: ' with optional formatting.', italic: true, href: 'https://example.invalid/fixture' }] }, { type: 'list', ordered: true, items: [[{ text: 'First detail' }]] }] },
    { id: 'fixture-bullets', type: 'bullets', title: 'Highlights', hidden: false, items: [[{ text: 'Synthetic highlight' }]] },
    { id: 'fixture-specs', type: 'specs', title: 'Specifications', hidden: false, rows: [{ label: 'Material', value: 'Silicone' }] },
    { id: 'fixture-faq', type: 'faq', title: 'Common questions', hidden: false, items: [{ question: 'Which device?', answer: [{ type: 'paragraph', content: [{ text: 'Only the verified selected device.' }] }] }] },
  ],
  material: 'Silicone', brand: 'Fixture brand', brandId: 'fixture-brand', compareAtPaise: 149900, costPaise: null, conditionId: 'fixture-new', conditionLabel: 'New', badge: 'Test only',
  highlights: [], inTheBox: [], seoTitle: '', seoDescription: '', createdAt: stamp, facets: [], specs: [], attributeValues: [], priceHistory: [], stock: stock(0, 0),
  images: [{ id: 'fixture-photo', url: '/fixture-photo.svg', alt: 'Synthetic blue case', role: 'primary', sortOrder: 0, isActive: true, deletedAt: null }],
  variants: ['Blue', 'Black'].map((optionValue, index) => ({ id: `fixture-option-${index}`, sku: `FIXTURE-${index}`, optionName: 'Colour', optionValue,
    optionHex: index ? '#111111' : '#0055cc', pricePaiseOverride: index ? null : 139900, salePricePaise: null, isPurchasable: true,
    deviceModelId: 'fixture-phone-0', optionIdentity: optionValue.toLowerCase(), combinationKey: `fixture-combination-${index}`, stock: stock(index ? 5 : 12, index ? 0 : 2), isActive: true, sortOrder: index })),
};

// Aliased ONLY by the fixture webpack configuration. No real auth/data module is executed.
export async function getStoreSession() { return { id: 'fixture-staff', role: fixtureRole() }; }
function fixtureRole() { return fixtureMode().includes('viewer') ? 'store_viewer' : fixtureMode().includes('owner') ? 'store_owner' : 'store_admin'; }
export async function loadMetadataEditor(id?: string) { return { references, state: id === 'fixture-unlimited' ? { ...metadataState, reviewed: false, needsCompatibilityReview: true, problems: ['Synthetic missing review'] } : metadataState }; }
export async function listCatalogOverview() { return { ok: true, data: { categories, products: [product, { ...product, id: 'fixture-unlimited', name: 'Fixture unlimited case', stockStatus: 'unlimited', available: null, trackInventory: false, optionCount: 0 }] } }; }
export function formatINR(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100); }
export function formatDate(value: string) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(value)); }
export function catalogStockLabel(item: { stockStatus: string; available: number }) { return item.stockStatus === 'unlimited' ? 'Not limited' : `${item.available} available`; }
let serverMode = 'edit';
function fixtureMode() { return typeof window === 'undefined' ? serverMode : new URLSearchParams(window.location.search).get('mode') || 'edit'; }
export const router = {
  push(path: string) { if (typeof window !== 'undefined') window.__fixture.router.push(path); },
  refresh() { if (typeof window !== 'undefined') window.__fixture.refreshes++; },
};
export function useRouter() { return router; }
export default function FixtureLink({ href, children, ...props }: { href: string; children: ReactNode }) { return <a href={href} {...props} onClick={event => { if (!href.startsWith('#')) { event.preventDefault(); router.push(href); } }}>{children}</a>; }
function Hydrated({ children }: { children: ReactNode }) { useEffect(() => { document.documentElement.dataset.hydrated = 'true'; }, []); return <>{children}</>; }
export async function createFixture(search: string) {
  const query = new URLSearchParams(search);
  const mode = query.get('mode') || 'edit';
  serverMode = mode;
  const body = mode.startsWith('list')
    ? await ProductsPage({ searchParams: Promise.resolve({ review: query.get('review') || undefined }) })
    : <ProductWorkflow categories={categories} brands={[{ id: 'fixture-brand', name: 'Fixture brand' }]} conditions={[{ id: 'fixture-new', name: 'New' }]} metadataReferences={references}
        {...(mode.startsWith('add') ? {} : { product: mode === 'shared-owner' ? { ...product, inventoryMode: 'product', variants: [], stock: stock(20, 3), optionCount: 0 } : product, metadataState })} canEdit={fixtureRole() !== 'store_viewer'} canManageDevices={fixtureRole() === 'store_owner'} />;
  return <Hydrated><main className="fixture-main"><header className="fixture-banner">TEST-ONLY COMPONENT FIXTURE · synthetic data · no authenticated integration</header>{body}</main></Hydrated>;
}
if (typeof window !== 'undefined') {
  window.__fixture = { saves: [], requests: [], router: [], refreshes: 0, unexpectedFetch: [], conflict: false, reloadFailure: false };
  const currentReferences: MetadataReferences = JSON.parse(JSON.stringify(references));
  let nextId = 0;
  window.fetch = async (input, init) => {
    const url = String(input), method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    window.__fixture.requests.push({ url, method, body });
    if (url === '/api/store-admin/catalog/products/draft' && method === 'POST') {
      window.__fixture.saves.push(body);
      if (fixtureRole() === 'store_viewer') return response({ error: 'Fixture viewer cannot write.' }, 403);
      if (window.__fixture.conflict) return response({ error: 'Fixture revision conflict. Your draft is retained. Reload the latest record before saving again.', code: 'CATALOG_REVISION_CONFLICT' }, 409);
      if (body.id && body.expectedRevision !== product.catalogRevision) return response({ error: 'Fixture expectedRevision required.' }, 400);
      return response({ product: { id: body.id || body.product.id, catalogRevision: (body.expectedRevision || 0) + 1 }, warnings: ['Fixture only: nothing persisted.'] });
    }
    if (/^\/api\/store-admin\/catalog\/metadata\/(types|brands|models)$/.test(url) && method === 'GET') {
      if (window.__fixture.reloadFailure) return response({ error: 'Fixture reload unavailable.' }, 503);
      return response({ references: currentReferences, state: metadataState });
    }
    const kind = url.match(/^\/api\/store-admin\/catalog\/metadata\/(brands|models)$/)?.[1];
    if (kind && method === 'POST') {
      if (fixtureRole() !== 'store_owner') return response({ error: 'Fixture owner role required.' }, 403);
      const allowed = ['name', 'sortOrder', 'isActive', ...(kind === 'models' ? ['brandId'] : [])];
      if (Object.keys(body).some(key => !allowed.includes(key))) return response({ error: 'Fixture create fields exceeded whitelist.' }, 400);
      const collection = kind === 'brands' ? currentReferences.brands : currentReferences.models;
      if (collection.some(item => item.name.toLowerCase() === body.name.toLowerCase())) return response({ error: 'Fixture duplicate device name.' }, 409);
      const brand = currentReferences.brands.find(item => item.id === body.brandId && item.isActive);
      if (kind === 'models' && !brand) return response({ error: 'Fixture active device brand required.' }, 400);
      const reference = { id: `fixture-created-${++nextId}`, name: body.name, sortOrder: body.sortOrder, isActive: body.isActive, ...(kind === 'models' ? { brandId: brand!.id, brandName: brand!.name } : {}) };
      collection.push(reference as any);
      return response({ reference }, 201);
    }
    window.__fixture.unexpectedFetch.push(url);
    throw new Error(`Fixture blocked unexpected fetch: ${url}`);
  };
  void createFixture(window.location.search).then(tree => hydrateRoot(document.getElementById('root')!, tree));
}
declare global { interface Window { __fixture: { saves: any[]; requests: Array<{url:string; method:string; body:any}>; router: string[]; refreshes: number; unexpectedFetch: string[]; conflict: boolean; reloadFailure: boolean } } }
