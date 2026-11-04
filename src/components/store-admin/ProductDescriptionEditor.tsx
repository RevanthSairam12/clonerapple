'use client';

import React, { useState } from 'react';
import {
  DESCRIPTION_LIMITS, createDescriptionSection, descriptionParagraph, reorderDescriptionSections,
  sanitizeDescriptionUrl, type DescriptionInline, type DescriptionRichText,
  type DescriptionSectionType, type ProductDescription, type ProductDescriptionSection,
} from '@/lib/catalog/product-description';
import { ProductGuide } from './ProductHelp';
import { ProductSpecificationRows } from './ProductSpecificationsEditor';

export type ProductDescriptionEditorProps = {
  value: ProductDescription;
  onChange: (value: ProductDescription) => void;
  disabled?: boolean;
};
type InlineProps = { value: DescriptionInline[]; onChange: (value: DescriptionInline[]) => void };
const buttonClass = 'sa-btn sa-btn-quiet';

/** Each run has plain text and explicit marks: paste never introduces HTML. */
function InlineEditor({ value, onChange }: InlineProps) {
  return <ProductGuide><div className="space-y-2">{value.map((span, index) => {
    const change = (patch: Partial<DescriptionInline>) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
    const unsafeLink = !!span.href && !sanitizeDescriptionUrl(span.href);
    return <div key={index} className="space-y-2 rounded border border-gray-200 p-2">
      <label className="sa-field"><span className="sa-label">Text {index + 1}</span><textarea className="sa-input" rows={2} maxLength={DESCRIPTION_LIMITS.text} value={span.text} onChange={event => change({ text: event.target.value })} /></label>
      <details>
        <summary>Formatting and links</summary>
        <p className="sa-hint">Apply these options to text {index + 1}. Add another text part for different formatting.</p>
        <div className="sa-inline-actions">
          <button type="button" className={buttonClass} aria-label={`Bold text ${index + 1}`} aria-pressed={!!span.bold} onClick={() => change({ bold: !span.bold })}><strong>Bold</strong>{span.bold ? ' (on)' : ''}</button>
          <button type="button" className={buttonClass} aria-label={`Italic text ${index + 1}`} aria-pressed={!!span.italic} onClick={() => change({ italic: !span.italic })}><em>Italic</em>{span.italic ? ' (on)' : ''}</button>
        </div>
        <label className="sa-field"><span className="sa-label">Link for text {index + 1} (optional)</span><input className="sa-input" type="text" maxLength={DESCRIPTION_LIMITS.url} value={span.href ?? ''} aria-invalid={unsafeLink} onChange={event => change({ href: event.target.value || undefined })} /></label>
      </details>
      {unsafeLink && <p className="sa-error" role="status">This link will be removed when saved. Open Formatting and links to enter a full web address starting with https:// or http://, or an email or phone link starting with mailto: or tel:.</p>}
      <button type="button" className={buttonClass} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove text {index + 1}</button>
    </div>;
  })}<button type="button" className={buttonClass} disabled={value.length >= DESCRIPTION_LIMITS.spans} onClick={() => onChange([...value, { text: '' }])}>Add text part</button></div></ProductGuide>;
}
function ItemEditor({ value, onChange }: { value: DescriptionInline[][]; onChange: (value: DescriptionInline[][]) => void }) {
  return <ProductGuide><div className="space-y-3">{value.map((item, index) => <fieldset key={index} className="rounded border border-gray-200 p-3"><legend>Item {index + 1}</legend><InlineEditor value={item} onChange={next => onChange(value.map((row, i) => i === index ? next : row))} /><button type="button" className={buttonClass} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove item {index + 1}</button></fieldset>)}<button type="button" className={buttonClass} disabled={value.length >= DESCRIPTION_LIMITS.items} onClick={() => onChange([...value, [{ text: '' }]])}>Add item</button></div></ProductGuide>;
}
function RichEditor({ value, onChange }: { value: DescriptionRichText; onChange: (value: DescriptionRichText) => void }) {
  return <ProductGuide><div className="space-y-3">{value.map((block, index) => <fieldset key={index} className="rounded border border-gray-200 p-3"><legend>{block.type === 'paragraph' ? 'Paragraph' : 'List'} {index + 1}</legend>
    {block.type === 'paragraph' ? <InlineEditor value={block.content} onChange={content => onChange(value.map((item, i) => i === index ? { ...block, content } : item))} /> : <><label className="sa-check"><input type="checkbox" checked={block.ordered} onChange={event => onChange(value.map((item, i) => i === index ? { ...block, ordered: event.target.checked } : item))} />Numbered list</label><ItemEditor value={block.items} onChange={items => onChange(value.map((item, i) => i === index ? { ...block, items } : item))} /></>}
    <button type="button" className={buttonClass} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove {block.type === 'paragraph' ? 'paragraph' : 'list'} {index + 1}</button>
  </fieldset>)}<div className="sa-inline-actions"><button type="button" className={buttonClass} disabled={value.length >= DESCRIPTION_LIMITS.blocks} onClick={() => onChange([...value, descriptionParagraph('')])}>Add paragraph</button><button type="button" className={buttonClass} disabled={value.length >= DESCRIPTION_LIMITS.blocks} onClick={() => onChange([...value, { type: 'list', ordered: false, items: [[{ text: '' }]] }])}>Add list</button></div></div></ProductGuide>;
}

/** Controlled form fragment. The parent owns save/reset, authorization and persistence. */
export function ProductDescriptionEditor({ value, onChange, disabled = false }: ProductDescriptionEditorProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const sections = value.sections ?? [];
  const update = (index: number, section: ProductDescriptionSection) => onChange({ ...value, sections: sections.map((item, i) => i === index ? section : item) });
  const move = (from: number, to: number) => {
    if (disabled || from === to || from < 0 || to < 0 || to >= sections.length) return;
    onChange({ ...value, sections: reorderDescriptionSections(sections, from, to) });
    setNotice(`${sections[from].title || 'Section'} moved to position ${to + 1}.`);
  };
  const add = (type: DescriptionSectionType) => {
    if (disabled || sections.length >= DESCRIPTION_LIMITS.sections) return;
    let suffix = 1;
    while (sections.some(section => section.id === `section-${suffix}`)) suffix++;
    onChange({ ...value, sections: [...sections, createDescriptionSection(type, `section-${suffix}`)] });
  };
  return <ProductGuide><fieldset className="sa-detail-section space-y-4" disabled={disabled}>
    <legend className="sa-section-title">Product description</legend>
    <label className="sa-field"><span className="sa-label">Short description</span><textarea className="sa-input" rows={3} maxLength={DESCRIPTION_LIMITS.shortDescription} value={value.shortDescription ?? ''} onChange={event => onChange({ ...value, shortDescription: event.target.value })} /></label>
    <p className="sa-hint">Build the description with text, lists, specifications or questions and answers. Formatting and links are optional.</p>
    <details>
      <summary>How to arrange sections</summary>
      <p className="sa-hint">Use Move up or Move down, drag the reorder handle, or focus the handle and press Alt + Arrow Up or Down.</p>
    </details>
    {value.sections === null && <p className="sa-notice">No section-based description is set. Load the converted older description before editing to keep existing content.</p>}
    <div className="sa-inline-actions">{(['text', 'bullets', 'specs', 'faq'] as const).map(type => <button type="button" key={type} className={buttonClass} disabled={sections.length >= DESCRIPTION_LIMITS.sections} onClick={() => add(type)}>Add {type === 'text' ? 'text section' : type === 'bullets' ? 'bullet list' : type === 'specs' ? 'specifications' : 'questions & answers'}</button>)}</div>
    <p role="status" aria-live="polite" className="sa-hint">{notice}</p>
    {sections.map((section, index) => <fieldset key={section.id} className={`space-y-3 rounded border p-4 ${section.hidden ? 'border-dashed border-gray-400' : 'border-gray-200'}`} onDragOver={event => { if (!disabled && dragId) event.preventDefault(); }} onDrop={event => {
      event.preventDefault(); if (disabled || !dragId) return;
      move(sections.findIndex(item => item.id === dragId), index); setDragId(null);
    }}>
      <legend>{index + 1}. {section.title || 'Untitled section'} ({section.type === 'text' ? 'Text' : section.type === 'bullets' ? 'Bullet list' : section.type === 'specs' ? 'Specifications' : 'Questions & answers'}){section.hidden ? ' — Hidden' : ''}</legend>
      <div className="sa-inline-actions">
        <button type="button" className={buttonClass} draggable={!disabled} aria-label={`Reorder ${section.title || 'section'}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onDragStart={event => { if (disabled) { event.preventDefault(); return; } setDragId(section.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', section.id); }} onDragEnd={() => setDragId(null)} onKeyDown={event => {
          if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); move(index, index + (event.key === 'ArrowUp' ? -1 : 1)); }
        }}>Drag / reorder</button>
        <button type="button" className={buttonClass} disabled={index === 0} onClick={() => move(index, index - 1)}>Move up</button>
        <button type="button" className={buttonClass} disabled={index === sections.length - 1} onClick={() => move(index, index + 1)}>Move down</button>
        <button type="button" className={buttonClass} onClick={() => onChange({ ...value, sections: sections.filter((_, i) => i !== index) })}>Remove section</button>
      </div>
      <label className="sa-field"><span className="sa-label">Section title</span><input className="sa-input" maxLength={DESCRIPTION_LIMITS.title} value={section.title} onChange={event => update(index, { ...section, title: event.target.value })} /></label>
      <label className="sa-check"><input type="checkbox" checked={section.hidden} onChange={event => update(index, { ...section, hidden: event.target.checked })} />Hide from storefront (keep content)</label>
      {section.type === 'text' && <RichEditor value={section.blocks} onChange={blocks => update(index, { ...section, blocks })} />}
      {section.type === 'bullets' && <ItemEditor value={section.items} onChange={items => update(index, { ...section, items })} />}
      {section.type === 'specs' && <ProductSpecificationRows value={section.rows} disabled={disabled} onChange={rows => update(index, { ...section, rows })} />}
      {section.type === 'faq' && <div className="space-y-3">{section.items.map((item, itemIndex) => <fieldset key={itemIndex} className="space-y-2 rounded border border-gray-200 p-3"><legend>Question & answer {itemIndex + 1}</legend><label className="sa-field"><span className="sa-label">Question</span><input className="sa-input" maxLength={DESCRIPTION_LIMITS.title} value={item.question} onChange={event => update(index, { ...section, items: section.items.map((row, i) => i === itemIndex ? { ...row, question: event.target.value } : row) })} /></label><RichEditor value={item.answer} onChange={answer => update(index, { ...section, items: section.items.map((row, i) => i === itemIndex ? { ...row, answer } : row) })} /><button type="button" className={buttonClass} onClick={() => update(index, { ...section, items: section.items.filter((_, i) => i !== itemIndex) })}>Remove question & answer {itemIndex + 1}</button></fieldset>)}<button type="button" className={buttonClass} disabled={section.items.length >= DESCRIPTION_LIMITS.items} onClick={() => update(index, { ...section, items: [...section.items, { question: '', answer: [descriptionParagraph('')] }] })}>Add question & answer</button></div>}
    </fieldset>)}
  </fieldset></ProductGuide>;
}
