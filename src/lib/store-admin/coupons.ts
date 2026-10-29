import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { getSql } from '@/lib/admin/db';
import { generateCouponCode } from '@/lib/coupons/codes';

import { formatPaise } from './amount';
import { maskEmail } from './audit';
import type { CatalogWrite } from './catalog-writes';
import type { CouponValues } from './coupon-rules';
import { couponListBadge, type CouponBadge } from './coupon-rules';

type Tx = postgres.TransactionSql;
/** Anything that can run a tagged query: the pool or one transaction. */
type Queryable = postgres.ISql;
type Row = Record<string, unknown>;

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Coupons are read and written on the server only.');
}

const PAGE_SIZE = 25;
const MAX_BULK = 500;
const USAGE_LOG_LIMIT = 250;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.map(String).filter(Boolean);
  return list.length > 0 ? list : null;
}

function fail(
  reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict',
  error: string,
): { ok: false; reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict'; error: string } {
  return { ok: false, reason, error };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '23505'
  );
}

function newCouponId(): string {
  return `cpn_${randomBytes(6).toString('hex')}`;
}

/* ---------------------------------------------------------------- types */

export interface CouponTargetView {
  productId: string | null;
  categoryId: string | null;
  brandId: string | null;
  label: string;
}

export interface CouponAdminRow {
  id: string;
  code: string;
  name: string;
  description: string;
  type: string;
  value: number;
  scope: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  totalRedemptionLimit: number | null;
  perCustomerLimit: number | null;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  onlyNewCustomers: boolean;
  allowWithSalePrice: boolean;
  allowedCustomerGroups: string[] | null;
  restrictedToEmails: string[] | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  used: number;
  targetCount: number;
  badge: CouponBadge;
}

export interface CouponUsageEntry {
  id: number;
  orderNumber: string;
  txnid: string;
  customer: string;
  discountPaise: number;
  orderTotalPaise: number;
  state: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  createdAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
}

export interface CouponUsageTotals {
  used: number;
  reserved: number;
  consumed: number;
  released: number;
  totalDiscountPaise: number;
  revenuePaise: number;
}

export interface CouponDetail {
  coupon: CouponAdminRow;
  targets: CouponTargetView[];
  usage: CouponUsageEntry[];
  totals: CouponUsageTotals;
}

export interface CouponListFilters {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface CouponListPage {
  rows: CouponAdminRow[];
  total: number;
  page: number;
  pageSize: number;
}

/* ---------------------------------------------------------------- mappers */

function mapRow(row: Row): CouponAdminRow {
  const used = number(row.used);
  const totalLimit = nullableNumber(row.total_redemption_limit);
  return {
    id: text(row.id),
    code: text(row.code),
    name: text(row.name),
    description: text(row.description),
    type: text(row.type),
    value: number(row.value),
    scope: text(row.scope),
    status: text(row.status),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    totalRedemptionLimit: totalLimit,
    perCustomerLimit: nullableNumber(row.per_customer_limit),
    minOrderPaise: number(row.min_order_paise),
    maxDiscountPaise: nullableNumber(row.max_discount_paise),
    onlyNewCustomers: row.only_new_customers === true,
    allowWithSalePrice: row.allow_with_sale_price === true,
    allowedCustomerGroups: stringArray(row.allowed_customer_groups),
    restrictedToEmails: stringArray(row.restricted_to_emails),
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
    archivedAt: iso(row.archived_at),
    used,
    targetCount: number(row.target_count),
    badge: couponListBadge({
      status: text(row.status),
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      used,
      totalLimit,
    }),
  };
}

/* ---------------------------------------------------------------- reads */

/** A search term is matched as a literal, never as a LIKE pattern. */
function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * Coupons with their live use count, newest first.
 *
 * The derived states (Scheduled, Expired, Used up) are computed on the
 * database clock, so the list cannot disagree with checkout about whether a
 * coupon is currently usable.
 */
export async function listCoupons(
  filters: CouponListFilters = {},
): Promise<CatalogWrite<CouponListPage>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  const search = (filters.search ?? '').trim();
  const status = (filters.status ?? 'all').trim().toLowerCase();
  const pageSize = Math.min(2000, Math.max(1, filters.pageSize ?? PAGE_SIZE));
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const offset = (page - 1) * pageSize;

