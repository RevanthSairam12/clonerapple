/** Pure Phase 1 shared-list parsing and planning. No catalogue writes or identity rewrites. */
export type SharedKind = 'models' | 'colours';
export interface SharedReference {
  id: string; name: string; isActive: boolean; sortOrder: number; brandId?: string; hex?: string;
}
export interface SharedSnapshot {
  brands: SharedReference[]; models: SharedReference[]; colours: SharedReference[];
}
export interface SharedInput {
  kind: SharedKind; format: 'csv' | 'paste'; text: string; brandId?: string;
}
export interface SharedRow {
  row: number; status: 'new' | 'existing' | 'near' | 'invalid'; name: string;
  brandId?: string; hex?: string; sortOrder: number; isActive: boolean;
  reason: string; suggestions: string[];
}
export interface SharedPlan {
  rows: SharedRow[]; counts: Record<'new' | 'existing' | 'near' | 'invalid', number>;
}
export class SharedListError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'SharedListError';
  }
}

const MAX_BYTES = 262_144;
const MAX_ROWS = 500;
const HEADERS = { models: ['brand', 'model'], colours: ['name', 'hex'] } as const;
const OPTIONAL_HEADERS = ['sort_order', 'active'];
const CONTROLS = /[\p{Cc}\p{Cf}]/u;

/**
 * Exact shared JS/SQL identity contract: NFKC, Unicode lowercase EACH code point,
 * then retain only Unicode General_Category Letter or Number. Deliberately not
 * whole-string lowercase (Greek final sigma is context-sensitive), locale folding,
 * accent stripping, or ASCII-only normalization. SQL must use the same pinned
 * Unicode case/category data; locale-dependent lower()/[:alnum:] are not parity.
 * This is separate from, and must never replace, saved option/SKU identities.
 */
export function normalizeSharedName(value: string): string {
  return Array.from(value.normalize('NFKC'), character => character.toLowerCase())
    .join('').replace(/[^\p{L}\p{N}]/gu, '');
}

function formulaLike(value: string): boolean {
  // Check before trim, including invisible controls and compatibility characters.
  return /^[\s\p{Cc}\p{Cf}]*[=+@-]/u.test(value.normalize('NFKC'));
}

export function parseSharedInput(raw: unknown): SharedInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SharedListError('Provide a shared-list input object.');
  }
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['kind', 'format', 'text', 'brandId'].includes(key))) {
    throw new SharedListError('Unexpected shared-list input field.');
  }
  if (value.kind !== 'models' && value.kind !== 'colours') throw new SharedListError('Select models or colours.');
  if (value.format !== 'csv' && value.format !== 'paste') throw new SharedListError('Select CSV or paste format.');
  if (typeof value.text !== 'string') throw new SharedListError('Input text must be a string.');
  // Strings supplied by JSON can contain lone surrogates even after a strict UTF-8 body decode.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.text)) {
    throw new SharedListError('Input text must contain valid Unicode.');
  }
  // Includes BOM, CSV header, delimiters and every original line-ending byte.
  if (new TextEncoder().encode(value.text).byteLength > MAX_BYTES) {
    throw new SharedListError('Input exceeds 262144 UTF-8 bytes (including header and line endings).', 413);
  }
  if (value.brandId !== undefined && (value.kind !== 'models' || typeof value.brandId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.brandId))) {
    throw new SharedListError('Provide a valid selected model brand ID.');
  }
  return {
    kind: value.kind, format: value.format, text: value.text,
    ...(value.brandId === undefined ? {} : { brandId: value.brandId as string }),
  };
}

/** Strict RFC-style records; row numbers are record ordinals, not physical lines. */
function csvRecords(text: string, maxRecords: number): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let pending = false;
  const record = () => {
    records.push([...cells, cell]);
    if (records.length > maxRecords) throw new SharedListError('At most 500 data records are allowed.');
    cells = []; cell = ''; state = 'start'; pending = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    pending = true;
    if (state === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else state = 'closed';
      } else cell += character;
      continue;
    }
    if (character === ',') { cells.push(cell); cell = ''; state = 'start'; continue; }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      record(); continue;
    }
    if (character === '"') {
      if (state !== 'start') throw new SharedListError(`Unexpected CSV quote in record ${records.length + 1}.`);
      state = 'quoted'; continue;
    }
    if (state === 'closed') throw new SharedListError(`Unexpected text after a CSV quote in record ${records.length + 1}.`);
    cell += character; state = 'plain';
  }
  if (state === 'quoted') throw new SharedListError(`Unclosed CSV quote in record ${records.length + 1}.`);
  if (pending) record();
  return records;
}

