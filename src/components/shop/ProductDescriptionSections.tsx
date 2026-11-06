import React, { type ReactNode } from 'react';
import { sanitizeDescriptionSections, type DescriptionInline, type DescriptionRichText } from '@/lib/catalog/product-description';

export type ProductDescriptionSectionsProps = { sections: unknown; className?: string; defaultOpen?: boolean };

function Inline({ content }: { content: DescriptionInline[] }) {
  return content.map((span, index) => {
    let node: ReactNode = span.text;
    if (span.bold) node = <strong>{node}</strong>;
    if (span.italic) node = <em>{node}</em>;
    if (span.href) node = <a href={span.href} rel="nofollow noopener noreferrer" className="text-[#0066cc] underline underline-offset-2">{node}</a>;
    return <span key={index} className="whitespace-pre-wrap break-words">{node}</span>;
  });
}
function RichText({ blocks }: { blocks: DescriptionRichText }) {
  return blocks.map((block, index) => {
    if (block.type === 'paragraph') return <p key={index}><Inline content={block.content} /></p>;
    const List = block.ordered ? 'ol' : 'ul';
    return <List key={index} className={`${block.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-2`}>{block.items.map((item, i) => <li key={i}><Inline content={item} /></li>)}</List>;
  });
}
/** Safe in server or client trees. Validates unknown JSON before creating React elements. */
export function ProductDescriptionSections({ sections, className = '', defaultOpen = true }: ProductDescriptionSectionsProps) {
  const visible = sanitizeDescriptionSections(sections).filter(section => !section.hidden);
  if (!visible.length) return null;
  return <section aria-label="Product information" className={`mt-20 border-t border-[#d2d2d7] ${className}`}>
    {visible.map(section => <details key={section.id} open={defaultOpen} className="group border-b border-[#d2d2d7] py-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0071e3] [&::-webkit-details-marker]:hidden">
        <h2 className="text-xl sm:text-[22px] font-semibold text-[#1d1d1f] tracking-tight">{section.title}</h2>
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-[#6e6e73] transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m6 9 6 6 6-6" /></svg>
      </summary>
      <div className="mt-6 max-w-3xl space-y-4 text-[13.5px] sm:text-[14px] leading-[1.65] text-[#1d1d1f]">
        {section.type === 'text' && <RichText blocks={section.blocks} />}
        {section.type === 'bullets' && <ul className="list-disc pl-5 space-y-2">{section.items.map((item, index) => <li key={index}><Inline content={item} /></li>)}</ul>}
        {/* One line per specification, as a bulleted list. Each stored row is a
            label/value pair; a row with only a label (or only a value) still
            prints as one line rather than an empty half. A value may hold its
            own line breaks, and every line inside it becomes its own point. */}
        {section.type === 'specs' && <ul className="list-disc space-y-2 pl-5">{section.rows.flatMap((row, index) => {
          const label = row.label.trim();
          const lines = row.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (lines.length <= 1) {
            const value = lines[0] ?? '';
            return [<li key={index} className="whitespace-pre-wrap break-words">
              {label && <strong className="font-semibold">{label}</strong>}
              {label && value ? <span aria-hidden="true">: </span> : null}
              {value}
            </li>];
          }
          return lines.map((line, lineIndex) => <li key={`${index}-${lineIndex}`} className="whitespace-pre-wrap break-words">
            {lineIndex === 0 && label ? <><strong className="font-semibold">{label}</strong><span aria-hidden="true">: </span></> : null}{line}
          </li>);
        })}</ul>}
        {section.type === 'faq' && section.items.map((item, index) => <div key={index} className="space-y-2"><h3 className="font-semibold whitespace-pre-wrap break-words">{item.question}</h3><RichText blocks={item.answer} /></div>)}
      </div>
    </details>)}
  </section>;
}
