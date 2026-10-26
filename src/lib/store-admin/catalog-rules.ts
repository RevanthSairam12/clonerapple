/**
 * Pure validation rules for store-admin catalogue editing.
 *
 * Kept free of database and React imports so `node --test` can exercise it
 * directly. Every write path validates here first; the SQL layer assumes the
 * input already has the right shape.
 *
 * PRICE IS NOT AN EDITABLE FIELD. `AGENTS.md` keeps price editing disabled
 * until the PayU flow reads prices from the database, and checkout still reads
 * the code catalogue. Sending `price_paise` is not ignored — it is rejected,
 * so a caller cannot believe the price changed when it did not.
 */

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PRODUCT_EDITABLE_FIELDS = [
  'name',
  'subtitle',
  'description',
  'badge',
  'material',
  'brand_id',
  'condition_id',
  'category_id',
  'seo_title',
  'seo_description',
  'is_active',
  'in_stock',
  'sort_order',
  // Internal unit cost. This is not the selling price: it never reaches the
  // storefront and does not go through the price history.
  'cost_paise',
] as const;

export type ProductEditableField = (typeof PRODUCT_EDITABLE_FIELDS)[number];

export interface ProductPatch {
  name?: string;
  subtitle?: string;
  description?: string;
  badge?: string | null;
  material?: string;
  brand_id?: string | null;
  condition_id?: string | null;
  category_id?: string;
  seo_title?: string;
  seo_description?: string;
  is_active?: boolean;
  in_stock?: boolean;
  sort_order?: number;
  cost_paise?: number | null;
}

/** ₹10,00,00,000 in paise — a cost above this is almost certainly a typo. */
export const PRODUCT_COST_MAX_PAISE = 100_000_000_00;

const PRICE_FIELDS = new Set([
  'price_paise',
  'compare_at_paise',
  'pricePaise',
  'compareAtPaise',
  'price',
  'currency',
]);

const MAX_LENGTHS: Record<string, number> = {
  name: 120,
  subtitle: 160,
  description: 5000,
  badge: 40,
  material: 60,
  brand_id: 64,
  category_id: 64,
  seo_title: 120,
  seo_description: 320,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a partial product update. Unknown keys are rejected rather than
 * dropped: a typo in a field name should not look like a successful save.
 */
export function validateProductPatch(input: unknown): FieldResult<ProductPatch> {
  if (!isRecord(input)) return { ok: false, error: 'Send a JSON object of fields to change.' };

  const keys = Object.keys(input);
  if (keys.length === 0) return { ok: false, error: 'No fields to change.' };

  for (const key of keys) {
    if (PRICE_FIELDS.has(key)) {
      return {
        ok: false,
        error:
          'The price cannot be edited here: checkout still prices from the code catalogue.',
      };
    }
    if (!(PRODUCT_EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `'${key}' is not an editable product field.` };
    }
  }

  const patch: ProductPatch = {};

  for (const key of keys) {
    const raw = input[key];

    if (key === 'is_active' || key === 'in_stock') {
      if (typeof raw !== 'boolean') {
        return { ok: false, error: `'${key}' must be true or false.` };
      }
      if (key === 'is_active') patch.is_active = raw;
      else patch.in_stock = raw;
      continue;
    }

    if (key === 'sort_order') {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 100000) {
        return { ok: false, error: 'Sort order must be a whole number between 0 and 100000.' };
      }
      patch.sort_order = value;
      continue;
    }

    // Cost is entered as integer paise by the editor; an empty value clears it.
    if (key === 'cost_paise') {
      if (raw === null || raw === undefined || raw === '') {
        patch.cost_paise = null;
        continue;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > PRODUCT_COST_MAX_PAISE) {
        return { ok: false, error: 'Unit cost must be a whole number of paise, zero or more.' };
      }
      patch.cost_paise = value;
      continue;
    }

    // badge and brand_id are nullable text.
    if (raw === null) {
      if (key === 'badge') patch.badge = null;
      else if (key === 'brand_id') patch.brand_id = null;
      else if (key === 'condition_id') patch.condition_id = null;
      else return { ok: false, error: `'${key}' cannot be empty.` };
      continue;
    }

    if (typeof raw !== 'string') {
      return { ok: false, error: `'${key}' must be text.` };
    }

    const trimmed = raw.trim();
    const limit = MAX_LENGTHS[key] ?? 200;
    if (trimmed.length > limit) {
      return { ok: false, error: `'${key}' must be ${limit} characters or fewer.` };
    }

    // Empty strings become null only where the column is nullable.
    if (key === 'badge') {
      patch.badge = trimmed || null;
      continue;
    }
    if (key === 'brand_id') {
      patch.brand_id = trimmed || null;
      continue;
    }
    if (key === 'condition_id') {
      patch.condition_id = trimmed || null;
      continue;
    }
    if (!trimmed) {
      return { ok: false, error: `'${key}' cannot be empty.` };
    }

    switch (key) {
      case 'name':
        patch.name = trimmed;
        break;
      case 'subtitle':
        patch.subtitle = trimmed;
        break;
      case 'description':
        patch.description = trimmed;
        break;
      case 'material':
        patch.material = trimmed;
        break;
      case 'category_id':
        patch.category_id = trimmed;
        break;
      case 'seo_title':
        patch.seo_title = trimmed;
        break;
      case 'seo_description':
        patch.seo_description = trimmed;
        break;
      default:
        return { ok: false, error: `'${key}' is not an editable product field.` };
    }
  }

  return { ok: true, value: patch };
}

