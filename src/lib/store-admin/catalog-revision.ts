/** Opaque edit token, bounded to PostgreSQL's non-negative integer range. */
export const MAX_CATALOG_REVISION = 2_147_483_647;

export class CatalogRevisionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: 'CATALOG_REVISION_INVALID' | 'CATALOG_REVISION_UNAVAILABLE' | 'CATALOG_REVISION_CONFLICT',
  ) {
    super(message);
    this.name = 'CatalogRevisionError';
  }
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= 0 && value <= MAX_CATALOG_REVISION;
}

/** JSON numbers only: never coerce null, strings, booleans or missing tokens. */
export function validateExpectedRevision(raw: unknown): number {
  if (!isRevision(raw)) {
    throw new CatalogRevisionError(
      'A valid expectedRevision is required. Reload the product and try again.',
      400,
      'CATALOG_REVISION_INVALID',
    );
  }
  return raw;
}

/** Fail closed when the migration/token is unavailable rather than inventing zero. */
export function readCatalogRevision(raw: unknown): number {
  if (!isRevision(raw)) {
    throw new CatalogRevisionError('Product edit revision is unavailable.', 503, 'CATALOG_REVISION_UNAVAILABLE');
  }
  return raw;
}

/**
 * Compare the row already locked by the caller in the write transaction.
 * This pure helper deliberately does not acquire locks, open SQL or load env.
 */
export function assertCatalogRevision(
  lockedProduct: { catalog_revision: unknown },
  expectedRevision: number,
): void {
  const expected = validateExpectedRevision(expectedRevision);
  const current = readCatalogRevision(lockedProduct.catalog_revision);
  if (current !== expected) {
    throw new CatalogRevisionError(
      'This product changed after you opened it. Reload before saving your changes.',
      409,
      'CATALOG_REVISION_CONFLICT',
    );
  }
}