  try {
    const rows = (await sql`
      with usage as (
        select coupon_id,
               count(*) filter (where state in ('RESERVED', 'CONSUMED'))::int as used
        from coupon_redemptions
        group by coupon_id
      )
      select c.*,
             coalesce(u.used, 0)::int as used,
             (select count(*) from coupon_targets t where t.coupon_id = c.id)::int
               as target_count
      from coupons c
      left join usage u on u.coupon_id = c.id
      where case ${status}
              when 'active' then (
                c.status = 'active'
                and (c.starts_at is null or c.starts_at <= now())
                and (c.ends_at is null or c.ends_at > now())
                and (c.total_redemption_limit is null
                     or coalesce(u.used, 0) < c.total_redemption_limit)
              )
              when 'scheduled' then (
                c.status = 'active'
                and c.starts_at is not null
                and c.starts_at > now()
              )
              when 'expired' then (
                c.status = 'active'
                and c.ends_at is not null
                and c.ends_at <= now()
              )
              when 'used-up' then (
                c.status = 'active'
                and c.total_redemption_limit is not null
                and coalesce(u.used, 0) >= c.total_redemption_limit
              )
              when 'paused' then c.status = 'paused'
              when 'archived' then c.status = 'archived'
              else true
            end
        and (
          ${search} = ''
          or upper(c.code) like ${likeTerm(search.toUpperCase())}
          or c.name ilike ${likeTerm(search)}
        )
      order by c.created_at desc, c.id desc
      limit ${pageSize} offset ${offset}
    `) as Row[];

    const counted = (await sql`
      with usage as (
        select coupon_id,
               count(*) filter (where state in ('RESERVED', 'CONSUMED'))::int as used
        from coupon_redemptions
        group by coupon_id
      )
      select count(*)::int as total
      from coupons c
      left join usage u on u.coupon_id = c.id
      where case ${status}
              when 'active' then (
                c.status = 'active'
                and (c.starts_at is null or c.starts_at <= now())
                and (c.ends_at is null or c.ends_at > now())
                and (c.total_redemption_limit is null
                     or coalesce(u.used, 0) < c.total_redemption_limit)
              )
              when 'scheduled' then (
                c.status = 'active'
                and c.starts_at is not null
                and c.starts_at > now()
              )
              when 'expired' then (
                c.status = 'active'
                and c.ends_at is not null
                and c.ends_at <= now()
              )
              when 'used-up' then (
                c.status = 'active'
                and c.total_redemption_limit is not null
                and coalesce(u.used, 0) >= c.total_redemption_limit
              )
              when 'paused' then c.status = 'paused'
              when 'archived' then c.status = 'archived'
              else true
            end
        and (
          ${search} = ''
          or upper(c.code) like ${likeTerm(search.toUpperCase())}
          or c.name ilike ${likeTerm(search)}
        )
    `) as Row[];

    return {
      ok: true,
      data: {
        rows: rows.map(mapRow),
        total: number(counted[0]?.total),
        page,
        pageSize,
      },
    };
  } catch {
    console.warn('[store-admin/coupons] could not read coupons');
    return fail('unavailable', 'Coupons are not available.');
  }
}

async function readTargets(tx: Queryable, couponId: string): Promise<CouponTargetView[]> {
  const rows = (await tx`
    select t.product_id, t.category_id, t.brand_id,
           p.name as product_name, cat.name as category_name, b.name as brand_name
    from coupon_targets t
    left join products p on p.id = t.product_id
    left join categories cat on cat.id = t.category_id
    left join brands b on b.id = t.brand_id
    where t.coupon_id = ${couponId}
    order by coalesce(p.name, cat.name, b.name) asc
    limit 500
  `) as Row[];
  return rows.map((row) => ({
    productId: row.product_id ? text(row.product_id) : null,
    categoryId: row.category_id ? text(row.category_id) : null,
    brandId: row.brand_id ? text(row.brand_id) : null,
    label: text(row.product_name || row.category_name || row.brand_name),
  }));
}

