import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { TransactionSql } from 'postgres';
import { getSql } from '@/lib/platform/db';
import { SharedListError, SHARED_IMPORT_MAX_ROWS, normalizeSharedName, sharedNearNames, parseSharedInput, planSharedImport, type SharedKind, type SharedReference, type SharedSnapshot } from '@/lib/catalog/shared-list-rules';
import { assertMetadataPublicationUsing, MetadataError, metadataGate, strictMetadataAudit } from './product-metadata';

type Client = TransactionSql | NonNullable<ReturnType<typeof getSql>>;
const previewKey = randomBytes(32); // Process-local: a restart requires a fresh preview, never a weaker approval.
const str = (v: unknown) => String(v ?? '');
function database() { const sql = getSql(); if (!sql) throw new SharedListError('The catalogue database is unavailable.', 503); return sql; }
export function sharedKind(raw: string): SharedKind { if (raw !== 'models' && raw !== 'colours') throw new SharedListError('Choose models or colours.'); return raw; }
export async function sharedSessionBinding(): Promise<string> {
  const token = (await cookies()).get('store_admin_session')?.value;
  if (!token) throw new SharedListError('Sign in again before previewing.', 401);
  return createHash('sha256').update(token).digest('hex');
}
export async function sharedSnapshotUsing(tx: Client): Promise<SharedSnapshot> {
  const brands = await tx`select id,name,is_active,sort_order from device_brands order by id`;
  const models = await tx`select d.id,d.name,d.brand_id,d.is_active,d.sort_order,b.is_active as brand_active from device_models d join device_brands b on b.id=d.brand_id order by d.id`;
  const colours = await tx`select id,name,hex,is_active,sort_order from colours order by id`;
  const map = (row: Record<string, unknown>): SharedReference => ({ id: str(row.id), name: str(row.name), isActive: Boolean(row.is_active), sortOrder: Number(row.sort_order), ...(row.brand_id == null ? {} : { brandId: str(row.brand_id) }), ...(row.hex == null ? {} : { hex: str(row.hex) }) });
  return { brands: brands.map(map), models: models.map(map), colours: colours.map(map) };
}
export async function loadSharedSnapshot(): Promise<SharedSnapshot> { return database().begin('isolation level repeatable read read only', sharedSnapshotUsing); }
async function targetUsing(tx: Client) { const [target] = await tx`select current_database() as database,current_schema() as schema,current_user as role`; return target; }
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sign(payload: string) { return createHmac('sha256', previewKey).update(payload).digest('base64url'); }
function issue(data: Record<string, unknown>) { const payload = Buffer.from(JSON.stringify({ ...data, expires: Date.now() + 10 * 60_000 })).toString('base64url'); return `${payload}.${sign(payload)}`; }
function verify(token: unknown): Record<string, unknown> {
  if (typeof token !== 'string' || token.length > 4096) throw new SharedListError('Generate a fresh preview before confirming.', 409);
  const [payload, signature, extra] = token.split('.');
  const expected = Buffer.from(sign(payload ?? ''));
  const supplied = Buffer.from(signature ?? '');
  if (extra || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new SharedListError('Generate a fresh preview before confirming.', 409);
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); if (typeof data.expires !== 'number' || data.expires < Date.now()) throw new Error(); return data; }
  catch { throw new SharedListError('This preview expired. Preview again before confirming.', 409); }
}
async function ownerUsing(tx: Client, staffId: string) {
  const [actor] = await tx`select id from store_admins where id=${staffId} and role='store_owner' and is_active for share`;
  if (!actor) throw new SharedListError('An active store owner must confirm this action.', 403);
}
export async function previewSharedImport(raw: unknown, actor: string, session: string) {
  return database().begin('isolation level repeatable read read only', tx => previewSharedImportUsing(tx, raw, actor, session));
}
/** Caller owns the transaction; never replaces the application pool. */
export async function previewSharedImportUsing(tx: Client, raw: unknown, actor: string, session: string) {
  const input = parseSharedInput(raw);
    const snapshot = await sharedSnapshotUsing(tx);
    const plan = planSharedImport(input, snapshot);
    // The confirmation is all new valid rows, never an arbitrary client subset.
    const selectedRows = plan.rows.filter(row => row.status === 'new' || row.status === 'near').map(row => row.row);
    const nearRows = plan.rows.filter(row => row.status === 'near').map(row => row.row);
    const token = issue({ version: 1, actor, session, input: digest(input), snapshot: digest(snapshot), selectedRows: digest(selectedRows), nearRows: digest(nearRows), target: digest(await targetUsing(tx)) });
    return { plan, token };
}
export async function applySharedImport(raw: unknown, token: unknown, acknowledgments: unknown, actor: string, session: string, request?: Request) {
  return database().begin(tx => applySharedImportUsing(tx, raw, token, acknowledgments, actor, session, request));
}
export async function applySharedImportUsing(tx: Client, raw: unknown, token: unknown, acknowledgments: unknown, actor: string, session: string, request?: Request) {
  const input = parseSharedInput(raw), approval = verify(token);
  if (!Array.isArray(acknowledgments) || acknowledgments.some(row => !Number.isSafeInteger(row) || row < 1) || acknowledgments.length > SHARED_IMPORT_MAX_ROWS) throw new SharedListError('Confirm the near-match rows explicitly.');
  if (approval.actor !== actor || approval.session !== session || approval.input !== digest(input) || approval.version !== 1) throw new SharedListError('The preview does not match this session or input.', 409);
    await tx`set local lock_timeout = '5s'`; await tx`set local statement_timeout = '15s'`;
    await metadataGate(tx); await ownerUsing(tx, actor);
    const snapshot = await sharedSnapshotUsing(tx);
    if (approval.snapshot !== digest(snapshot) || approval.target !== digest(await targetUsing(tx))) throw new SharedListError('The catalogue changed. Generate a fresh preview before confirming.', 409);
    const plan = planSharedImport(input, snapshot);
    const near = new Set(plan.rows.filter(row => row.status === 'near').map(row => row.row));
    if (acknowledgments.some(row => !near.has(row)) || [...near].some(row => !acknowledgments.includes(row))) throw new SharedListError('Review and acknowledge every near match before confirming.', 409);
    const inserts = plan.rows.filter(row => row.status === 'new' || row.status === 'near');
    if (approval.selectedRows !== digest(inserts.map(row => row.row)) || approval.nearRows !== digest([...near])) throw new SharedListError('The confirmed rows changed. Preview again.', 409);
    if (inserts.length && input.kind === 'models') {
      const records = inserts.map(row => ({ id: randomUUID(), brand_id: row.brandId!, name: row.name, is_active: row.isActive, sort_order: row.sortOrder }));
      await tx`insert into device_models ${tx(records, 'id', 'brand_id', 'name', 'is_active', 'sort_order')}`;
    } else if (inserts.length) {
      const records = inserts.map(row => ({ id: randomUUID(), name: row.name, hex: row.hex!, is_active: row.isActive, sort_order: row.sortOrder }));
      await tx`insert into colours ${tx(records, 'id', 'name', 'hex', 'is_active', 'sort_order')}`;
    }
    await strictMetadataAudit(tx, { actorId: actor, action: `catalog.shared.${input.kind}.import`, entity: input.kind, after: { created: inserts.length, existing: plan.counts.existing, invalid: plan.counts.invalid, acknowledged: near.size }, request });
    return { created: inserts.length, existing: plan.counts.existing, invalid: plan.counts.invalid, noop: inserts.length === 0 };
}
function validateReference(kind: SharedKind, raw: Record<string, unknown>, inline: boolean) {
  const allowed = new Set(inline ? ['name', 'confirmNearMatch', ...(kind === 'models' ? ['brandId'] : ['hex'])] : ['id','name','brandId','hex','sortOrder','isActive','confirmDeactivation','confirmNearMatch']);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new SharedListError('Only reference fields are accepted.');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > (kind === 'models' ? 120 : 100) || /[\p{Cc}\p{Cf}]/u.test(raw.name) || /^[\s\p{Cc}\p{Cf}]*[=+@-]/u.test(raw.name.normalize('NFKC')) || !normalizeSharedName(raw.name)) throw new SharedListError('Enter a plain name without spreadsheet formulas or control characters.');
  const sortOrder = inline ? 0 : raw.sortOrder ?? 0;
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new SharedListError('Sort order must be 0–9999.');
  if (!inline && raw.isActive !== undefined && typeof raw.isActive !== 'boolean') throw new SharedListError('Active must be true or false.');
  if (kind === 'colours' && (typeof raw.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.hex))) throw new SharedListError('Use a six-digit hex code, such as #123ABC.');
  return { name: raw.name.trim(), hex: kind === 'colours' ? str(raw.hex).toUpperCase() : undefined, brandId: kind === 'models' ? str(raw.brandId) : undefined, sortOrder, isActive: inline || raw.isActive !== false };
}
export async function saveSharedReference(kind: SharedKind, raw: Record<string, unknown>, actor: string, request: Request, inline = false): Promise<SharedReference> {
  return database().begin(tx => saveSharedReferenceUsing(tx, kind, raw, actor, request, inline));
}
export async function saveSharedReferenceUsing(tx: Client, kind: SharedKind, raw: Record<string, unknown>, actor: string, request: Request, inline = false): Promise<SharedReference> {
  const value = validateReference(kind, raw, inline);
    await metadataGate(tx);
    if (!inline) await ownerUsing(tx, actor);
    else { const [staff] = await tx`select id from store_admins where id=${actor} and is_active and role in ('store_owner','store_admin') for share`; if (!staff) throw new SharedListError('An active store administrator is required.', 403); }
    const snapshot = await sharedSnapshotUsing(tx);
    const refs = snapshot[kind];
    const old = typeof raw.id === 'string' ? refs.find(ref => ref.id === raw.id) : undefined;
    if (raw.id !== undefined && !old) throw new SharedListError('Reference not found.', 404);
    if (kind === 'models' && old && old.brandId !== value.brandId) throw new SharedListError('A saved model cannot move brands.');
    if (kind === 'models' && !snapshot.brands.some(brand => brand.id === value.brandId && (brand.isActive || (old?.brandId === brand.id && !value.isActive)))) throw new SharedListError('Choose an active existing device brand.');
    if (refs.some(ref => ref.id !== old?.id && ((normalizeSharedName(ref.name) === normalizeSharedName(value.name) && (kind !== 'models' || ref.brandId === value.brandId)) || (kind === 'colours' && ref.hex === value.hex)))) throw new SharedListError('This normalized name or hex is already in the list.', 409);
    // Renaming an inactive reference still needs duplicate review. An import
    // planner's active-brand rule applies to creation, not to an existing name.
    const suggestions = sharedNearNames(value.name, refs.filter(ref => ref.id !== old?.id
      && (kind !== 'models' || ref.brandId === value.brandId)));
    if (suggestions.length && raw.confirmNearMatch !== true) throw new SharedListError(`Did you mean ${suggestions.join(' or ')}? Review the suggestions and confirm Create as entered.`, 409);
    const id = old?.id ?? randomUUID();
    if (old?.isActive && !value.isActive && raw.confirmDeactivation !== true) throw new SharedListError('Review the products using this reference and confirm deactivation.', 409);
    if (old && old.name === value.name && old.hex === value.hex && old.brandId === value.brandId && old.sortOrder === value.sortOrder && old.isActive === value.isActive) return old;
    if (kind === 'models') {
      if (old) await tx`update device_models set name=${value.name},is_active=${value.isActive},sort_order=${value.sortOrder},updated_at=now() where id=${id}`;
      else await tx`insert into device_models(id,brand_id,name,is_active,sort_order) values(${id},${value.brandId!},${value.name},${value.isActive},${value.sortOrder})`;
    } else {
      if (old) await tx`update colours set name=${value.name},hex=${value.hex!},is_active=${value.isActive},sort_order=${value.sortOrder},updated_at=now() where id=${id}`;
      else await tx`insert into colours(id,name,hex,is_active,sort_order) values(${id},${value.name},${value.hex!},${value.isActive},${value.sortOrder})`;
    }
    if (kind === 'models' && old) {
      try { await assertMetadataPublicationUsing(tx); }
      catch (error) { if (error instanceof MetadataError) throw new SharedListError(error.message, 409); throw error; }
    }
    await strictMetadataAudit(tx, { actorId: actor, action: `catalog.shared.${kind}.${old ? 'save' : 'create'}`, entity: kind, entityId: id, before: old ? { id, isActive: old.isActive } : undefined, after: { id, isActive: value.isActive }, request });
    return { id, ...value };
}
export async function sharedUses(kind: SharedKind, id: string, cursor = '') {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || (cursor && !/^[a-zA-Z0-9_-]{1,160}\|[a-zA-Z0-9_-]{0,80}$/.test(cursor))) throw new SharedListError('Choose a valid reference and page.');
  const tx = database();
  const rows = kind === 'models' ? await tx`
    select p.id as product_id,p.name as product_name,v.id as variant_id,v.option_value as label,v.sku,coalesce(v.is_active,p.is_active) as active,
      p.id || '|' || coalesce(v.id,'') as cursor
    from products p left join product_variants v on v.product_id=p.id and v.device_model_id=${id}
    where p.deleted_at is null and (v.id is not null or exists(select 1 from product_device_models pm where pm.product_id=p.id and pm.device_model_id=${id} and pm.archived_at is null))
      and (p.id || '|' || coalesce(v.id,'')) > ${cursor} order by p.id || '|' || coalesce(v.id,'') limit 51
  ` : await tx`
    select p.id as product_id,p.name as product_name,v.id as variant_id,v.option_value as label,v.sku,v.is_active as active,p.id || '|' || v.id as cursor
    from product_variant_colours vc join product_variants v on v.id=vc.variant_id and v.product_id=vc.product_id join products p on p.id=vc.product_id
    where vc.colour_id=${id} and p.deleted_at is null and (p.id || '|' || v.id) > ${cursor} order by p.id || '|' || v.id limit 51
  `;
  return { rows: rows.slice(0,50).map(row => ({ productId: str(row.product_id), productName: str(row.product_name), variantId: row.variant_id == null ? undefined : str(row.variant_id), label: str(row.label), sku: row.sku == null ? undefined : str(row.sku), active: Boolean(row.active) })), nextCursor: rows.length > 50 ? str(rows[49].cursor) : null };
}
