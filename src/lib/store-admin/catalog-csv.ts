/**
 * CSV catalogue transfer: parser, row validation, template and export helpers.
 * Pure — the import service in `catalog-transfer.ts` does the database work.
 */

import { slugify } from './catalog-rules';
import { PRICE_MAX_PAISE } from './catalog-crud-rules';

export const MAX_IMPORT_ROWS = 5000;

export const IMPORT_COLUMNS = [
  'product_id',
  'name',
  'slug',
  'brand',
  'category',
  'condition',
  'description',
  'price',
  'compare_at_price',
  'stock',
  'low_stock_threshold',
  'image_urls',
  'is_active',
  'seo_title',
  'seo_description',
] as const;

export const EXPORT_COLUMNS = [...IMPORT_COLUMNS, 'created_at', 'updated_at'] as const;

/* ------------------------------------------------------------------ parse */

export type CsvParse =
  | { ok: true; header: string[]; rows: string[][] }
  | { ok: false; error: string };

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF, no trailing newline needed. */
export function parseCsv(text: string): CsvParse {
  const input = text.replace(/^﻿/, '');
  if (!input.trim()) return { ok: false, error: 'The file is empty.' };

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field !== '') return { ok: false, error: 'A quote appeared in the middle of a value.' };
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (char === '\r') {
      // handled with the following \n; a lone \r also ends the record
      if (input[index + 1] !== '\n') {
        record.push(field);
        records.push(record);
        record = [];
        field = '';
      }
    } else {
      field += char;
    }
  }

  if (inQuotes) return { ok: false, error: 'A quoted value is never closed.' };
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0].trim() === '') records.pop();
    else break;
  }

  const [rawHeader, ...dataRows] = records;
  if (!rawHeader) return { ok: false, error: 'The file has no header row.' };

  const header = rawHeader.map(normalizeHeader);
  for (const required of ['name', 'category', 'price']) {
    if (!header.includes(required)) {
      return { ok: false, error: `The header is missing the "${required}" column.` };
    }
  }

  for (let index = 0; index < dataRows.length; index += 1) {
    if (dataRows[index].length > header.length) {
      return {
        ok: false,
        error: `Row ${index + 2} has more cells than the header (${dataRows[index].length} > ${header.length}).`,
      };
    }
    while (dataRows[index].length < header.length) dataRows[index].push('');
  }

  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `A single file may hold at most ${MAX_IMPORT_ROWS} rows.` };
  }

  return { ok: true, header, rows: dataRows };
}

