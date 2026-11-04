import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { parseProductDescription, type ProductDescriptionSection } from '@/lib/catalog/product-description';
import { writeAudit } from './audit';

type Client = NonNullable<ReturnType<typeof getSql>> | TransactionSql;
export class ProductContentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type ProductContentPatch = { shortDescription?: string | null; descriptionSections?: ProductDescriptionSection[] | null };
export type ProductContentSource = 'product_draft' | 'csv_import' | 'restore' | 'backfill' | 'duplicate';
export type ProductContentOptions = { source?: ProductContentSource; request?: Request; expectedRevision?: string | null };
export type ProductContentSnapshot = {
  shortDescription: unknown;
  descriptionSections: unknown;
  legacyFallback: { description: unknown; highlights: unknown; inTheBox: unknown };
};
const sources = new Set<ProductContentSource>(['product_draft', 'csv_import', 'restore', 'backfill', 'duplicate']);
// JSONB object key order is not semantic; array order and null versus [] are.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
function snapshot(row: Record<string, unknown>): ProductContentSnapshot {
  // Deliberately do not parse the old value: malformed historic JSON must remain recoverable.
  return { shortDescription: row.short_description ?? null, descriptionSections: row.description_sections ?? null,
    legacyFallback: { description: row.description, highlights: row.highlights, inTheBox: row.in_the_box } };
}
function validatePatch(patch: ProductContentPatch): ProductContentPatch {
  try {
    const parsed = parseProductDescription({ shortDescription: patch.shortDescription ?? null, sections: patch.descriptionSections ?? null });
    return { ...(patch.shortDescription !== undefined ? { shortDescription: parsed.shortDescription } : {}),
      ...(patch.descriptionSections !== undefined ? { descriptionSections: parsed.sections } : {}) };
  } catch { throw new ProductContentError('Invalid product description.'); }
}
async function latestRevision(sql: Client, productId: string): Promise<string | null> {
  const [row] = await sql`select id from product_content_revisions where product_id=${productId} order by revision_number desc limit 1`;
  return row ? String(row.id) : null;
}
async function lockedProduct(tx: TransactionSql, productId: string) {
  const [row] = await tx`select short_description,description_sections,description,highlights,in_the_box from products where id=${productId} and deleted_at is null for update`;
  if (!row) throw new ProductContentError('Product not found.', 404);
  return row;
}
async function assertExpected(tx: TransactionSql, productId: string, options: ProductContentOptions) {
  const revisionId = await latestRevision(tx, productId);
  if (options.expectedRevision !== undefined && options.expectedRevision !== revisionId) throw new ProductContentError('Product content has changed. Reload its history before restoring.', 409);
  return revisionId;
}
async function persist(tx: TransactionSql, productId: string, before: ProductContentSnapshot, after: ProductContentSnapshot, staffId: string, options: ProductContentOptions, currentRevision: string | null, restoredFromId: string | null = null) {
  if (equal(before, after)) return { changed: false, revisionId: currentRevision };
  // Refuse oversized historical data rather than truncate recovery evidence.
  if(Buffer.byteLength(JSON.stringify(before),'utf8')>1_048_576||Buffer.byteLength(JSON.stringify(after),'utf8')>1_048_576)throw new ProductContentError('Product content exceeds the revision snapshot limit. Review it before saving.');
  const source = options.source ?? 'product_draft';
  if (!sources.has(source)) throw new ProductContentError('Invalid content revision source.');
  const revisionId = randomUUID();
  await tx`update products set short_description=${after.shortDescription as string | null},description_sections=${after.descriptionSections === null ? null : tx.json(after.descriptionSections as Parameters<typeof tx.json>[0])},updated_at=now(),updated_by=${staffId} where id=${productId}`;
  await tx`insert into product_content_revisions(id,product_id,actor_id,source,before_snapshot,after_snapshot,restored_from_id)
    values(${revisionId},${productId},${staffId},${source},${tx.json(before as unknown as Parameters<typeof tx.json>[0])},${tx.json(after as unknown as Parameters<typeof tx.json>[0])},${restoredFromId})`;
  // Do not duplicate prose (or arbitrary section IDs) into the general audit log.
  if (!await writeAudit({ actorId: staffId, action: restoredFromId ? 'catalog.product.content.restore' : 'catalog.product.content.write', entity: 'product', entityId: productId,
    before: { revisionId: currentRevision }, after: { revisionId, restoredFromId, sectionCount: Array.isArray(after.descriptionSections) ? after.descriptionSections.length : null }, request: options.request }, tx)) {
    throw new ProductContentError('The change was rolled back because its audit could not be saved.', 503);
  }
  return { changed: true, revisionId };
}
/** Caller owns the transaction. Call before directly altering canonical content. */
export async function writeProductContentUsing(tx: TransactionSql, productId: string, patch: ProductContentPatch, staffId: string, options: ProductContentOptions = {}) {
  const parsed = validatePatch(patch);
  const row = await lockedProduct(tx, productId);
  const currentRevision = await assertExpected(tx, productId, options);
  const before = snapshot(row);
  const after = { ...before, ...parsed };
  return persist(tx, productId, before, after, staffId, options, currentRevision);
}
export async function productContentHistoryUsing(sql: Client, productId: string, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProductContentError('Invalid history limit.');
  const [product] = await sql`select id from products where id=${productId} and deleted_at is null`;
  if (!product) throw new ProductContentError('Product not found.', 404);
  // Intentionally no joins to staff identities and no public loader/export wiring.
  const revisions = await sql`select id,actor_id,source,before_snapshot,after_snapshot,restored_from_id,created_at from product_content_revisions where product_id=${productId} order by revision_number desc limit ${limit}`;
  return { revisions, latestRevision: revisions.length ? String(revisions[0].id) : null };
}
export async function productContentHistory(productId: string, limit = 50) {
  const sql = getSql();
  if (!sql) throw new ProductContentError('Catalogue database is unavailable.', 503);
  return sql.begin('isolation level repeatable read read only', tx => productContentHistoryUsing(tx, productId, limit));
}
/** Restores canonical fields only and appends history; old revisions are never edited.
 * legacyFallback is private forensic/reference evidence for manual recovery, NOT
 * automatically restored: legacy marketing remains owned by its existing workflows.
 */
