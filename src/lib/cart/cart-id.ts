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

function matchKnownBase(value: string, knownBaseIds: readonly string[]): {
  baseId: string;
  suffix?: string;
} | null {
  const lowerValue = value.toLowerCase();
  const known = [...knownBaseIds]
    .map((id) => id.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const candidate of known) {
    const lowerCandidate = candidate.toLowerCase();
    if (lowerValue === lowerCandidate) return { baseId: candidate };
    for (const separator of ['-', '_']) {
      const prefix = `${lowerCandidate}${separator}`;
      if (lowerValue.startsWith(prefix)) {
        return {
          baseId: candidate,
          suffix: value.slice(candidate.length + separator.length).trim(),
        };
      }
    }
  }

  return null;
}

/**
 * Convert a persisted cart line id into the catalog id and display-only
 * variant metadata. The catalog ids remain authoritative; this helper never
 * creates or changes a price.
 */
export function normalizeCartLineId(
  value: unknown,
  knownBaseIds: readonly string[] = [],
): NormalizedCartLineId {
  const rawId = typeof value === 'string' ? value.trim() : '';
  if (!rawId) return { rawId: '', baseId: null };

  const compositeParts = rawId.split('::').map((part) => part.trim());
  const rawBase = compositeParts[0] || '';
  const knownMatch = matchKnownBase(rawBase, knownBaseIds);
  const baseId = knownMatch?.baseId ?? rawBase;
  const suffix = knownMatch?.suffix;
  const variantParts = (suffix ? [suffix] : compositeParts.slice(1))
    .map(cleanPart)
    .filter((part): part is string => Boolean(part));

  return {
    rawId,
    baseId: baseId || null,
    color: compositeParts.length > 1 ? cleanPart(compositeParts[1]) : undefined,
    model: compositeParts.length > 2 ? cleanPart(compositeParts[2]) : undefined,
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