async function readUsageTotals(tx: Queryable, couponId: string): Promise<CouponUsageTotals> {
  const rows = (await tx`
    select
      count(*) filter (where state in ('RESERVED', 'CONSUMED'))::int as used,
      count(*) filter (where state = 'RESERVED')::int as reserved,
      count(*) filter (where state = 'CONSUMED')::int as consumed,
      count(*) filter (where state = 'RELEASED')::int as released,
      coalesce(sum(discount_paise) filter (where state = 'CONSUMED'), 0)::bigint
        as total_discount_paise,
      coalesce((
        select sum(coalesce(o.total_paise, round(o.amount * 100)::bigint))
        from coupon_redemptions r
        join orders o on o.id = r.order_id
        where r.coupon_id = ${couponId} and r.state = 'CONSUMED'
      ), 0)::bigint as revenue_paise
    from coupon_redemptions
    where coupon_id = ${couponId}
  `) as Row[];
  const row = rows[0] ?? {};
  return {
    used: number(row.used),
    reserved: number(row.reserved),
    consumed: number(row.consumed),
    released: number(row.released),
    totalDiscountPaise: number(row.total_discount_paise),
    revenuePaise: number(row.revenue_paise),
  };
}

async function readUsageLog(tx: Queryable, couponId: string): Promise<CouponUsageEntry[]> {
  const rows = (await tx`
    select r.id, r.state, r.discount_paise, r.customer_email,
           r.created_at, r.consumed_at, r.released_at, r.release_reason,
           o.txnid, o.order_number, o.total_paise, o.amount
    from coupon_redemptions r
    join orders o on o.id = r.order_id
    where r.coupon_id = ${couponId}
    order by r.created_at desc, r.id desc
    limit ${USAGE_LOG_LIMIT}
  `) as Row[];
  return rows.map((row) => {
    const email = text(row.customer_email);
    return {
      id: number(row.id),
      orderNumber: row.order_number ? text(row.order_number) : text(row.txnid),
      txnid: text(row.txnid),
      customer: email ? maskEmail(email) : 'Guest',
      discountPaise: number(row.discount_paise),
      orderTotalPaise: number(
        row.total_paise ?? Math.round(number(row.amount) * 100),
      ),
      state: text(row.state) as CouponUsageEntry['state'],
      createdAt: iso(row.created_at) ?? '',
      consumedAt: iso(row.consumed_at),
      releasedAt: iso(row.released_at),
      releaseReason: row.release_reason ? text(row.release_reason) : null,
    };
  });
}

/** One coupon with its targets, usage log and computed totals. */
export async function getCoupon(id: string): Promise<CatalogWrite<CouponDetail>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');
  if (!id) return fail('not-found', 'That coupon does not exist.');

  try {
    const rows = (await sql`
      with usage as (
        select coupon_id,
               count(*) filter (where state in ('RESERVED', 'CONSUMED'))::int as used
        from coupon_redemptions
        group by coupon_id
      )
      select c.*,
             coalesce(u.used, 0)::int as used,
             (select count(*) from coupon_targets t where t.coupon_id = c.id)::int
               as target_count
      from coupons c
      left join usage u on u.coupon_id = c.id
      where c.id = ${id}
      limit 1
    `) as Row[];

    if (rows.length === 0) return fail('not-found', 'That coupon does not exist.');

    const [targets, usage, totals] = await Promise.all([
      readTargets(sql, id),
      readUsageLog(sql, id),
      readUsageTotals(sql, id),
    ]);

    return { ok: true, data: { coupon: mapRow(rows[0]), targets, usage, totals } };
  } catch {
    console.warn('[store-admin/coupons] could not read a coupon');
    return fail('unavailable', 'Coupons are not available.');
  }
}

export interface CouponProductOption {
  id: string;
  name: string;
  categoryName: string;
}

