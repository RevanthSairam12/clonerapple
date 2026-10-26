export interface NormalizedCartLineId {
  rawId: string;
  baseId: string | null;
  color?: string;
  model?: string;
  variantLabel?: string;
}

export interface CartLineVariantInput {
  productId: string;
  color?: string;
  model?: string;
}

function cleanPart(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

/**
 * Find a known catalogue id by exact, case-insensitive equality.
 *
 * Deliberately no prefix/suffix matching. An id such as `id-extra` or `id_`
 * is a different id from `id`, not a variant of it; treating it as one would
 * let a stale or malformed cart line be priced as a live product.
 */
function matchKnownBase(value: string, knownBaseIds: readonly string[]): string | null {
  const lowerValue = value.toLowerCase();

  for (const candidate of knownBaseIds) {
    const trimmed = candidate.trim();
    if (trimmed && trimmed.toLowerCase() === lowerValue) return trimmed;
  }

  return null;
}

/**
 * Convert a persisted cart line id into the catalogue id and display-only
 * variant metadata. The base id only resolves when it exactly matches a known
 * catalogue id; an unknown base is returned as `null`. Colour and model are
 * kept as separate display fields and never influence pricing.
 */
export function normalizeCartLineId(
  value: unknown,
  knownBaseIds: readonly string[] = [],
): NormalizedCartLineId {
  const rawId = typeof value === 'string' ? value.trim() : '';
  if (!rawId) return { rawId: '', baseId: null };

  const compositeParts = rawId.split('::').map((part) => part.trim());
  const rawBase = (compositeParts[0] || '').toLowerCase();
  const color = cleanPart(compositeParts[1]);
  const model = cleanPart(compositeParts[2]);
  const variantParts = [color, model].filter((part): part is string => Boolean(part));

  if (!rawBase) {
    return {
      rawId,
      baseId: null,
      color,
      model,
      variantLabel: variantParts.length > 0 ? variantParts.join(' • ') : undefined,
    };
  }

  // With a catalogue to check against, anything that is not an exact id is
  // unknown. Without one, the lowercased base is returned so cart building can
  // form a stable line id; callers that care about availability pass a
  // catalogue.
  const baseId = knownBaseIds.length > 0 ? matchKnownBase(rawBase, knownBaseIds) : rawBase;

  return {
    rawId,
    baseId,
    color,
    model,
    variantLabel: variantParts.length > 0 ? variantParts.join(' • ') : undefined,
  };
}

export function buildCartLineId(input: CartLineVariantInput): string {
  const productId = normalizeCartLineId(input.productId).baseId?.toLowerCase();
  if (!productId) return '';
  return `${productId}::${input.color?.trim() || ''}::${input.model?.trim() || ''}`;
}

export function getCartLineBaseId(value: unknown): string | null {
  return normalizeCartLineId(value).baseId;
}
