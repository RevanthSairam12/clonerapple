/**
 * Store Admin service for Free Gift rules, live SKU stock checks, warnings,
 * reports, CSV export, and audit logging.
 *
 * Server-only. Never exposes raw customer emails in audit snapshots or CSVs.
 */

import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { setTransactionTimeouts } from '@/lib/checkout/transaction-guards';
import {
  collectFreeGiftAdminWarnings,
  isFreeGiftRuleRunning,
  validateFreeGiftRuleInput,
  type FreeGiftAdminWarning,
  type FreeGiftCatalogSnapshot,
  type FreeGiftRuleRecord,
} from '@/lib/free-gifts/rules';
import {
  freeGiftTablesPresent,
  giftTargetKey,
  listGiftProductPickerOptionsUsing,
  loadFreeGiftRulesWithSnapshotsUsing,
  loadGiftCatalogSnapshotMapUsing,
  type GiftProductPickerOption,
} from '@/lib/free-gifts/store';
import { getSql } from '@/lib/platform/db';
import { DEFAULT_TIMEZONE } from '@/lib/spin-wheel/rules';

import { maskEmail, writeAudit, type AuditInput } from './audit';
import { toCsv } from './catalog-csv';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin free gift operations must run on the server only.');
}

type SqlLike = postgres.Sql | postgres.TransactionSql;
type Row = Record<string, unknown>;

export interface FreeGiftAdminActor {
  actorId: string | null;
  actorEmail?: string | null;
  request?: Request | null;
}

export interface FreeGiftAdminServiceOptions {
  sql?: postgres.Sql;
  audit?: typeof writeAudit;
}

export interface FreeGiftRuleReportRow {
  ruleId: string;
  ruleName: string;
  reservedCount: number;
  consumedCount: number;
  releasedCount: number;
  paidOrdersCount: number;
  revenuePaise: number;
  retailGiftValuePaise: number;
  unavailableCheckoutCount: number;
}

export interface FreeGiftRecentRedemptionRow {
  id: string;
  ruleId: string;
  ruleName: string;
  txnid: string;
  orderNumber: number | null;
  customerMasked: string;
  giftProductName: string;
  thresholdPaise: number;
  state: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  releaseReason: string | null;
  reservedAt: string;
}

export interface FreeGiftAdminRuleView extends FreeGiftRuleRecord {
  lastUnavailableAt: string | null;
  runningNow: boolean;
  gift: FreeGiftCatalogSnapshot | null;
  warnings: FreeGiftAdminWarning[];
}

export interface FreeGiftsAdminDashboardData {
  timeZone: string;
  cheapestProductPaise: number | null;
  rules: FreeGiftAdminRuleView[];
  giftProducts: GiftProductPickerOption[];
  summary: {
    activeRulesCount: number;
    runningRulesCount: number;
    totalConsumedCount: number;
    totalReservedCount: number;
    totalPaidOrdersCount: number;
    totalRevenuePaise: number;
    totalRetailGiftValuePaise: number;
    totalUnavailableAttempts: number;
    rulesWithAlertsCount: number;
  };
  reports: {
    byRule: FreeGiftRuleReportRow[];
    recentRedemptions: FreeGiftRecentRedemptionRow[];
  };
}

class InvalidGiftRuleError extends Error {}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

async function readTimeZone(sql: SqlLike): Promise<string> {
  const rows = (await sql`
    select coalesce(
      (
        select p.name
        from store_settings ss
        join pg_timezone_names p on p.name = btrim(ss.value)
        where ss.key = 'timezone'
        limit 1
      ),
      ${DEFAULT_TIMEZONE}
    ) as tz
  `) as Array<{ tz: unknown }>;
  return text(rows[0]?.tz) || DEFAULT_TIMEZONE;
}

async function auditGift(
  tx: SqlLike,
  actor: FreeGiftAdminActor,
  input: Omit<AuditInput, 'actorId' | 'actorEmail' | 'request'>,
  options: FreeGiftAdminServiceOptions,
): Promise<void> {
  if (!(await (options.audit ?? writeAudit)({ ...input, ...actor }, tx))) {
    throw new Error('Free gift audit failed.');
  }
}