/** Live products for the product picker. Archived rows are never offered. */
export async function listCouponProductOptions(): Promise<CatalogWrite<CouponProductOption[]>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The catalogue is not available.');

  try {
    const rows = (await sql`
      select p.id, p.name, c.name as category_name
      from products p
      left join categories c on c.id = p.category_id
      where p.deleted_at is null and p.is_active
      order by c.name asc, p.name asc
      limit 1000
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        id: text(row.id),
        name: text(row.name),
        categoryName: text(row.category_name),
      })),
    };
  } catch {
    return fail('unavailable', 'The catalogue is not available.');
  }
}

/** Used by the report's code filter. */
export async function listCouponOptions(): Promise<
  CatalogWrite<Array<{ id: string; code: string }>>
> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  try {
    const rows = (await sql`
      select id, code from coupons order by created_at desc, id desc limit 1000
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({ id: text(row.id), code: text(row.code) })),
    };
  } catch {
    return fail('unavailable', 'Coupons are not available.');
  }
}

/* ---------------------------------------------------------------- writes */

interface CouponColumns {
  code: string;
  name: string;
  description: string;
  type: string;
  value: number;
  scope: string;
  startsAt: Date | null;
  endsAt: Date | null;
  totalRedemptionLimit: number | null;
  perCustomerLimit: number | null;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  onlyNewCustomers: boolean;
  allowWithSalePrice: boolean;
  allowedCustomerGroups: string[] | null;
  restrictedToEmails: string[] | null;
}

function columnsFrom(values: CouponValues): CouponColumns {
  return {
    code: values.code,
    name: values.name,
    description: values.description,
    type: values.type,
    value: values.value,
    scope: values.scope,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    totalRedemptionLimit: values.totalRedemptionLimit,
    perCustomerLimit: values.perCustomerLimit,
    minOrderPaise: values.minOrderPaise,
    maxDiscountPaise: values.maxDiscountPaise,
    onlyNewCustomers: values.onlyNewCustomers,
    allowWithSalePrice: values.allowWithSalePrice,
    allowedCustomerGroups: values.allowedCustomerGroups,
    restrictedToEmails: values.restrictedToEmails,
  };
}

async function insertCoupon(
  tx: Tx,
  id: string,
  columns: CouponColumns,
  status: 'active' | 'paused',
  createdBy: string | null,
): Promise<void> {
  await tx`
    insert into coupons (
      id, code, name, description, type, value, scope, status,
      starts_at, ends_at, total_redemption_limit, per_customer_limit,
      min_order_paise, max_discount_paise, only_new_customers,
      allow_with_sale_price, allowed_customer_groups, restricted_to_emails,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${columns.code}, ${columns.name}, ${columns.description},
      ${columns.type}, ${columns.value}, ${columns.scope}, ${status},
      ${columns.startsAt}, ${columns.endsAt}, ${columns.totalRedemptionLimit},
      ${columns.perCustomerLimit}, ${columns.minOrderPaise},
      ${columns.maxDiscountPaise}, ${columns.onlyNewCustomers},
      ${columns.allowWithSalePrice}, ${columns.allowedCustomerGroups},
      ${columns.restrictedToEmails}, ${createdBy}, now(), now()
    )
  `;
}

async function replaceTargets(
  tx: Tx,
  couponId: string,
  targets: CouponValues['targets'],
): Promise<void> {
  await tx`delete from coupon_targets where coupon_id = ${couponId}`;
  for (const target of targets) {
    await tx`
      insert into coupon_targets (coupon_id, product_id, category_id, brand_id)
      values (
        ${couponId},
        ${target.productId ?? null},
        ${target.categoryId ?? null},
        ${target.brandId ?? null}
      )
      on conflict do nothing
    `;
  }
}

/** Create a coupon. Codes are unique case-insensitively at the database. */
export async function createCoupon(
  values: CouponValues,
  actorId: string | null,
): Promise<CatalogWrite<CouponAdminRow>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  try {
    const id = newCouponId();
    await sql.begin(async (tx) => {
      await insertCoupon(tx, id, columnsFrom(values), 'active', actorId);
      await replaceTargets(tx, id, values.targets);
    });

    const created = await getCoupon(id);
    if (!created.ok) return fail('unavailable', 'Coupons are not available.');
    return { ok: true, data: created.data.coupon };
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'That code is already in use. Choose another.');
    }
    console.warn('[store-admin/coupons] could not create a coupon');
    return fail('unavailable', 'The coupon could not be saved.');
  }
}