export function normalizeHeader(value: string): string {
  return value
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/* ------------------------------------------------------------- row values */

const MONEY_RE = /^\d+(?:\.\d{1,2})?$/;
const INTEGER_RE = /^-?\d+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_RE = /^(?:https?:\/\/|\/)[^\s"'<>]{1,500}$/i;

/** "₹1,29,900.50" → 12990050. `null` when the text is not money. */
export function parseMoneyToPaise(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  if (!MONEY_RE.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function parseInteger(text: string): number | null {
  const cleaned = text.trim();
  if (!INTEGER_RE.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** Blank means "use the default"; anything unparseable returns `undefined`. */
export function parseBoolean(text: string): boolean | undefined {
  const value = text.trim().toLowerCase();
  if (value === '') return true;
  if (['true', '1', 'yes', 'y', 'active'].includes(value)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(value)) return false;
  return undefined;
}

export function parseImageUrls(text: string): { urls: string[]; error: string | null } {
  const parts = text
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
  if (parts.length > 12) return { urls: [], error: 'At most 12 image URLs are allowed.' };
  for (const url of parts) {
    if (!URL_RE.test(url)) {
      return { urls: [], error: `"${url.slice(0, 60)}" is not an http(s) URL or a site path.` };
    }
  }
  return { urls: parts, error: null };
}

/* ------------------------------------------------------------- validation */

export interface CsvCategory {
  id: string;
  slug: string;
  name: string;
}
export interface CsvBrand {
  id: string;
  name: string;
  slug: string;
}
export interface CsvCondition {
  id: string;
  label: string;
}

export interface ImportContext {
  categories: CsvCategory[];
  brands: CsvBrand[];
  conditions: CsvCondition[];
  /** Products that already exist, keyed by id (id is also the slug). */
  existing: Map<string, { slug: string }>;
}

export interface ImportRow {
  rowNumber: number;
  mode: 'create' | 'update';
  productId: string;
  slug: string;
  name: string;
  categoryId: string;
  brand: string;
  brandId: string | null;
  conditionId: string | null;
  description: string;
  pricePaise: number;
  compareAtPaise: number | null;
  stock: number | null;
  lowStockThreshold: number | null;
  imageUrls: string[];
  isActive: boolean;
  seoTitle: string;
  seoDescription: string;
}

export interface ImportError {
  rowNumber: number;
  column: string;
  message: string;
}

export interface ImportValidation {
  rows: ImportRow[];
  errors: ImportError[];
}

function cell(header: string[], row: string[], column: string): string {
  const index = header.indexOf(column);
  return index === -1 ? '' : (row[index] ?? '').trim();
}

/**
 * Validate every data row. A row with any error is reported and skipped; the
 * caller refuses the whole import while `errors` is non-empty, so a bad row can
 * never leave half a catalogue behind.
 */
export function validateImportRows(
  header: string[],
  rows: string[][],
  context: ImportContext,
): ImportValidation {
  const result: ImportValidation = { rows: [], errors: [] };
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  const categoryByKey = new Map<string, string>();
  for (const category of context.categories) {
    categoryByKey.set(category.id.toLowerCase(), category.id);
    categoryByKey.set(category.slug.toLowerCase(), category.id);
    categoryByKey.set(category.name.toLowerCase(), category.id);
  }
  const conditionByKey = new Map<string, string>();
  for (const condition of context.conditions) {
    conditionByKey.set(condition.id.toLowerCase(), condition.id);
    conditionByKey.set(condition.label.toLowerCase(), condition.id);
  }
  const brandByKey = new Map<string, string>();
  for (const brand of context.brands) {
    brandByKey.set(brand.name.toLowerCase(), brand.id);
    brandByKey.set(brand.slug.toLowerCase(), brand.id);
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const errors: ImportError[] = [];
    const fail = (column: string, message: string) =>
      errors.push({ rowNumber, column, message });

    const name = cell(header, row, 'name');
    if (name.length < 1 || name.length > 140) fail('name', 'A name is required (1–140 characters).');

    const rawSlug = cell(header, row, 'slug');
    const slug = rawSlug ? rawSlug.toLowerCase() : slugify(name);
    if (!SLUG_RE.test(slug) || slug.length > 80) {
      fail('slug', 'The slug may only use lowercase letters, numbers and single dashes.');
    }

    const rawId = cell(header, row, 'product_id').toLowerCase();
    const existing = rawId ? context.existing.get(rawId) : undefined;
    const mode: 'create' | 'update' = existing ? 'update' : 'create';
    if (rawId && !existing) fail('product_id', 'No product has that id.');

    const productId = existing ? rawId : slug;
    if (mode === 'create' && context.existing.has(slug)) {
      fail('product_id', 'A product with this slug exists — set product_id to update it.');
    }
    if (mode === 'update' && slug !== existing?.slug && context.existing.has(slug)) {
      fail('slug', 'Another product already uses this slug.');
    }

    const idKey = productId.toLowerCase();
    if (seenIds.has(idKey)) fail('product_id', 'The same product appears twice in this file.');
    seenIds.add(idKey);
    if (seenSlugs.has(slug)) fail('slug', 'The same slug appears twice in this file.');
    seenSlugs.add(slug);

    const categoryText = cell(header, row, 'category');
    const categoryId = categoryText ? categoryByKey.get(categoryText.toLowerCase()) : undefined;
    if (!categoryId) fail('category', `No category matches "${categoryText}".`);

    const conditionText = cell(header, row, 'condition');
    const conditionId = (conditionText
      ? conditionByKey.get(conditionText.toLowerCase())
      : null) ?? null;
    if (conditionText && !conditionId) fail('condition', `No condition matches "${conditionText}".`);

    const brand = cell(header, row, 'brand').slice(0, 80);
    const brandId = brand ? brandByKey.get(brand.toLowerCase()) ?? null : null;

    const priceText = cell(header, row, 'price');
    const pricePaise = parseMoneyToPaise(priceText);
    if (pricePaise === null || pricePaise < 1 || pricePaise > PRICE_MAX_PAISE) {
      fail('price', 'The price must be a positive amount.');
    }

    let compareAtPaise: number | null = null;
    const compareText = cell(header, row, 'compare_at_price');
    if (compareText) {
      compareAtPaise = parseMoneyToPaise(compareText);
      if (compareAtPaise === null || compareAtPaise < 1 || compareAtPaise > PRICE_MAX_PAISE) {
        fail('compare_at_price', 'The compare-at price must be a positive amount.');
        compareAtPaise = null;
      } else if (pricePaise !== null && compareAtPaise < pricePaise) {
        fail('compare_at_price', 'The compare-at price cannot be below the price.');
      }
    }

    let stock: number | null = null;
    const stockText = cell(header, row, 'stock');
    if (stockText) {
      stock = parseInteger(stockText);
      if (stock === null || stock < 0 || stock > 100_000) {
        fail('stock', 'Stock must be a whole number between 0 and 100,000.');
        stock = null;
      }
    }

    let lowStockThreshold: number | null = null;
    const thresholdText = cell(header, row, 'low_stock_threshold');
    if (thresholdText) {
      lowStockThreshold = parseInteger(thresholdText);
      if (lowStockThreshold === null || lowStockThreshold < 0 || lowStockThreshold > 1_000_000) {
        fail('low_stock_threshold', 'The threshold must be a whole number of zero or more.');
        lowStockThreshold = null;
      }
    }

    const images = parseImageUrls(cell(header, row, 'image_urls'));
    if (images.error) fail('image_urls', images.error);

    const isActive = parseBoolean(cell(header, row, 'is_active'));
    if (isActive === undefined) fail('is_active', 'Use true/false (or leave it blank).');

    const description = cell(header, row, 'description');
    if (description.length > 5000) fail('description', 'The description must be 5,000 characters or fewer.');
    const seoTitle = cell(header, row, 'seo_title');
    if (seoTitle.length > 120) fail('seo_title', 'The SEO title must be 120 characters or fewer.');
    const seoDescription = cell(header, row, 'seo_description');
    if (seoDescription.length > 320) {
      fail('seo_description', 'The SEO description must be 320 characters or fewer.');
    }

    if (errors.length > 0) {
      result.errors.push(...errors);
      return;
    }

    result.rows.push({
      rowNumber,
      mode,
      productId,
      slug,
      name,
      categoryId: categoryId as string,
      brand,
      brandId,
      conditionId,
      description,
      pricePaise: pricePaise as number,
      compareAtPaise,
      stock,
      lowStockThreshold,
      imageUrls: images.urls,
      isActive: isActive as boolean,
      seoTitle,
      seoDescription,
    });
  });

  return result;
}

/* ------------------------------------------------------------- serialising */

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.join(','), ...rows.map((row) => row.map(escapeCell).join(','))].join('\r\n');
}

export function templateCsv(): string {
  return toCsv(IMPORT_COLUMNS, [
    [
      '',
      'GaN Charger 65W',
      'gan-charger-65w',
      'Gadzio',
      'Power',
      'New',
      'Compact 65W gallium nitride charger.',
      '3499.00',
      '3999.00',
      '25',
      '5',
      'https://example.com/charger-front.jpg|https://example.com/charger-side.jpg',
      'true',
      'GaN Charger 65W — Gadzio',
      'A compact 65W GaN charger for laptops and phones.',
    ],
  ]);
}