function ruleAuditSnapshot(rule: FreeGiftRuleRecord) {
  return {
    id: rule.id,
    name: rule.name,
    giftProductId: rule.giftProductId,
    giftVariantId: rule.giftVariantId,
    targetPaise: rule.targetPaise,
    badgeText: rule.badgeText,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
    isActive: rule.isActive,
    showOnProductPage: rule.showOnProductPage,
    maxGiftsTotal: rule.maxGiftsTotal,
    perCustomerLimit: rule.perCustomerLimit,
    priority: rule.priority,
    couponInteraction: rule.couponInteraction,
    minPostCouponPaise: rule.minPostCouponPaise,
    archivedAt: rule.archivedAt,
  };
}

export async function getFreeGiftsAdminDataUsing(
  sql: SqlLike,
): Promise<
  | { ok: true; data: FreeGiftsAdminDashboardData }
  | { ok: false; reason: 'schema-missing' | 'unavailable' }
> {
  try {
    if (!(await freeGiftTablesPresent(sql))) {
      return { ok: false, reason: 'schema-missing' };
    }

    const [
      timeZone,
      rulesResult,
      giftProducts,
      cheapestRows,
      lastUnavailableRows,
      byRuleRows,
      recentRows,
    ] = await Promise.all([
      readTimeZone(sql),
      loadFreeGiftRulesWithSnapshotsUsing(sql, { includeInactive: true }),
      listGiftProductPickerOptionsUsing(sql, { includeInactive: true }),
      sql`
        select min(price_paise)::bigint as min_paise
        from products
        where deleted_at is null
          and is_active = true
          and coalesce((to_jsonb(products)->>'is_gift_only')::boolean, false) = false
          and price_paise > 0
      ` as Promise<Row[]>,
      sql`
        select id, last_unavailable_at
        from free_gift_rules
        where archived_at is null
      ` as Promise<Row[]>,
      sql`
        select
          r.id as rule_id,
          r.name as rule_name,
          r.unavailable_checkout_count,
          count(gr.id) filter (where gr.state = 'RESERVED')::int as reserved_count,
          count(gr.id) filter (where gr.state = 'CONSUMED')::int as consumed_count,
          count(gr.id) filter (where gr.state = 'RELEASED')::int as released_count,
          count(distinct o.id) filter (
            where gr.state = 'CONSUMED'
              and o.status = 'PAID'
              and o.fulfilment_status <> 'CANCELED'
              and coalesce((to_jsonb(o)->>'is_test')::boolean, false) = false
          )::int as paid_orders_count,
          coalesce(sum(coalesce(o.total_paise, round(o.amount * 100)::bigint)) filter (
            where gr.state = 'CONSUMED'
              and o.status = 'PAID'
              and o.fulfilment_status <> 'CANCELED'
              and coalesce((to_jsonb(o)->>'is_test')::boolean, false) = false
          ), 0)::bigint as revenue_paise,
          coalesce((
            select sum(coalesce((to_jsonb(oi)->>'reference_price_paise')::bigint, 0) * oi.quantity)
            from order_items oi
            join orders o2 on o2.id = oi.order_id
            where to_jsonb(oi)->>'free_gift_rule_id' = r.id
              and coalesce((to_jsonb(oi)->>'is_free_gift')::boolean, false) = true
              and o2.status = 'PAID'
              and o2.fulfilment_status <> 'CANCELED'
              and coalesce((to_jsonb(o2)->>'is_test')::boolean, false) = false
          ), 0)::bigint as retail_gift_value_paise
        from free_gift_rules r
        left join free_gift_redemptions gr on gr.rule_id = r.id
        left join orders o on o.id = gr.order_id
        where r.archived_at is null
        group by r.id, r.name, r.unavailable_checkout_count, r.priority, r.target_paise, r.created_at
        order by r.target_paise desc, r.priority desc, r.created_at asc
      ` as Promise<Row[]>,
      sql`
        select
          gr.id,
          gr.rule_id,
          r.name as rule_name,
          o.txnid,
          o.order_number,
          gr.customer_email,
          coalesce(p.name, gr.gift_product_id) as gift_product_name,
          gr.threshold_paise,
          gr.state,
          gr.release_reason,
          gr.reserved_at
        from free_gift_redemptions gr
        join free_gift_rules r on r.id = gr.rule_id
        join orders o on o.id = gr.order_id
        left join products p on p.id = gr.gift_product_id
        order by gr.reserved_at desc
        limit 50
      ` as Promise<Row[]>,
    ]);

    const minPaiseRaw = cheapestRows[0]?.min_paise;
    const cheapestProductPaise =
      minPaiseRaw === null || minPaiseRaw === undefined ? null : Math.max(0, int(minPaiseRaw, 0));

    const lastUnavailMap = new Map<string, string | null>();
    for (const row of lastUnavailableRows) {
      const v = row.last_unavailable_at;
      lastUnavailMap.set(
        text(row.id),
        v instanceof Date ? v.toISOString() : v ? String(v) : null,
      );
    }

    const allRuleRecords = rulesResult.rules.map((rw) => rw.rule);
    const rules: FreeGiftAdminRuleView[] = rulesResult.rules.map((rw) => {
      const warnings = collectFreeGiftAdminWarnings({
        rule: rw.rule,
        gift: rw.gift,
        otherActiveRules: allRuleRecords,
        cheapestProductPaise,
      });
      return {
        ...rw.rule,
        lastUnavailableAt: lastUnavailMap.get(rw.rule.id) ?? null,
        runningNow: isFreeGiftRuleRunning(rw.rule, rulesResult.now),
        gift: rw.gift,
        warnings,
      };
    });

    const byRule: FreeGiftRuleReportRow[] = byRuleRows.map((row) => ({
      ruleId: text(row.rule_id),
      ruleName: text(row.rule_name),
      reservedCount: int(row.reserved_count),
      consumedCount: int(row.consumed_count),
      releasedCount: int(row.released_count),
      paidOrdersCount: int(row.paid_orders_count),
      revenuePaise: int(row.revenue_paise),
      retailGiftValuePaise: int(row.retail_gift_value_paise),
      unavailableCheckoutCount: int(row.unavailable_checkout_count),
    }));

    const recentRedemptions: FreeGiftRecentRedemptionRow[] = recentRows.map((row) => {
      const stateRaw = text(row.state);
      const state =
        stateRaw === 'CONSUMED' || stateRaw === 'RELEASED' ? stateRaw : 'RESERVED';
      const email = text(row.customer_email).trim();
      return {
        id: text(row.id),
        ruleId: text(row.rule_id),
        ruleName: text(row.rule_name),
        txnid: text(row.txnid),
        orderNumber: row.order_number == null ? null : int(row.order_number),
        customerMasked: email ? maskEmail(email) : '[guest]',
        giftProductName: text(row.gift_product_name),
        thresholdPaise: int(row.threshold_paise),
        state,
        releaseReason: row.release_reason ? text(row.release_reason) : null,
        reservedAt:
          row.reserved_at instanceof Date
            ? row.reserved_at.toISOString()
            : text(row.reserved_at),
      };
    });

    const summary = {
      activeRulesCount: rules.filter((r) => r.isActive).length,
      runningRulesCount: rules.filter((r) => r.runningNow).length,
      totalConsumedCount: byRule.reduce((s, r) => s + r.consumedCount, 0),
      totalReservedCount: byRule.reduce((s, r) => s + r.reservedCount, 0),
      totalPaidOrdersCount: byRule.reduce((s, r) => s + r.paidOrdersCount, 0),
      totalRevenuePaise: byRule.reduce((s, r) => s + r.revenuePaise, 0),
      totalRetailGiftValuePaise: byRule.reduce((s, r) => s + r.retailGiftValuePaise, 0),
      totalUnavailableAttempts: rules.reduce((s, r) => s + r.unavailableCheckoutCount, 0),
      rulesWithAlertsCount: rules.filter(
        (r) =>
          r.isActive
          && (r.unavailableCheckoutCount > 0 || r.warnings.some((w) => w.key !== 'low_threshold' && w.key !== 'overlapping_rule')),
      ).length,
    };

    return {
      ok: true,
      data: {
        timeZone,
        cheapestProductPaise,
        rules,
        giftProducts,
        summary,
        reports: { byRule, recentRedemptions },
      },
    };
  } catch {
    console.warn('[store-admin/free-gifts] failed to load free gift admin data');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getFreeGiftsAdminData() {
  const sql = getSql();
  if (!sql) return { ok: false as const, reason: 'unavailable' as const };
  return getFreeGiftsAdminDataUsing(sql);
}

export async function createFreeGiftRuleUsing(
  sql: postgres.Sql,
  rawInput: unknown,
  actor: FreeGiftAdminActor,
  options: FreeGiftAdminServiceOptions = {},
): Promise<
  | { ok: true; data: FreeGiftsAdminDashboardData; ruleId: string }
  | { ok: false; reason: 'invalid-input' | 'unavailable'; error: string }
> {
  const validated = validateFreeGiftRuleInput(rawInput);
  if (!validated.ok) {
    return { ok: false, reason: 'invalid-input', error: validated.error };
  }
  const input = validated.value;
  const ruleId = `fgr_${randomBytes(6).toString('hex')}`;

  try {
    await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      const timeZone = await readTimeZone(tx);

      const snapMap = await loadGiftCatalogSnapshotMapUsing(tx, [
        { productId: input.giftProductId, variantId: input.giftVariantId },
      ]);
      const snap = snapMap.get(giftTargetKey(input.giftProductId, input.giftVariantId)) ?? null;
      if (!snap) {
        throw new InvalidGiftRuleError('Selected gift product does not exist or has been deleted.');
      }
      if (input.giftVariantId && snap.variantId !== input.giftVariantId) {
        throw new InvalidGiftRuleError('Selected gift variant does not belong to that product.');
      }

      const [inserted] = (await tx`
        insert into free_gift_rules (
          id, name, gift_product_id, gift_variant_id, target_paise,
          icon_url, badge_text, unlock_message, starts_at, ends_at,
          is_active, show_on_product_page, max_gifts_total, per_customer_limit,
          priority, coupon_interaction, min_post_coupon_paise, created_by
        ) values (
          ${ruleId},
          ${input.name},
          ${input.giftProductId},
          ${input.giftVariantId},
          ${input.targetPaise},
          ${input.iconUrl},
          ${input.badgeText},
          ${input.unlockMessage},
          ${input.startsAtLocal ? tx`(${input.startsAtLocal}::text)::timestamp at time zone ${timeZone}::text` : null},
          ${input.endsAtLocal ? tx`(${input.endsAtLocal}::text)::timestamp at time zone ${timeZone}::text` : null},
          ${input.isActive},
          ${input.showOnProductPage},
          ${input.maxGiftsTotal},
          ${input.perCustomerLimit},
          ${input.priority},
          ${input.couponInteraction},
          ${input.minPostCouponPaise},
          ${actor.actorId}
        )
        returning *
      `) as Row[];

      await auditGift(
        tx,
        actor,
        {
          action: 'free_gift.create',
          entity: 'free_gift_rule',
          entityId: ruleId,
          after: {
            id: ruleId,
            name: text(inserted?.name ?? input.name),
            giftProductId: input.giftProductId,
            giftVariantId: input.giftVariantId,
            targetPaise: input.targetPaise,
            isActive: input.isActive,
          },
          reason: 'rule_created',
        },
        options,
      );
    });

    const refreshed = await getFreeGiftsAdminDataUsing(sql);
    if (!refreshed.ok) {
      return { ok: false, reason: 'unavailable', error: 'Rule saved, but could not reload dashboard.' };
    }
    return { ok: true, data: refreshed.data, ruleId };
  } catch (error) {
    if (error instanceof InvalidGiftRuleError) {
      return { ok: false, reason: 'invalid-input', error: error.message };
    }
    console.warn('[store-admin/free-gifts] failed to create free gift rule');
    return { ok: false, reason: 'unavailable', error: 'Could not save free gift rule.' };
  }
}