export interface CouponUpdateSnapshot {
  before: CouponAdminRow;
  after: CouponAdminRow;
}

/**
 * Update a coupon. Archived coupons are read-only: their redemption history is
 * a permanent record and re-enabling one would silently reuse a code staff
 * believe is retired.
 */
export async function updateCoupon(
  id: string,
  values: CouponValues,
  actorId: string | null,
): Promise<CatalogWrite<CouponUpdateSnapshot>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  try {
    return await sql.begin(async (tx) => {
      const existing = (await tx`
        select * from coupons where id = ${id} for update
      `) as Row[];
      if (existing.length === 0) return fail('not-found', 'That coupon does not exist.');
      if (text(existing[0].status) === 'archived') {
        return fail('conflict', 'An archived coupon cannot be edited.');
      }

      const before = mapRow({ ...existing[0], used: 0, target_count: 0 });

      const columns = columnsFrom(values);
      await tx`
        update coupons set
          code = ${columns.code},
          name = ${columns.name},
          description = ${columns.description},
          type = ${columns.type},
          value = ${columns.value},
          scope = ${columns.scope},
          starts_at = ${columns.startsAt},
          ends_at = ${columns.endsAt},
          total_redemption_limit = ${columns.totalRedemptionLimit},
          per_customer_limit = ${columns.perCustomerLimit},
          min_order_paise = ${columns.minOrderPaise},
          max_discount_paise = ${columns.maxDiscountPaise},
          only_new_customers = ${columns.onlyNewCustomers},
          allow_with_sale_price = ${columns.allowWithSalePrice},
          allowed_customer_groups = ${columns.allowedCustomerGroups},
          restricted_to_emails = ${columns.restrictedToEmails},
          updated_at = now()
        where id = ${id}
      `;
      await replaceTargets(tx, id, values.targets);

      const after = mapRow({
        ...existing[0],
        ...{
          code: columns.code,
          name: columns.name,
          description: columns.description,
          type: columns.type,
          value: columns.value,
          scope: columns.scope,
          starts_at: columns.startsAt,
          ends_at: columns.endsAt,
          total_redemption_limit: columns.totalRedemptionLimit,
          per_customer_limit: columns.perCustomerLimit,
          min_order_paise: columns.minOrderPaise,
          max_discount_paise: columns.maxDiscountPaise,
          only_new_customers: columns.onlyNewCustomers,
          allow_with_sale_price: columns.allowWithSalePrice,
          allowed_customer_groups: columns.allowedCustomerGroups,
          restricted_to_emails: columns.restrictedToEmails,
          target_count: values.targets.length,
          updated_at: new Date(),
        },
        used: 0,
      });

      return { ok: true, data: { before, after } };
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return fail('conflict', 'That code is already in use. Choose another.');
    }
    console.warn('[store-admin/coupons] could not update a coupon');
    return fail('unavailable', 'The coupon could not be saved.');
  }
}

export type CouponStatusAction = 'pause' | 'resume' | 'archive';

