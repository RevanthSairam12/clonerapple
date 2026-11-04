/* Pure JSON-only description contract, shared by write validation and rendering. */
export const DESCRIPTION_LIMITS = Object.freeze({ sections: 24, title: 160, shortDescription: 1000, blocks: 60, items: 100, spans: 100, text: 8000, url: 2048, totalText: 100000 });
export type DescriptionInline = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type DescriptionBlock = { type: 'paragraph'; content: DescriptionInline[] } | { type: 'list'; ordered: boolean; items: DescriptionInline[][] };
export type DescriptionRichText = DescriptionBlock[];
type SectionBase = { id: string; title: string; hidden: boolean };
export type ProductDescriptionSection = SectionBase & (
  { type: 'text'; blocks: DescriptionRichText } |
  { type: 'bullets'; items: DescriptionInline[][] } |
  { type: 'specs'; rows: { label: string; value: string }[] } |
  { type: 'faq'; items: { question: string; answer: DescriptionRichText }[] }
);
export type ProductDescription = { shortDescription: string | null; sections: ProductDescriptionSection[] | null };
export type DescriptionSectionType = ProductDescriptionSection['type'];

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a description object.');
  return input as Record<string, unknown>;
}
function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || input.length > max) throw new Error(`Expected text of at most ${max} characters.`);
  // HTML-looking strings remain literal text; no HTML is ever interpreted.
  return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
