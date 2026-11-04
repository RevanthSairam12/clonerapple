'use client';

import { useEffect, useState, type ReactNode } from 'react';

const sections = [
  { id: 'types', label: 'Product types', help: '1. Choose a category, then create a product type.' },
  { id: 'details', label: 'Detail fields', help: '2. Define reusable fields, then assign them to product types.' },
  { id: 'devices', label: 'Compatible devices', help: '3. Add device brands and exact models. Select verified compatibility on each product.' },
  { id: 'other', label: 'Other references', help: 'Product brands, conditions and units are separate reusable choices.' },
] as const;
type Section = typeof sections[number]['id'];
interface Props { types: ReactNode; details: ReactNode; devices: ReactNode; other: ReactNode; starter: ReactNode; canEdit: boolean }
/** Panels stay mounted, so navigating the workspace does not throw away form drafts. */
export function CatalogueDataWorkspace({ types, details, devices, other, starter, canEdit }: Props) {
  const [active, setActive] = useState<Section>('types');
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('section');
    if (sections.some(section => section.id === value)) setActive(value as Section);
  }, []);
  const panels = { types, details, devices, other };
  return <div className="sa-catalog-workspace">
    <aside className="sa-catalog-guide" aria-label="Catalogue setup guide">
      <strong>Set up once, choose on each product</strong>
      <p>Category → Product type → Detail fields → Verified devices → Product</p>
      <p className="sa-hint">A field definition creates a reusable question; the product holds its answer. Device brands are not product brands. Nothing is assigned to products automatically.</p>
      {!canEdit && <p className="sa-lock-note">You can view catalogue data. A store owner must create or change these shared choices.</p>}
    </aside>
    {starter}
    <div className="sa-catalog-tabs" role="tablist" aria-label="Catalogue data sections">{sections.map(section => <button key={section.id} id={`catalog-tab-${section.id}`} type="button" role="tab" aria-selected={active === section.id} aria-controls={`catalog-panel-${section.id}`} tabIndex={active === section.id ? 0 : -1} className={`sa-btn ${active === section.id ? 'sa-btn-primary' : 'sa-btn-quiet'}`} onClick={() => setActive(section.id)} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = sections.findIndex(item => item.id === section.id);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
      setActive(sections[next].id); document.getElementById(`catalog-tab-${sections[next].id}`)?.focus();
    }}>{section.label}</button>)}</div>
    {sections.map(section => <section key={section.id} id={`catalog-panel-${section.id}`} role="tabpanel" aria-labelledby={`catalog-tab-${section.id}`} hidden={active !== section.id} tabIndex={0}>
      <p className="sa-page-sub">{section.help}</p>{panels[section.id]}
    </section>)}
  </div>;
}