/** Pause, resume or archive. Archive is one-way once redeemed. */
export async function setCouponStatus(
  id: string,
  action: CouponStatusAction,
): Promise<CatalogWrite<{ before: CouponAdminRow; after: CouponAdminRow }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from coupons where id = ${id} for update
      `) as Row[];
      if (rows.length === 0) return fail('not-found', 'That coupon does not exist.');

      const current = mapRow({ ...rows[0], used: 0, target_count: 0 });
      if (current.status === 'archived') {
        return fail('conflict', 'This coupon is archived and cannot be changed.');
      }
      if (action === 'resume' && current.status !== 'paused') {
        return fail('conflict', 'Only a paused coupon can be resumed.');
      }
      if (action === 'pause' && current.status !== 'active') {
        return fail('conflict', 'Only an active coupon can be paused.');
      }

      const nextStatus = action === 'archive' ? 'archived' : action === 'pause' ? 'paused' : 'active';
      const archivedAt = action === 'archive' ? new Date() : null;
      await tx`
        update coupons
        set status = ${nextStatus}, archived_at = ${archivedAt}, updated_at = now()
        where id = ${id}
      `;

      return {
        ok: true,
        data: {
          before: current,
          after: {
            ...current,
            status: nextStatus,
            archivedAt: archivedAt ? archivedAt.toISOString() : null,
            updatedAt: new Date().toISOString(),
            badge: couponListBadge({
              status: nextStatus,
              startsAt: current.startsAt,
              endsAt: current.endsAt,
              used: 0,
              totalLimit: current.totalRedemptionLimit,
            }),
          },
        },
      };
    });
  } catch {
    console.warn('[store-admin/coupons] could not change a coupon status');
    return fail('unavailable', 'The coupon could not be saved.');
  }
}

/**
 * Copy a coupon as a paused draft with a fresh generated code, so a duplicate
 * never starts taking money the moment it is created.
 */
export async function duplicateCoupon(
  id: string,
  actorId: string | null,
): Promise<CatalogWrite<CouponAdminRow>> {
  const existing = await getCoupon(id);
  if (!existing.ok) return existing;

  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  const source = existing.data.coupon;
  const code = generateCouponCode('GZ', 8);

  try {
    const newId = newCouponId();
    await sql.begin(async (tx) => {
      await insertCoupon(
        tx,
        newId,
        {
          code,
          name: `${source.name || source.code} (copy)`.slice(0, 120),
          description: source.description,
          type: source.type,
          value: source.value,
          scope: source.scope,
          startsAt: source.startsAt ? new Date(source.startsAt) : null,
          endsAt: source.endsAt ? new Date(source.endsAt) : null,
          totalRedemptionLimit: source.totalRedemptionLimit,
          perCustomerLimit: source.perCustomerLimit,
          minOrderPaise: source.minOrderPaise,
          maxDiscountPaise: source.maxDiscountPaise,
          onlyNewCustomers: source.onlyNewCustomers,
          allowWithSalePrice: source.allowWithSalePrice,
          allowedCustomerGroups: source.allowedCustomerGroups,
          restrictedToEmails: source.restrictedToEmails,
        },
        'paused',
        actorId,
      );
      await replaceTargets(
        tx,
        newId,
        existing.data.targets.map((target) => ({
          productId: target.productId,
          categoryId: target.categoryId,
          brandId: target.brandId,
        })),
      );
    });

    const created = await getCoupon(newId);
    if (!created.ok) return fail('unavailable', 'Coupons are not available.');
    return { ok: true, data: created.data.coupon };
  } catch {
    console.warn('[store-admin/coupons] could not duplicate a coupon');
    return fail('unavailable', 'The coupon could not be duplicated.');
  }
}

export interface BulkGenerateInput {
  count: number;
  prefix: string;
  length: number;
  values: Omit<CouponValues, 'code'>;
}

export interface BulkGenerateResult {
  codes: string[];
  ids: string[];
}

/**
 * Generate `count` unique single-use coupons from one template.
 *
 * Every generated coupon has both limits set to 1. Uniqueness is checked in
 * memory and against the database before the transaction writes, and a rare
 * collision is retried rather than failing the batch.
 */
export async function bulkGenerateCoupons(
  input: BulkGenerateInput,
  actorId: string | null,
): Promise<CatalogWrite<BulkGenerateResult>> {
  const count = Math.trunc(input.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_BULK) {
    return fail('invalid-input', `Generate between 1 and ${MAX_BULK} codes.`);
  }

  const sql = getSql();
  if (!sql) return fail('unavailable', 'Coupons are not available.');

  const prefix = (input.prefix || 'GZ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'GZ';
  const length = Math.max(6, Math.min(16, Math.trunc(input.length) || 8));

  const codes = new Set<string>();
  let attempts = 0;
  while (codes.size < count && attempts < count * 20) {
    codes.add(generateCouponCode(prefix, length));
    attempts += 1;
  }
  if (codes.size < count) {
    return fail('unavailable', 'Could not generate enough unique codes. Try a longer code.');
  }

  const list = [...codes];
  try {
    return await sql.begin(async (tx) => {
      const clashes = (await tx`
        select upper(code) as code from coupons
        where upper(code) in ${tx(list)}
      `) as Row[];
      const taken = new Set(clashes.map((row) => text(row.code)));
      const usable = list.filter((code) => !taken.has(code));
      if (usable.length < count) {
        return fail('conflict', 'Some generated codes already exist. Generate again.');
      }

      const ids: string[] = [];
      for (const code of usable) {
        const id = newCouponId();
        ids.push(id);
        await insertCoupon(
          tx,
          id,
          {
            code,
            name: input.values.name,
            description: input.values.description,
            type: input.values.type,
            value: input.values.value,
            scope: input.values.scope,
            startsAt: input.values.startsAt,
            endsAt: input.values.endsAt,
            totalRedemptionLimit: 1,
            perCustomerLimit: 1,
            minOrderPaise: input.values.minOrderPaise,
            maxDiscountPaise: input.values.maxDiscountPaise,
            onlyNewCustomers: input.values.onlyNewCustomers,
            allowWithSalePrice: input.values.allowWithSalePrice,
            allowedCustomerGroups: input.values.allowedCustomerGroups,
            restrictedToEmails: input.values.restrictedToEmails,
          },
          'active',
          actorId,
        );
        await replaceTargets(tx, id, input.values.targets);
      }

      return { ok: true, data: { codes: usable, ids } };
    });
  } catch {
    console.warn('[store-admin/coupons] could not bulk generate coupons');
    return fail('unavailable', 'The coupons could not be generated.');
  }
}

/* ---------------------------------------------------------------- report */

export interface CouponUsageReportRow {
  code: string;
  orderNumber: string;
  customer: string;
  discountDisplay: string;
  orderTotalDisplay: string;
  state: string;
  createdAt: string;
}

export interface CouponUsageReportData {
  rows: CouponUsageReportRow[];
  totals: {
    redemptions: number;
    discountPaise: number;
    revenuePaise: number;
  };
  truncated: boolean;
}

export interface CouponUsageReportFilters {
  fromDay: string;
  toDay: string;
  code?: string;
}

/**
 * Redemption-level usage for a date range, optionally one code.
 *
 * Revenue is the order total, which is already net of this discount. The
 * discount column is the coupon's own share of that order. `RESERVED` rows
 * hold a use but have not been paid; they are counted in redemptions and are
 * shown with their state so staff never read them as money.
 */
export async function couponUsageReport(
  filters: CouponUsageReportFilters,
): Promise<CatalogWrite<CouponUsageReportData>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The report is not available.');

  const code = (filters.code ?? '').trim().toUpperCase();
  const limit = 2000;

  try {
    const rows = (await sql`
      select c.code, r.state, r.discount_paise, r.customer_email, r.created_at,
             o.txnid, o.order_number, o.total_paise, o.amount
      from coupon_redemptions r
      join coupons c on c.id = r.coupon_id
      join orders o on o.id = r.order_id
      where r.created_at >= ${filters.fromDay}::date
        and r.created_at < (${filters.toDay}::date + interval '1 day')
        and (${code} = '' or upper(c.code) = ${code})
      order by r.created_at desc, r.id desc
      limit ${limit + 1}
    `) as Row[];

    const truncated = rows.length > limit;
    const visible = rows.slice(0, limit);

    let discountPaise = 0;
    let revenuePaise = 0;
    const mapped: CouponUsageReportRow[] = visible.map((row) => {
      const discount = number(row.discount_paise);
      const total = number(row.total_paise ?? Math.round(number(row.amount) * 100));
      if (text(row.state) === 'CONSUMED') {
        discountPaise += discount;
        revenuePaise += total;
      }
      const email = text(row.customer_email);
      return {
        code: text(row.code),
        orderNumber: row.order_number ? text(row.order_number) : text(row.txnid),
        customer: email ? maskEmail(email) : 'Guest',
        discountDisplay: formatPaise(discount),
        orderTotalDisplay: formatPaise(total),
        state: text(row.state),
        createdAt: iso(row.created_at) ?? '',
      };
    });

    return {
      ok: true,
      data: {
        rows: mapped,
        totals: {
          redemptions: mapped.length,
          discountPaise,
          revenuePaise,
        },
        truncated,
      },
    };
  } catch {
    console.warn('[store-admin/coupons] could not build the usage report');
    return fail('unavailable', 'The report is not available.');
  }
}