function array(input: unknown, max: number): unknown[] {
  if (!Array.isArray(input) || input.length > max) throw new Error(`Expected an array of at most ${max} items.`);
  return input;
}
function flag(input: unknown): boolean {
  if (input === undefined) return false;
  if (typeof input !== 'boolean') throw new Error('Expected a boolean.');
  return input;
}
/** Only absolute HTTP(S), mailto and tel links. No relative or protocol-relative URLs. */
export function sanitizeDescriptionUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > DESCRIPTION_LIMITS.url) return undefined;
  const value = input.trim();
  if (!value || /[\s\u0000-\u001f\u007f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) return undefined;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (!url.hostname || url.username || url.password)) return undefined;
    if ((url.protocol === 'mailto:' || url.protocol === 'tel:') && !url.pathname) return undefined;
    return value;
  } catch { return undefined; }
}
/** Invalid link targets are downgraded to ordinary text; unknown properties are discarded. */
export function parseDescriptionSections(input: unknown): ProductDescriptionSection[] | null {
  if (input === null) return null;
  let budget = DESCRIPTION_LIMITS.totalText;
  const read = (value: unknown, max: number = DESCRIPTION_LIMITS.text) => {
    const result = text(value, max); budget -= result.length;
    if (budget < 0) throw new Error('Description exceeds the total text limit.');
    return result;
  };
  const inlines = (value: unknown): DescriptionInline[] => array(value, DESCRIPTION_LIMITS.spans).map(raw => {
    const span = record(raw);
    const result: DescriptionInline = { text: read(span.text) };
    if (flag(span.bold)) result.bold = true;
    if (flag(span.italic)) result.italic = true;
    const href = sanitizeDescriptionUrl(span.href);
    if (href) result.href = href;
    return result;
  });
  const blocks = (value: unknown): DescriptionRichText => array(value, DESCRIPTION_LIMITS.blocks).map(raw => {
    const block = record(raw);
    if (block.type === 'paragraph') return { type: 'paragraph', content: inlines(block.content) };
    if (block.type === 'list') return { type: 'list', ordered: flag(block.ordered), items: array(block.items, DESCRIPTION_LIMITS.items).map(inlines) };
    throw new Error('Unsupported description block type.');
  });
  const ids = new Set<string>();
  return array(input, DESCRIPTION_LIMITS.sections).map(raw => {
    const section = record(raw);
    const id = read(section.id, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('Section IDs must be unique and use letters, numbers, underscores or dashes.');
    ids.add(id);
    const base = { id, title: read(section.title, DESCRIPTION_LIMITS.title), hidden: flag(section.hidden) };
    switch (section.type) {
      case 'text': return { ...base, type: 'text', blocks: blocks(section.blocks) };
      case 'bullets': return { ...base, type: 'bullets', items: array(section.items, DESCRIPTION_LIMITS.items).map(inlines) };
      case 'specs': return { ...base, type: 'specs', rows: array(section.rows, DESCRIPTION_LIMITS.items).map(rawRow => {
        const row = record(rawRow); return { label: read(row.label, DESCRIPTION_LIMITS.title), value: read(row.value) };
      }) };
      case 'faq': return { ...base, type: 'faq', items: array(section.items, DESCRIPTION_LIMITS.items).map(rawItem => {
        const item = record(rawItem); return { question: read(item.question, DESCRIPTION_LIMITS.title), answer: blocks(item.answer) };
      }) };
      default: throw new Error('Unsupported description section type.');
    }
  });
}
export function parseProductDescription(input: unknown): ProductDescription {
  const value = record(input);
  return {
    shortDescription: value.shortDescription === null ? null : text(value.shortDescription, DESCRIPTION_LIMITS.shortDescription),
    sections: parseDescriptionSections(value.sections),
  };
}
/** Read boundary: malformed persisted sections fail closed, without crashing the product page. */
export function sanitizeDescriptionSections(input: unknown): ProductDescriptionSection[] {
  try { return parseDescriptionSections(input) ?? []; } catch { return []; }
}
export function descriptionParagraph(value: string): DescriptionBlock {
  return { type: 'paragraph', content: [{ text: value }] };
}
/** Never invents product claims; starters contain only empty editable fields. */
export function createDescriptionSection(type: DescriptionSectionType, id: string): ProductDescriptionSection {
  const base = { id, hidden: false };
  switch (type) {
    case 'text': return { ...base, type, title: 'Overview', blocks: [descriptionParagraph('')] };
    case 'bullets': return { ...base, type, title: 'Highlights', items: [[{ text: '' }]] };
    case 'specs': return { ...base, type, title: 'Specifications', rows: [{ label: '', value: '' }] };
    case 'faq': return { ...base, type, title: 'Frequently asked questions', items: [{ question: '', answer: [descriptionParagraph('')] }] };
  }
}
export function reorderDescriptionSections(sections: ProductDescriptionSection[], from: number, to: number): ProductDescriptionSection[] {
  const result = [...sections];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [section] = result.splice(from, 1); result.splice(to, 0, section); return result;
}
export type LegacyProductDescription = {
  shortDescription?: string | null; sections?: unknown;
  description?: string | null; highlights?: { title: string; desc: string }[];
  specs?: { label: string; value: string }[]; inTheBox?: string[];
};
/** Pure and deterministic. An explicit [] is intentional; only null/absent sections convert.
 * Pass its output back in and it is unchanged. Suitable for a separate dry-run tool.
 * Legacy strings are plain text, including anything resembling HTML.
 */
export function convertLegacyProductDescription(input: LegacyProductDescription): ProductDescription {
  const shortDescription = input.shortDescription ?? null;
  if (input.sections != null) return parseProductDescription({ shortDescription, sections: input.sections });
  const sections: ProductDescriptionSection[] = [];
  if (input.description) sections.push({ id: 'legacy-overview', title: 'Overview', hidden: false, type: 'text', blocks: [descriptionParagraph(input.description)] });
  if (input.highlights?.length) sections.push({ id: 'legacy-highlights', title: 'Highlights', hidden: false, type: 'bullets', items: input.highlights.map(item => [
    { text: item.title, bold: true }, ...(item.desc ? [{ text: ` — ${item.desc}` }] : []),
  ]) });
  if (input.specs?.length) sections.push({ id: 'legacy-specs', title: 'Specifications', hidden: false, type: 'specs', rows: input.specs });
  if (input.inTheBox?.length) sections.push({ id: 'legacy-box', title: 'In the box', hidden: false, type: 'bullets', items: input.inTheBox.map(item => [{ text: item }]) });
  return parseProductDescription({ shortDescription, sections });
}