export async function createFreeGiftRule(rawInput: unknown, actor: FreeGiftAdminActor) {
  const sql = getSql();
  if (!sql) return { ok: false as const, reason: 'unavailable' as const, error: 'Database is unavailable.' };
  return createFreeGiftRuleUsing(sql, rawInput, actor);
}

export async function updateFreeGiftRuleUsing(
  sql: postgres.Sql,
  ruleId: string,
  rawInput: unknown,
  actor: FreeGiftAdminActor,
  options: FreeGiftAdminServiceOptions = {},
): Promise<
  | { ok: true; data: FreeGiftsAdminDashboardData }
  | { ok: false; reason: 'invalid-input' | 'not-found' | 'unavailable'; error: string }
> {
  const cleanId = text(ruleId).trim();
  if (!cleanId) return { ok: false, reason: 'not-found', error: 'Free gift rule not found.' };

  const body =
    rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const action = text(body.action).trim();

  try {
    await sql.begin(async (tx) => {
      await setTransactionTimeouts(tx);
      const timeZone = await readTimeZone(tx);

      const loadedBefore = await loadFreeGiftRulesWithSnapshotsUsing(tx, { includeInactive: true });
      const existing = loadedBefore.rules.find((r) => r.rule.id === cleanId)?.rule;
      if (!existing) {
        throw new InvalidGiftRuleError('NOT_FOUND');
      }

      if (action === 'pause' || action === 'resume') {
        const nextActive = action === 'resume';
        await tx`
          update free_gift_rules
          set is_active = ${nextActive}, updated_at = now()
          where id = ${cleanId} and archived_at is null
        `;
        await auditGift(
          tx,
          actor,
          {
            action: nextActive ? 'free_gift.resume' : 'free_gift.pause',
            entity: 'free_gift_rule',
            entityId: cleanId,
            before: ruleAuditSnapshot(existing),
            after: { ...ruleAuditSnapshot(existing), isActive: nextActive },
            reason: action,
          },
          options,
        );
        return;
      }

      if (action === 'archive') {
        await tx`
          update free_gift_rules
          set is_active = false, archived_at = now(), updated_at = now()
          where id = ${cleanId} and archived_at is null
        `;
        await auditGift(
          tx,
          actor,
          {
            action: 'free_gift.archive',
            entity: 'free_gift_rule',
            entityId: cleanId,
            before: ruleAuditSnapshot(existing),
            after: { ...ruleAuditSnapshot(existing), isActive: false, archived: true },
            reason: 'archived',
          },
          options,
        );
        return;
      }

      if (action === 'reset_unavailable') {
        await tx`
          update free_gift_rules
          set unavailable_checkout_count = 0, last_unavailable_at = null, updated_at = now()
          where id = ${cleanId} and archived_at is null
        `;
        await auditGift(
          tx,
          actor,
          {
            action: 'free_gift.reset_unavailable_count',
            entity: 'free_gift_rule',
            entityId: cleanId,
            before: { unavailableCheckoutCount: existing.unavailableCheckoutCount },
            after: { unavailableCheckoutCount: 0 },
            reason: 'staff_cleared_alert',
          },
          options,
        );
        return;
      }

      const validated = validateFreeGiftRuleInput(rawInput);
      if (!validated.ok) {
        throw new InvalidGiftRuleError(validated.error);
      }
      const next = validated.value;

      const snapMap = await loadGiftCatalogSnapshotMapUsing(tx, [
        { productId: next.giftProductId, variantId: next.giftVariantId },
      ]);
      const snap = snapMap.get(giftTargetKey(next.giftProductId, next.giftVariantId)) ?? null;
      if (!snap) {
        throw new InvalidGiftRuleError('Selected gift product does not exist or has been deleted.');
      }
      if (next.giftVariantId && snap.variantId !== next.giftVariantId) {
        throw new InvalidGiftRuleError('Selected gift variant does not belong to that product.');
      }

      await tx`
        update free_gift_rules set
          name = ${next.name},
          gift_product_id = ${next.giftProductId},
          gift_variant_id = ${next.giftVariantId},
          target_paise = ${next.targetPaise},
          icon_url = ${next.iconUrl},
          badge_text = ${next.badgeText},
          unlock_message = ${next.unlockMessage},
          starts_at = ${next.startsAtLocal ? tx`(${next.startsAtLocal}::text)::timestamp at time zone ${timeZone}::text` : null},
          ends_at = ${next.endsAtLocal ? tx`(${next.endsAtLocal}::text)::timestamp at time zone ${timeZone}::text` : null},
          is_active = ${next.isActive},
          show_on_product_page = ${next.showOnProductPage},
          max_gifts_total = ${next.maxGiftsTotal},
          per_customer_limit = ${next.perCustomerLimit},
          priority = ${next.priority},
          coupon_interaction = ${next.couponInteraction},
          min_post_coupon_paise = ${next.minPostCouponPaise},
          updated_at = now()
        where id = ${cleanId} and archived_at is null
      `;

      const loadedAfter = await loadFreeGiftRulesWithSnapshotsUsing(tx, { includeInactive: true });
      const updatedRecord = loadedAfter.rules.find((r) => r.rule.id === cleanId)?.rule;
      await auditGift(
        tx,
        actor,
        {
          action: 'free_gift.update',
          entity: 'free_gift_rule',
          entityId: cleanId,
          before: ruleAuditSnapshot(existing),
          after: updatedRecord ? ruleAuditSnapshot(updatedRecord) : { id: cleanId },
          reason: 'staff_updated',
        },
        options,
      );
    });

    const refreshed = await getFreeGiftsAdminDataUsing(sql);
    if (!refreshed.ok) {
      return { ok: false, reason: 'unavailable', error: 'Rule updated, but could not reload dashboard.' };
    }
    return { ok: true, data: refreshed.data };
  } catch (error) {
    if (error instanceof InvalidGiftRuleError) {
      if (error.message === 'NOT_FOUND') {
        return { ok: false, reason: 'not-found', error: 'Free gift rule not found.' };
      }
      return { ok: false, reason: 'invalid-input', error: error.message };
    }
    console.warn('[store-admin/free-gifts] failed to update free gift rule');
    return { ok: false, reason: 'unavailable', error: 'Could not update free gift rule.' };
  }
}