/* ------------------------------------------------------------- images */

export const IMAGE_ROLES = ['primary', 'hover', 'gallery'] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

export interface ProductImageInput {
  url: string;
  alt: string;
  role: ImageRole;
  sort_order: number;
}

export function validateImageRole(value: unknown): value is ImageRole {
  return typeof value === 'string' && (IMAGE_ROLES as readonly string[]).includes(value);
}

/**
 * Image URLs are either a site-absolute path (`/sites/...`) or an https URL.
 * A bare `javascript:` or protocol-relative value is refused: the value is
 * rendered straight into an <img src>.
 */
export function validateProductImageInput(input: unknown): FieldResult<ProductImageInput> {
  if (!isRecord(input)) return { ok: false, error: 'Send a JSON object describing the image.' };

  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (!rawUrl) return { ok: false, error: 'An image URL is required.' };
  if (rawUrl.length > 500) return { ok: false, error: 'The image URL is too long.' };
  const isLocal = rawUrl.startsWith('/') && !rawUrl.startsWith('//');
  const isHttps = /^https:\/\/[^\s]+$/i.test(rawUrl);
  if (!isLocal && !isHttps) {
    return { ok: false, error: 'Use a path starting with / or an https:// URL.' };
  }

  const alt = typeof input.alt === 'string' ? input.alt.trim() : '';
  if (alt.length > 200) return { ok: false, error: 'Alt text must be 200 characters or fewer.' };

  const role = input.role ?? 'gallery';
  if (!validateImageRole(role)) {
    return { ok: false, error: 'Role must be primary, hover or gallery.' };
  }

  const sortOrder = input.sort_order === undefined ? 0 : Number(input.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    return { ok: false, error: 'Sort order must be a whole number between 0 and 10000.' };
  }

  return { ok: true, value: { url: rawUrl, alt, role, sort_order: sortOrder } };
}

/* ------------------------------------------------------------- brands */

export interface BrandInput {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string;
  is_active: boolean;
  sort_order: number;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function validateBrandInput(input: unknown, existingId?: string): FieldResult<BrandInput> {
  if (!isRecord(input)) return { ok: false, error: 'Send a JSON object describing the brand.' };

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'A brand name is required.' };
  if (name.length > 120) return { ok: false, error: 'The brand name must be 120 characters or fewer.' };

  const rawId = typeof input.id === 'string' ? input.id.trim() : existingId ?? '';
  const id = rawId || slugify(name);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    return {
      ok: false,
      error: 'The brand id must be lowercase letters, digits and hyphens (max 64 characters).',
    };
  }

  const rawSlug = typeof input.slug === 'string' ? input.slug.trim() : '';
  const slug = rawSlug || slugify(name) || id;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return { ok: false, error: 'The slug must be lowercase letters, digits and hyphens.' };
  }

  const rawLogo = typeof input.logo_url === 'string' ? input.logo_url.trim() : '';
  if (rawLogo.length > 500) return { ok: false, error: 'The logo URL is too long.' };
  if (rawLogo && !(rawLogo.startsWith('/') && !rawLogo.startsWith('//')) && !/^https:\/\//i.test(rawLogo)) {
    return { ok: false, error: 'Use a logo path starting with / or an https:// URL.' };
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 1000) {
    return { ok: false, error: 'The description must be 1000 characters or fewer.' };
  }

  const isActive = input.is_active === undefined ? true : input.is_active;
  if (typeof isActive !== 'boolean') return { ok: false, error: "'is_active' must be true or false." };

  const sortOrder = input.sort_order === undefined ? 0 : Number(input.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    return { ok: false, error: 'Sort order must be a whole number between 0 and 100000.' };
  }

  return {
    ok: true,
    value: {
      id,
      name,
      slug,
      logo_url: rawLogo || null,
      description,
      is_active: isActive,
      sort_order: sortOrder,
    },
  };
}

/* -------------------------------------------------------------- units */

export const UNIT_DIMENSIONS = ['mass', 'volume', 'length', 'count'] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export interface UnitInput {
  id: string;
  code: string;
  label: string;
  dimension: UnitDimension;
  base_code: string | null;
  factor: number;
}