interface SourceRow { row: number; cells: string[]; values: Record<string, string>; error?: string }
function sourceRows(input: SharedInput): SourceRow[] {
  const text = input.text.replace(/^﻿/, '');
  if (input.format === 'csv') {
    const records = csvRecords(text, MAX_ROWS + 1);
    const header = records.shift();
    if (!header) throw new SharedListError('CSV requires a header.');
    if (header.some(formulaLike)) throw new SharedListError('Formula-looking CSV headers are not allowed.');
    // Explicit lower-case machine headers; surrounding ASCII spaces are harmless.
    const keys = header.map(cell => cell.replace(/^ +| +$/g, ''));
    const required: readonly string[] = HEADERS[input.kind];
    const allowed = [...required, ...OPTIONAL_HEADERS];
    if (new Set(keys).size !== keys.length || keys.some(key => !allowed.includes(key))
        || required.some(key => !keys.includes(key))) {
      throw new SharedListError(`CSV headers must include ${required.join(',')}; only sort_order,active are optional.`);
    }
    return records.map((cells, index) => ({
      row: index + 2, cells, values: Object.fromEntries(keys.map((key, position) => [key, cells[position] ?? ''])),
      ...(cells.length === keys.length ? {} : { error: 'CSV record must have the same number of cells as the header.' }),
    }));
  }
  const rows: SourceRow[] = [];
  text.split(/\r\n|\n|\r/).forEach((line, index) => {
    if (!line.trim()) return; // Blank paste lines do not consume the 500-record allowance.
    if (rows.length >= MAX_ROWS) throw new SharedListError('At most 500 data records are allowed.');
    if (input.kind === 'models' && input.brandId) {
      rows.push({ row: index + 1, cells: [line], values: { model: line } });
    } else if (input.kind === 'models') {
      // A pasted line is one record; quotes may protect a comma in a brand/model.
      let cells: string[];
      try { cells = csvRecords(line, 1)[0] ?? []; }
      catch { rows.push({ row: index + 1, cells: [line], values: {}, error: 'Use one Brand,Model record per paste line.' }); return; }
      rows.push({ row: index + 1, cells, values: { brand: cells[0] ?? '', model: cells[1] ?? '' },
        ...(cells.length === 2 ? {} : { error: 'Use one Brand,Model record per paste line.' }) });
    } else {
      const match = /^(.*?)\s+(#[^\s]+)\s*$/u.exec(line.trim());
      rows.push({ row: index + 1, cells: match ? [match[1], match[2]] : [line],
        values: { name: match?.[1] ?? line, hex: match?.[2] ?? '' },
        ...(match ? {} : { error: 'Use one Name #RRGGBB record per paste line.' }) });
    }
  });
  return rows;
}

function invalid(row: SharedRow, reason: string): void {
  row.status = 'invalid'; row.reason = reason; row.suggestions = [];
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Banded Levenshtein over code points: only the decision radius (at most 2) is evaluated. */
function nearDistance(a: string[], b: string[], limit: number): number {
  if (a.length - b.length > limit || b.length - a.length > limit) return limit + 1;
  const infinity = limit + 1;
  let previous: number[] = Array(b.length + 1).fill(infinity);
  for (let j = 0; j <= b.length && j <= limit; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = Array(b.length + 1).fill(infinity);
    if (i <= limit) current[0] = i;
    let minimum = infinity;
    const start = i > limit ? i - limit : 1;
    const end = i + limit < b.length ? i + limit : b.length;
    for (let j = start; j <= end; j++) {
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      let value = deletion < insertion ? deletion : insertion;
      if (substitution < value) value = substitution;
      current[j] = value;
      if (value < minimum) minimum = value;
    }
    if (minimum > limit) return infinity;
    previous = current;
  }
  return previous[b.length];
}
interface NearCandidate { id: string; name: string; key: string; characters: string[]; brandId?: string }
function nearCandidate(reference: SharedReference): NearCandidate {
  const key = normalizeSharedName(reference.name);
  return { id: reference.id, name: reference.name, key, characters: Array.from(key), brandId: reference.brandId };
}
export function sharedNearNames(name: string, references: SharedReference[]): string[] {
  return nearSuggestions(normalizeSharedName(name), references.map(nearCandidate));
}
function nearSuggestions(key: string, candidates: NearCandidate[]): string[] {
  const characters = Array.from(key);
  if (characters.length < 3) return [];
  const limit = characters.length <= 6 ? 1 : 2;
  const matches: Array<{ candidate: NearCandidate; distance: number }> = [];
  for (const candidate of candidates) {
    if (candidate.characters.length < 3) continue;
    const distance = nearDistance(characters, candidate.characters, limit);
    if (distance > 0 && distance <= limit) matches.push({ candidate, distance });
  }
  matches.sort((a, b) => a.distance - b.distance || compare(a.candidate.key, b.candidate.key)
    || compare(a.candidate.name, b.candidate.name) || compare(a.candidate.id, b.candidate.id));
  return [...new Set(matches.map(match => match.candidate.name))].slice(0, 5);
}

/**
 * CSV: required brand,model OR name,hex; optional sort_order,active in any order.
 * Paste: selected-brand model lines OR Brand,Model; colours are Name #RRGGBB.
 * Existing includes inactive references and never requests an update. Near rows
 * are NOT implicitly insertable: callers must require explicit acknowledgement.
 */
export function planSharedImport(rawInput: SharedInput, snapshot: SharedSnapshot): SharedPlan {
  const input = parseSharedInput(rawInput); // Enforce bounds even when callers skip the parser.
  const source = sourceRows(input);
  const rows: SharedRow[] = source.map(item => {
    const value = item.values;
    const row: SharedRow = {
      row: item.row, status: 'new', name: (value[input.kind === 'models' ? 'model' : 'name'] ?? '').trim(),
      sortOrder: 0, isActive: true, reason: 'New entry.', suggestions: [],
    };
    if (input.kind === 'colours') row.hex = (value.hex ?? '').trim().toUpperCase();
    if (item.cells.some(formulaLike)) { invalid(row, 'Formula-looking values are not allowed in any cell.'); return row; }
    if (item.cells.some(cell => CONTROLS.test(cell))) { invalid(row, 'Control or invisible formatting characters are not allowed in cells.'); return row; }
    if (item.error) { invalid(row, item.error); return row; }
    const maximum = input.kind === 'models' ? 120 : 100;
    if (!row.name || row.name.length > maximum || !normalizeSharedName(row.name)) {
      invalid(row, `Name must contain a letter or number and be at most ${maximum} characters.`); return row;
    }
    const order = value.sort_order?.trim() ?? '';
    if (order && (!/^\d+$/.test(order) || Number(order) > 9999)) {
      invalid(row, 'sort_order must be an integer from 0 to 9999.'); return row;
    }
    row.sortOrder = order ? Number(order) : 0;
    const active = value.active?.trim().toLowerCase() ?? '';
    if (active && !['true', 'false', '1', '0', 'yes', 'no', 'active', 'inactive'].includes(active)) {
      invalid(row, 'active must be true/false, 1/0, yes/no or active/inactive.'); return row;
    }
    row.isActive = !['false', '0', 'no', 'inactive'].includes(active);
    if (input.kind === 'colours') {
      if (!/^#[0-9A-F]{6}$/.test(row.hex!)) invalid(row, 'Hex must be exactly #RRGGBB.');
    } else {
      const brandName = value.brand?.trim();
      const brands = brandName === undefined ? [] : snapshot.brands.filter(brand => normalizeSharedName(brand.name) === normalizeSharedName(brandName));
      const selected = input.brandId === undefined ? undefined : snapshot.brands.find(brand => brand.id === input.brandId);
      if (input.brandId !== undefined && !selected) invalid(row, 'Selected brand is unknown; add the brand explicitly before importing.');
      else if (brandName !== undefined && brands.length !== 1) invalid(row, brands.length ? 'Brand name is ambiguous; resolve catalogue collisions first.' : 'Brand is unknown; add the brand explicitly before importing.');
      else if (selected && brandName !== undefined && brands[0].id !== selected.id) invalid(row, 'CSV brand does not match the selected brand.');
      else {
        row.brandId = selected?.id ?? brands[0]?.id;
        if (!row.brandId) invalid(row, 'Choose a brand or provide Brand,Model paste lines.');
      }
    }
    return row;
  });

  // Name/hex disagreements invalidate ALL participating input rows, never first-wins.
  if (input.kind === 'colours') {
    const valid = rows.filter(row => row.status !== 'invalid');
    const names = new Map<string, Set<string>>(); const hexes = new Map<string, Set<string>>();
    for (const row of valid) {
      const name = normalizeSharedName(row.name); const hex = row.hex!;
      if (!names.has(name)) names.set(name, new Set()); names.get(name)!.add(hex);
      if (!hexes.has(hex)) hexes.set(hex, new Set()); hexes.get(hex)!.add(name);
    }
    for (const row of valid) if (names.get(normalizeSharedName(row.name))!.size > 1 || hexes.get(row.hex!)!.size > 1) {
      invalid(row, 'Input colour name and hex conflict; resolve the disagreement before importing.');
    }
  }

  const seen = new Map<string, number>();
  const proposed: NearCandidate[] = [];
  const references = input.kind === 'models' ? snapshot.models : snapshot.colours;
  const referenceCandidates = references.map(nearCandidate);
  for (const row of rows) {
    if (row.status === 'invalid') continue;
    const key = normalizeSharedName(row.name);
    const identity = JSON.stringify([row.brandId ?? '', key]);
    const repeated = seen.get(identity);
    if (repeated !== undefined) { invalid(row, `Duplicate input entry; already represented by record ${repeated}.`); continue; }
    seen.set(identity, row.row);
    const scoped = references.filter(reference => input.kind !== 'models' || reference.brandId === row.brandId);
    const sameName = scoped.filter(reference => normalizeSharedName(reference.name) === key);
    const sameHex = input.kind === 'colours' ? scoped.filter(reference => reference.hex?.toUpperCase() === row.hex) : [];
    if (sameName.length > 1 || sameHex.length > 1) {
      invalid(row, 'Catalogue has ambiguous normalized names or hex values; resolve collisions first.'); continue;
    }
    if (input.kind === 'colours' && ((sameName.length && sameName[0].hex?.toUpperCase() !== row.hex)
        || (sameHex.length && normalizeSharedName(sameHex[0].name) !== key))) {
      invalid(row, 'Colour name and hex conflict with an existing entry; no changes will be made.'); continue;
    }
    if (sameName.length) {
      row.status = 'existing';
      row.reason = sameName[0].isActive ? 'Already in the list; existing values are unchanged.' : 'Already in the list (inactive); existing values are unchanged.';
      continue;
    }
    if (input.kind === 'models' && !snapshot.brands.find(brand => brand.id === row.brandId)?.isActive) {
      invalid(row, 'New models require an active brand.'); continue;
    }
    const candidates = [...referenceCandidates.filter(reference => input.kind !== 'models' || reference.brandId === row.brandId),
      ...proposed.filter(reference => reference.brandId === row.brandId)];
    row.suggestions = nearSuggestions(key, candidates);
    if (row.suggestions.length) {
      row.status = 'near'; row.reason = 'Similar names exist; explicit acknowledgement is required before creating this entry.';
    }
    proposed.push({ id: `input:${row.row}`, name: row.name, brandId: row.brandId,
      key, characters: Array.from(key) });
  }
  const counts: SharedPlan['counts'] = { new: 0, existing: 0, near: 0, invalid: 0 };
  for (const row of rows) counts[row.status]++;
  return { rows, counts };
}

/** Safe spreadsheet CSV; protect formulas AFTER leading whitespace/control characters. */
export function safeSharedCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    const safe = formulaLike(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}

/** Header-only templates; never seed real brands, models or colours. */
export function sharedTemplate(kind: SharedKind): string {
  if (kind !== 'models' && kind !== 'colours') throw new SharedListError('Select models or colours.');
  return safeSharedCsv([[...HEADERS[kind], ...OPTIONAL_HEADERS]]);
}