export async function restoreProductContentUsing(tx: TransactionSql, productId: string, revisionId: string, staffId: string, options: Omit<ProductContentOptions, 'source'> & { snapshot?: 'before' | 'after' } = {}) {
  const row = await lockedProduct(tx, productId);
  const currentRevision = await assertExpected(tx, productId, options);
  const [revision] = await tx`select before_snapshot,after_snapshot from product_content_revisions where id=${revisionId} and product_id=${productId}`;
  if (!revision) throw new ProductContentError('Content revision not found.', 404);
  const raw: unknown = options.snapshot === 'before' ? revision.before_snapshot : revision.after_snapshot;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProductContentError('Stored content snapshot is invalid.');
  const target = raw as Record<string, unknown>;
  if (!Object.hasOwn(target, 'shortDescription') || !Object.hasOwn(target, 'descriptionSections')) throw new ProductContentError('Stored content snapshot is incomplete.');
  const parsed = validatePatch({ shortDescription: target.shortDescription as string | null, descriptionSections: target.descriptionSections as ProductDescriptionSection[] | null });
  if (!equal(parsed.shortDescription, target.shortDescription) || !equal(parsed.descriptionSections, target.descriptionSections)) throw new ProductContentError('Stored content snapshot requires review before it can be restored.');
  const before = snapshot(row);
  return persist(tx, productId, before, { ...before, ...parsed }, staffId, { ...options, source: 'restore' }, currentRevision, revisionId);
}
export async function restoreProductContent(productId: string, revisionId: string, staffId: string, options: Omit<ProductContentOptions, 'source'> & { snapshot?: 'before' | 'after' } = {}) {
  const sql = getSql();
  if (!sql) throw new ProductContentError('Catalogue database is unavailable.', 503);
  return sql.begin(tx => restoreProductContentUsing(tx, productId, revisionId, staffId, options));
}