export function validateUnitInput(input: unknown): FieldResult<UnitInput> {
  if (!isRecord(input)) return { ok: false, error: 'Send a JSON object describing the unit.' };

  const code = typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
  if (!/^[a-z0-9._-]{1,16}$/.test(code)) {
    return { ok: false, error: 'A unit code is required (letters, digits, dot, dash, max 16).' };
  }

  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label) return { ok: false, error: 'A unit label is required.' };
  if (label.length > 40) return { ok: false, error: 'The label must be 40 characters or fewer.' };

  const dimension = input.dimension;
  if (typeof dimension !== 'string' || !(UNIT_DIMENSIONS as readonly string[]).includes(dimension)) {
    return { ok: false, error: 'Dimension must be mass, volume, length or count.' };
  }

  const rawBase = typeof input.base_code === 'string' ? input.base_code.trim().toLowerCase() : '';
  if (rawBase && !/^[a-z0-9._-]{1,16}$/.test(rawBase)) {
    return { ok: false, error: 'The base unit code is not valid.' };
  }

  const factor = input.factor === undefined ? 1 : Number(input.factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    return { ok: false, error: 'The conversion factor must be greater than zero.' };
  }

  return {
    ok: true,
    value: {
      id: code,
      code,
      label,
      dimension: dimension as UnitDimension,
      base_code: rawBase || null,
      factor,
    },
  };
}

/* --------------------------------------------------------- attributes */

export const ATTRIBUTE_DATA_TYPES = ['text', 'number', 'boolean', 'enum'] as const;
export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number];

export interface AttributeInput {
  id: string;
  key: string;
  label: string;
  data_type: AttributeDataType;
  unit_id: string | null;
  is_filterable: boolean;
  is_variant_option: boolean;
  sort_order: number;
}

export function validateAttributeInput(input: unknown): FieldResult<AttributeInput> {
  if (!isRecord(input)) return { ok: false, error: 'Send a JSON object describing the attribute.' };

  const key = typeof input.key === 'string' ? input.key.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_]{0,47}$/.test(key)) {
    return { ok: false, error: 'A key is required (lowercase letters, digits, underscore, max 48).' };
  }

  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label) return { ok: false, error: 'A label is required.' };
  if (label.length > 80) return { ok: false, error: 'The label must be 80 characters or fewer.' };

  const dataType = input.data_type;
  if (typeof dataType !== 'string' || !(ATTRIBUTE_DATA_TYPES as readonly string[]).includes(dataType)) {
    return { ok: false, error: 'Data type must be text, number, boolean or enum.' };
  }

  const rawUnit = typeof input.unit_id === 'string' ? input.unit_id.trim() : '';
  if (rawUnit && dataType !== 'number') {
    return { ok: false, error: 'Only a number attribute can carry a unit.' };
  }

  const isFilterable = input.is_filterable === undefined ? false : input.is_filterable;
  const isVariantOption = input.is_variant_option === undefined ? false : input.is_variant_option;
  if (typeof isFilterable !== 'boolean' || typeof isVariantOption !== 'boolean') {
    return { ok: false, error: 'Flags must be true or false.' };
  }

  const sortOrder = input.sort_order === undefined ? 0 : Number(input.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    return { ok: false, error: 'Sort order must be a whole number between 0 and 10000.' };
  }

  return {
    ok: true,
    value: {
      id: key,
      key,
      label,
      data_type: dataType as AttributeDataType,
      unit_id: rawUnit || null,
      is_filterable: isFilterable,
      is_variant_option: isVariantOption,
      sort_order: sortOrder,
    },
  };
}

export function validateAttributeOption(value: unknown): FieldResult<string> {
  const option = typeof value === 'string' ? value.trim() : '';
  if (!option) return { ok: false, error: 'An option value is required.' };
  if (option.length > 80) return { ok: false, error: 'The option must be 80 characters or fewer.' };
  return { ok: true, value: option };
}

export interface AttributeValueInput {
  attribute_id: string;
  value_text: string | null;
  value_number: number | null;
  value_bool: boolean | null;
  option_value: string | null;
}

/**
 * Shape a product's attribute value for the column that matches the
 * attribute's declared type. The caller passes the already-loaded type so the
 * rule stays pure.
 */
export function validateAttributeValue(
  dataType: AttributeDataType,
  input: unknown,
): FieldResult<Omit<AttributeValueInput, 'attribute_id'>> {
  const empty = { value_text: null, value_number: null, value_bool: null, option_value: null };

  if (dataType === 'boolean') {
    const value = isRecord(input) ? input.value : input;
    if (typeof value !== 'boolean') return { ok: false, error: 'This attribute takes true or false.' };
    return { ok: true, value: { ...empty, value_bool: value } };
  }

  if (dataType === 'number') {
    const value = isRecord(input) ? input.value : input;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return { ok: false, error: 'This attribute takes a number.' };
    return { ok: true, value: { ...empty, value_number: parsed } };
  }

  const value = isRecord(input) ? input.value : input;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return { ok: false, error: 'This attribute takes a value.' };
  if (trimmed.length > 200) return { ok: false, error: 'The value must be 200 characters or fewer.' };

  if (dataType === 'enum') return { ok: true, value: { ...empty, option_value: trimmed } };
  return { ok: true, value: { ...empty, value_text: trimmed } };
}

/* --------------------------------------------------------- low stock */

export interface LowStockRow {
  productId: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
}

/** A row is low when the available count has reached its threshold. */
export function isLowStock(onHand: number, reserved: number, threshold: number): boolean {
  return onHand - reserved <= threshold;
}