export async function updateFreeGiftRule(
  ruleId: string,
  rawInput: unknown,
  actor: FreeGiftAdminActor,
) {
  const sql = getSql();
  if (!sql) return { ok: false as const, reason: 'unavailable' as const, error: 'Database is unavailable.' };
  return updateFreeGiftRuleUsing(sql, ruleId, rawInput, actor);
}

export async function exportFreeGiftsCsvUsing(
  sql: postgres.Sql,
  actor: FreeGiftAdminActor,
  options: FreeGiftAdminServiceOptions = {},
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  try {
    const dashboard = await getFreeGiftsAdminDataUsing(sql);
    if (!dashboard.ok) {
      return { ok: false, error: 'Free gift reports are unavailable.' };
    }

    const byRuleMap = new Map(dashboard.data.reports.byRule.map((r) => [r.ruleId, r]));

    await (options.audit ?? writeAudit)(
      {
        ...actor,
        action: 'free_gift.export',
        entity: 'free_gift_rule',
        entityId: 'all',
        after: { exportedRules: dashboard.data.rules.length },
        reason: 'csv_export',
      },
      sql,
    );

    const csv = toCsv(
      [
        'Rule ID',
        'Rule Name',
        'Active',
        'Running Now',
        'Gift Item',
        'Variant',
        'Threshold (INR)',
        'Priority',
        'Coupon Mode',
        'Reserved',
        'Claimed',
        'Released',
        'Paid Orders',
        'Attributed Revenue (INR)',
        'Gift Retail Value Given (INR)',
        'Unavailable Checkouts',
      ],
      dashboard.data.rules.map((rule) => {
        const rep = byRuleMap.get(rule.id);
        return [
          safeCsvCell(rule.id),
          safeCsvCell(rule.name),
          rule.isActive ? 'Yes' : 'No',
          rule.runningNow ? 'Yes' : 'No',
          safeCsvCell(rule.gift?.productName ?? rule.giftProductId),
          safeCsvCell(rule.gift?.variantLabel ?? (rule.giftVariantId || 'Base SKU')),
          (rule.targetPaise / 100).toFixed(2),
          String(rule.priority),
          rule.couponInteraction,
          String(rep?.reservedCount ?? 0),
          String(rep?.consumedCount ?? rule.claimedCount),
          String(rep?.releasedCount ?? 0),
          String(rep?.paidOrdersCount ?? 0),
          ((rep?.revenuePaise ?? 0) / 100).toFixed(2),
          ((rep?.retailGiftValuePaise ?? 0) / 100).toFixed(2),
          String(rule.unavailableCheckoutCount),
        ];
      }),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    return { ok: true, csv, filename: `free-gifts-report-${stamp}.csv` };
  } catch {
    return { ok: false, error: 'Could not export free gifts report.' };
  }
}

export async function exportFreeGiftsCsv(actor: FreeGiftAdminActor) {
  const sql = getSql();
  if (!sql) return { ok: false as const, error: 'Database is unavailable.' };
  return exportFreeGiftsCsvUsing(sql, actor);
}

