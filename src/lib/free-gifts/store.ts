/**
 * Database layer for Free Gifts: catalog gift snapshots, cart evaluation,
 * transaction-safe rule locking, redemption ledger transitions, and
 * Needs-attention unavailability counters.
 */
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import type { EligibleSubtotalLine } from '@/lib/checkout/shipping-rules';
import {
  checkFreeGiftReturnThresholdNote,
  evaluateFreeGiftRules,
  type CouponFreeGiftPreview,
  type FreeGiftCatalogSnapshot,
  type FreeGiftConflict,
  type FreeGiftCouponInteraction,
  type FreeGiftEvaluation,
  type FreeGiftRuleRecord,
  type FreeGiftRuleWithSnapshot,
  type ProductPageGiftPromo,
} from './rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Free gift data must be read on the server only.');
}

type SqlLike = postgres.ISql;
type Row = Record<string, unknown>;

export class GiftUnavailableError extends Error {
  readonly code = 'GIFT_UNAVAILABLE' as const;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly giftName: string;
  readonly reason: string;

  constructor(conflict: FreeGiftConflict) {
    super(conflict.message);
    this.name = 'GiftUnavailableError';
    this.ruleId = conflict.ruleId;
    this.ruleName = conflict.ruleName;
    this.giftName = conflict.giftName;
    this.reason = conflict.reason;
  }
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const s = text(value).trim();
  return s || null;
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function isoString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function giftTargetKey(productId: string, variantId: string | null): string {
  return JSON.stringify([productId, variantId || null]);
}

export async function freeGiftTablesPresent(sql: SqlLike): Promise<boolean> {
  const rows = (await sql`
    select
      to_regclass('free_gift_rules')::text as rules_table,
      to_regclass('free_gift_redemptions')::text as redemptions_table
  `) as Array<{ rules_table: string | null; redemptions_table: string | null }>;
  return Boolean(rows[0]?.rules_table && rows[0]?.redemptions_table);
}

/**
 * Load catalog snapshots (including `is_gift_only = true` items!) for a batch
 * of `(productId, variantId)` targets in a single database query.
 */
export async function loadGiftCatalogSnapshotMapUsing(
  sql: SqlLike,
  targets: ReadonlyArray<{ productId: string; variantId: string | null }>,
): Promise<Map<string, FreeGiftCatalogSnapshot>> {
  const unique = new Map<string, { productId: string; variantId: string | null }>();
  for (const t of targets) {
    const pid = text(t.productId).trim();
    const vid = nullableText(t.variantId);
    if (!pid) continue;
    unique.set(giftTargetKey(pid, vid), { productId: pid, variantId: vid });
  }
  const result = new Map<string, FreeGiftCatalogSnapshot>();
  if (unique.size === 0) return result;

  const productIds = [...new Set([...unique.values()].map((t) => t.productId))];

  const [variantSchema] = (await sql`
    select
      to_regclass('product_variants')::text as has_variants,
      to_regclass('product_variant_colours')::text as has_shared_colours,
      to_regclass('product_images')::text as has_images
  `) as Array<{
    has_variants: string | null;
    has_shared_colours: string | null;
    has_images: string | null;
  }>;

  const hasVariants = Boolean(variantSchema?.has_variants);
  const hasSharedColours = Boolean(variantSchema?.has_shared_colours);
  const hasImages = Boolean(variantSchema?.has_images);

  const productRows = (await sql`
    select
      p.id,
      p.name,
      p.price_paise,
      p.is_active,
      p.deleted_at,
      p.in_stock,
      p.inventory_mode,
      p.category_id,
      p.brand_id,
      coalesce((to_jsonb(p)->>'is_gift_only')::boolean, false) as is_gift_only,
      s.on_hand,
      s.reserved,
      coalesce(s.low_stock_threshold, 0) as low_stock_threshold,
      coalesce(s.track_inventory, false) as track_inventory,
      ${hasImages
        ? sql`(
            select pi.url
            from product_images pi
            where pi.product_id = p.id
              and pi.is_active
              and pi.deleted_at is null
            order by
              case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
              pi.sort_order,
              pi.id
            limit 1
          ) as image_url,
          (
            select pi.alt
            from product_images pi
            where pi.product_id = p.id
              and pi.is_active
              and pi.deleted_at is null
            order by
              case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
              pi.sort_order,
              pi.id
            limit 1
          ) as image_alt`
        : sql`null::text as image_url, null::text as image_alt`}
    from products p
    left join stock s on s.product_id = p.id and s.variant_id is null
    where p.id = any(${productIds}::text[])
  `) as Row[];

  const productById = new Map<string, Row>();
  for (const row of productRows) {
    productById.set(text(row.id), row);
  }

  const wantedVariantIds = [
    ...new Set(
      [...unique.values()]
        .map((t) => t.variantId)
        .filter((vid): vid is string => Boolean(vid)),
    ),
  ];

  const variantByKey = new Map<string, Row>();
  if (hasVariants && wantedVariantIds.length > 0) {
    const colourSelect = hasSharedColours
      ? sql`
          vc.colour_id as variant_colour_id,
          coalesce(col.name, nullif(btrim(v.option_value), '')) as variant_colour_name,
          coalesce(col.hex, nullif(btrim(v.option_hex), '')) as variant_colour_hex,
          (
            select pi.url
            from product_images pi
            where pi.product_id = v.product_id
              and pi.is_active
              and pi.deleted_at is null
              and pi.colour_id is not distinct from vc.colour_id
            order by case when pi.colour_id is not null then 0 else 1 end, pi.sort_order, pi.id
            limit 1
          ) as variant_image_url,
        `
      : sql`
          null::text as variant_colour_id,
          nullif(btrim(v.option_value), '') as variant_colour_name,
          nullif(btrim(v.option_hex), '') as variant_colour_hex,
          null::text as variant_image_url,
        `;
    const colourJoin = hasSharedColours
      ? sql`
          left join product_variant_colours vc on vc.variant_id = v.id
          left join colours col on col.id = vc.colour_id
        `
      : sql``;

    const variantRows = (await sql`
      select
        v.id as variant_id,
        v.product_id,
        v.sku as variant_sku,
        v.is_active as variant_is_active,
        v.is_purchasable as variant_is_purchasable,
        v.retired_at as variant_retired_at,
        v.price_paise_override,
        v.device_model_id as variant_device_model_id,
        dm.name as variant_device_model_name,
        concat_ws(' / ', dm.name, nullif(btrim(v.option_value), '')) as variant_label,
        ${colourSelect}
        s.id as stock_id,
        s.on_hand,
        s.reserved,
        coalesce(s.low_stock_threshold, 0) as low_stock_threshold,
        coalesce(s.track_inventory, false) as track_inventory
      from product_variants v
      left join device_models dm on dm.id = v.device_model_id
      left join stock s on s.product_id = v.product_id and s.variant_id = v.id
      ${colourJoin}
      where v.id = any(${wantedVariantIds}::text[])
    `) as Row[];

    for (const row of variantRows) {
      variantByKey.set(
        giftTargetKey(text(row.product_id), text(row.variant_id)),
        row,
      );
    }
  }

  for (const [key, target] of unique.entries()) {
    const prod = productById.get(target.productId);
    if (!prod) continue;
    const invMode = text(prod.inventory_mode) || 'product';
    const basePrice = Math.max(0, int(prod.price_paise, 0));
    const productImage = nullableText(prod.image_url);
    const productAlt = nullableText(prod.image_alt) || text(prod.name);

    if (target.variantId) {
      const vRow = variantByKey.get(key);
      if (!vRow) {
        result.set(key, {
          productId: target.productId,
          variantId: target.variantId,
          productName: text(prod.name),
          variantLabel: null,
          variantSku: null,
          regularPricePaise: basePrice,
          imageUrl: productImage,
          imageAlt: productAlt,
          productActive: prod.deleted_at == null && Boolean(prod.is_active),
          variantActive: false,
          isGiftOnly: Boolean(prod.is_gift_only),
          trackInventory: false,
          onHand: 0,
          reserved: 0,
          lowStockThreshold: 0,
          categoryId: nullableText(prod.category_id),
          brandId: nullableText(prod.brand_id),
          variantDeviceModelId: null,
          variantDeviceModelName: null,
          variantColourId: null,
          variantColourName: null,
          variantColourHex: null,
        });
        continue;
      }

      const regularPrice =
        vRow.price_paise_override != null
          ? Math.max(0, int(vRow.price_paise_override, basePrice))
          : basePrice;
      const trackInventory = Boolean(vRow.track_inventory);
      const variantActive =
        Boolean(vRow.variant_is_active)
        && Boolean(vRow.variant_is_purchasable)
        && vRow.variant_retired_at == null
        && (invMode !== 'variant' || vRow.stock_id != null || !trackInventory);
      const variantLabel = nullableText(vRow.variant_label);

      result.set(key, {
        productId: target.productId,
        variantId: target.variantId,
        productName: text(prod.name),
        variantLabel,
        variantSku: nullableText(vRow.variant_sku),
        regularPricePaise: regularPrice,
        imageUrl: nullableText(vRow.variant_image_url) || productImage,
        imageAlt: productAlt,
        productActive: prod.deleted_at == null && Boolean(prod.is_active),
        variantActive,
        isGiftOnly: Boolean(prod.is_gift_only),
        trackInventory,
        onHand: Math.max(0, int(vRow.on_hand, 0)),
        reserved: Math.max(0, int(vRow.reserved, 0)),
        lowStockThreshold: Math.max(0, int(vRow.low_stock_threshold, 0)),
        categoryId: nullableText(prod.category_id),
        brandId: nullableText(prod.brand_id),
        variantDeviceModelId: nullableText(vRow.variant_device_model_id),
        variantDeviceModelName: nullableText(vRow.variant_device_model_name),
        variantColourId: nullableText(vRow.variant_colour_id),
        variantColourName: nullableText(vRow.variant_colour_name),
        variantColourHex: nullableText(vRow.variant_colour_hex),
      });
    } else {
      const trackInventory = Boolean(prod.track_inventory);
      const productAvailable =
        prod.deleted_at == null
        && Boolean(prod.is_active)
        && invMode === 'product'
        && (trackInventory || prod.in_stock !== false);

      result.set(key, {
        productId: target.productId,
        variantId: null,
        productName: text(prod.name),
        variantLabel: null,
        variantSku: null,
        regularPricePaise: basePrice,
        imageUrl: productImage,
        imageAlt: productAlt,
        productActive: productAvailable,
        variantActive: invMode === 'product',
        isGiftOnly: Boolean(prod.is_gift_only),
        trackInventory,
        onHand: Math.max(0, int(prod.on_hand, 0)),
        reserved: Math.max(0, int(prod.reserved, 0)),
        lowStockThreshold: Math.max(0, int(prod.low_stock_threshold, 0)),
        categoryId: nullableText(prod.category_id),
        brandId: nullableText(prod.brand_id),
        variantDeviceModelId: null,
        variantDeviceModelName: null,
        variantColourId: null,
        variantColourName: null,
        variantColourHex: null,
      });
    }
  }

  return result;
}

export async function loadGiftCatalogSnapshotUsing(
  sql: SqlLike,
  productId: string,
  variantId: string | null,
): Promise<FreeGiftCatalogSnapshot | null> {
  const map = await loadGiftCatalogSnapshotMapUsing(sql, [{ productId, variantId }]);
  return map.get(giftTargetKey(productId, variantId)) ?? null;
}

function mapRuleRow(row: Row): FreeGiftRuleRecord {
  return {
    id: text(row.id),
    name: text(row.name),
    giftProductId: text(row.gift_product_id),
    giftVariantId: nullableText(row.gift_variant_id),
    targetPaise: Math.max(0, int(row.target_paise, 0)),
    iconUrl: text(row.icon_url),
    badgeText: text(row.badge_text) || 'FREE',
    unlockMessage: text(row.unlock_message) || 'You unlocked a free gift!',
    startsAt: isoString(row.starts_at),
    endsAt: isoString(row.ends_at),
    isActive: Boolean(row.is_active),
    showOnProductPage: Boolean(row.show_on_product_page),
    maxGiftsTotal: nullableInt(row.max_gifts_total),
    claimedCount: Math.max(0, int(row.claimed_count, 0)),
    perCustomerLimit: nullableInt(row.per_customer_limit),
    customerClaimedCount: Math.max(0, int(row.customer_claimed_count, 0)),
    priority: int(row.priority, 0),
    couponInteraction:
      row.coupon_interaction === 'disallow' ? 'disallow' : 'allow',
    minPostCouponPaise: Math.max(0, int(row.min_post_coupon_paise, 0)),
    unavailableCheckoutCount: Math.max(0, int(row.unavailable_checkout_count, 0)),
    createdAt: isoString(row.created_at) ?? new Date(0).toISOString(),
    archivedAt: isoString(row.archived_at),
  };
}

export async function loadFreeGiftRulesWithSnapshotsUsing(
  sql: SqlLike,
  options: {
    userId?: string | null;
    email?: string | null;
    includeInactive?: boolean;
  } = {},
): Promise<{ now: Date; rules: FreeGiftRuleWithSnapshot[] }> {
  if (!(await freeGiftTablesPresent(sql))) {
    return { now: new Date(), rules: [] };
  }

  const userId = options.userId ? text(options.userId).trim() : null;
  const normalizedEmail = options.email ? text(options.email).trim().toLowerCase() : '';
  const includeInactive = Boolean(options.includeInactive);

  const rows = (await sql`
    with clock as (select now() as db_now),
    usage as (
      select
        r.rule_id,
        count(*) filter (where r.state in ('RESERVED', 'CONSUMED'))::int as claimed_count,
        count(*) filter (
          where r.state in ('RESERVED', 'CONSUMED')
            and (
              (${userId}::text is not null and r.customer_user_id = ${userId})
              or (${normalizedEmail} <> '' and lower(r.customer_email) = ${normalizedEmail})
            )
        )::int as customer_claimed_count
      from free_gift_redemptions r
      group by r.rule_id
    )
    select
      g.*,
      coalesce(u.claimed_count, 0)::int as claimed_count,
      coalesce(u.customer_claimed_count, 0)::int as customer_claimed_count,
      c.db_now
    from free_gift_rules g
    cross join clock c
    left join usage u on u.rule_id = g.id
    where g.archived_at is null
      and (${includeInactive} or g.is_active = true)
    order by g.target_paise desc, g.priority desc, g.created_at asc, g.id asc
  `) as Row[];

  const now = rows[0]?.db_now ? new Date(String(rows[0].db_now)) : new Date();
  const mappedRules = rows.map(mapRuleRow);

  const snapshots = await loadGiftCatalogSnapshotMapUsing(
    sql,
    mappedRules.map((rule) => ({
      productId: rule.giftProductId,
      variantId: rule.giftVariantId,
    })),
  );

  return {
    now,
    rules: mappedRules.map((rule) => ({
      rule,
      gift:
        snapshots.get(giftTargetKey(rule.giftProductId, rule.giftVariantId)) ?? null,
    })),
  };
}

/**
 * Evaluate free gifts for cart/checkout displays. Server-only.
 */
export async function evaluateCartFreeGiftsUsing(
  sql: SqlLike,
  input: {
    lines: readonly EligibleSubtotalLine[];
    discountPaise?: number;
    couponApplied?: boolean;
    userId?: string | null;
    email?: string | null;
  },
): Promise<FreeGiftEvaluation> {
  const { now, rules } = await loadFreeGiftRulesWithSnapshotsUsing(sql, {
    userId: input.userId,
    email: input.email,
    includeInactive: false,
  });
  return evaluateFreeGiftRules({
    now,
    lines: input.lines,
    discountPaise: input.discountPaise ?? 0,
    couponApplied: Boolean(input.couponApplied),
    rules,
  });
}

export async function evaluateCartFreeGifts(input: {
  lines: readonly EligibleSubtotalLine[];
  discountPaise?: number;
  couponApplied?: boolean;
  userId?: string | null;
  email?: string | null;
}): Promise<FreeGiftEvaluation> {
  const sql = getSql();
  if (!sql) {
    return evaluateFreeGiftRules({
      now: new Date(),
      lines: input.lines,
      discountPaise: input.discountPaise ?? 0,
      couponApplied: Boolean(input.couponApplied),
      rules: [],
    });
  }
  try {
    return await evaluateCartFreeGiftsUsing(sql, input);
  } catch {
    return evaluateFreeGiftRules({
      now: new Date(),
      lines: input.lines,
      discountPaise: input.discountPaise ?? 0,
      couponApplied: Boolean(input.couponApplied),
      rules: [],
    });
  }
}

export type { ProductPageGiftPromo };

/**
 * Lightweight list of currently running product-page Free Gift strips.
 */
export async function listProductPageGiftPromosUsing(
  sql: SqlLike,
): Promise<ProductPageGiftPromo[]> {
  try {
    const evalResult = await loadFreeGiftRulesWithSnapshotsUsing(sql, {
      includeInactive: false,
    });
    const out: ProductPageGiftPromo[] = [];
    for (const { rule, gift } of evalResult.rules) {
      if (!rule.showOnProductPage) continue;
      if (rule.startsAt && evalResult.now.getTime() < Date.parse(rule.startsAt)) continue;
      if (rule.endsAt && evalResult.now.getTime() >= Date.parse(rule.endsAt)) continue;
      if (rule.maxGiftsTotal !== null && rule.claimedCount >= rule.maxGiftsTotal) continue;
      if (!gift || !gift.productActive || !gift.variantActive) continue;
      if (gift.trackInventory && gift.onHand - gift.reserved <= 0) continue;
      out.push({
        ruleId: rule.id,
        targetPaise: rule.targetPaise,
        giftName: gift.productName,
        badgeText: rule.badgeText,
        iconUrl: rule.iconUrl.trim() || gift.imageUrl,
        unlockMessage: rule.unlockMessage,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function listProductPageGiftPromos(): Promise<ProductPageGiftPromo[]> {
  const sql = getSql();
  if (!sql) return [];
  return listProductPageGiftPromosUsing(sql);
}

/**
 * Pre-flight stock identity discovery BEFORE `lockStockIdentities` in `createOrderUsing`,
 * so gift `(productId, variantId)` is locked inside the exact same sorted batch
 * as paid items (preventing AB-BA lock-order deadlocks).
 */
export async function resolveCandidateGiftStockIdentitiesInTx(
  tx: postgres.TransactionSql,
  input: {
    lines: readonly EligibleSubtotalLine[];
    couponCode?: string | null;
    confirmWithoutGift?: boolean;
  },
): Promise<{
  identities: Array<{ productId: string; variantId: string | null }>;
  thresholdRuleIds: string[];
}> {
  const identities: Array<{ productId: string; variantId: string | null }> = [];
  const thresholdRuleIds: string[] = [];

  if (!(await freeGiftTablesPresent(tx))) {
    return { identities, thresholdRuleIds };
  }

  // Check spin/coupon FREE_GIFT SKU first if a coupon code is passed.
  const cleanCode = input.couponCode ? text(input.couponCode).trim().toUpperCase() : '';
  if (cleanCode) {
    const couponGiftRows = (await tx`
      select
        (to_jsonb(c)->>'gift_product_id') as gift_product_id,
        (to_jsonb(c)->>'gift_variant_id') as gift_variant_id
      from coupons c
      where upper(c.code) = ${cleanCode}
        and c.type = 'FREE_GIFT'
      limit 1
    `) as Row[];
    const cg = couponGiftRows[0];
    if (cg?.gift_product_id) {
      identities.push({
        productId: text(cg.gift_product_id),
        variantId: nullableText(cg.gift_variant_id),
      });
    }
  }

  if (!input.confirmWithoutGift) {
    const subtotalPaise = input.lines.reduce(
      (sum, line) => sum + (line.isFreeGift ? 0 : Math.max(0, int(line.linePaise, 0))),
      0,
    );
    if (subtotalPaise > 0) {
      const ruleRows = (await tx`
        select id, gift_product_id, gift_variant_id
        from free_gift_rules
        where archived_at is null
          and is_active = true
          and target_paise <= ${subtotalPaise}
          and (starts_at is null or starts_at <= now())
          and (ends_at is null or ends_at > now())
        order by target_paise desc, priority desc, created_at asc, id asc
      `) as Row[];
      for (const row of ruleRows) {
        thresholdRuleIds.push(text(row.id));
        identities.push({
          productId: text(row.gift_product_id),
          variantId: nullableText(row.gift_variant_id),
        });
      }
    }
  }

  return { identities, thresholdRuleIds };
}

/**
 * Inside `createOrderUsing` AFTER `stock` and `coupons` locks are held:
 * lock the qualifying `free_gift_rules` row, verify cap/per-customer limit/
 * coupon compatibility under lock, and resolve the single qualifying threshold gift.
 */
export async function resolveAndLockThresholdGiftInTx(
  tx: postgres.TransactionSql,
  input: {
    lines: readonly EligibleSubtotalLine[];
    discountPaise: number;
    couponApplied: boolean;
    userId: string | null;
    email: string;
    confirmWithoutGift?: boolean;
  },
): Promise<{
  gift: {
    rule: FreeGiftRuleRecord;
    snapshot: FreeGiftCatalogSnapshot;
  } | null;
  blockedByCouponMessage: string | null;
}> {
  if (input.confirmWithoutGift || !(await freeGiftTablesPresent(tx))) {
    return { gift: null, blockedByCouponMessage: null };
  }

  const normalizedEmail = text(input.email).trim().toLowerCase();
  const { now, rules } = await loadFreeGiftRulesWithSnapshotsUsing(tx, {
    userId: input.userId,
    email: normalizedEmail,
    includeInactive: false,
  });

  const initialEval = evaluateFreeGiftRules({
    now,
    lines: input.lines,
    discountPaise: input.discountPaise,
    couponApplied: input.couponApplied,
    rules,
  });

  if (
    initialEval.conflict
    && initialEval.conflict.reason !== 'coupon_disallowed'
    && initialEval.conflict.reason !== 'below_post_coupon_minimum'
  ) {
    throw new GiftUnavailableError(initialEval.conflict);
  }
  if (!initialEval.unlockedGift) {
    return { gift: null, blockedByCouponMessage: initialEval.blockedByCouponMessage };
  }

  const candidateId = initialEval.unlockedGift.ruleId;

  // Lock this exact rule row for update so two concurrent buyers cannot claim
  // the last remaining rule quota at the same time.
  const [lockedRow] = (await tx`
    select g.*, now() as db_now
    from free_gift_rules g
    where g.id = ${candidateId}
    for update of g
  `) as Row[];

  if (!lockedRow) {
    throw new GiftUnavailableError({
      ruleId: candidateId,
      ruleName: initialEval.unlockedGift.ruleName,
      giftName: initialEval.unlockedGift.gift.productName,
      reason: 'out_of_stock',
      message: `Sorry, the free gift "${initialEval.unlockedGift.gift.productName}" is no longer available. You can continue checking out without the gift.`,
    });
  }

  const [usage] = (await tx`
    select
      count(*) filter (where state in ('RESERVED', 'CONSUMED'))::int as claimed_count,
      count(*) filter (
        where state in ('RESERVED', 'CONSUMED')
          and (
            (${input.userId}::text is not null and customer_user_id = ${input.userId})
            or (${normalizedEmail} <> '' and lower(customer_email) = ${normalizedEmail})
          )
      )::int as customer_claimed_count
    from free_gift_redemptions
    where rule_id = ${candidateId}
  `) as Row[];

  const lockedRule = mapRuleRow({
    ...lockedRow,
    claimed_count: usage?.claimed_count ?? 0,
    customer_claimed_count: usage?.customer_claimed_count ?? 0,
  });

  const lockedSnapshot = await loadGiftCatalogSnapshotUsing(
    tx,
    lockedRule.giftProductId,
    lockedRule.giftVariantId,
  );

  const recheck = evaluateFreeGiftRules({
    now: lockedRow.db_now ? new Date(String(lockedRow.db_now)) : now,
    lines: input.lines,
    discountPaise: input.discountPaise,
    couponApplied: input.couponApplied,
    rules: [{ rule: lockedRule, gift: lockedSnapshot }],
  });

  if (recheck.conflict) {
    throw new GiftUnavailableError(recheck.conflict);
  }
  if (!recheck.unlockedGift || !lockedSnapshot) {
    throw new GiftUnavailableError({
      ruleId: lockedRule.id,
      ruleName: lockedRule.name,
      giftName: lockedSnapshot?.productName ?? lockedRule.name,
      reason: 'out_of_stock',
      message: `Sorry, the free gift "${lockedSnapshot?.productName ?? lockedRule.name}" is no longer available. You can continue checking out without the gift.`,
    });
  }

  return {
    gift: { rule: lockedRule, snapshot: lockedSnapshot },
    blockedByCouponMessage: recheck.blockedByCouponMessage,
  };
}

export async function recordGiftUnavailableAttempt(
  ruleId: string,
  sqlOverride?: postgres.Sql,
): Promise<void> {
  const sql = sqlOverride ?? getSql();
  if (!sql || !ruleId) return;
  try {
    await sql`
      update free_gift_rules
      set unavailable_checkout_count = unavailable_checkout_count + 1,
          last_unavailable_at = now()
      where id = ${ruleId}
    `;
  } catch {
    // Best-effort counter update; never obscure the 409 response to checkout.
  }
}

export async function reserveFreeGiftInTx(
  tx: postgres.TransactionSql,
  input: {
    ruleId: string;
    orderId: string;
    customerUserId: string | null;
    customerEmail: string;
    giftProductId: string;
    giftVariantId: string | null;
    thresholdPaise: number;
    quantity?: number;
  },
): Promise<void> {
  if (!(await freeGiftTablesPresent(tx))) return;
  const id = `fgr_${randomBytes(10).toString('hex')}`;
  await tx`
    insert into free_gift_redemptions (
      id, rule_id, order_id, customer_user_id, customer_email,
      gift_product_id, gift_variant_id, threshold_paise, quantity, state
    )
    values (
      ${id},
      ${input.ruleId},
      ${input.orderId},
      ${input.customerUserId},
      ${text(input.customerEmail).trim().toLowerCase()},
      ${input.giftProductId},
      ${input.giftVariantId},
      ${Math.max(0, Math.trunc(input.thresholdPaise))},
      ${Math.max(1, Math.trunc(input.quantity ?? 1))},
      'RESERVED'
    )
    on conflict (order_id, rule_id) do nothing
  `;
}

export async function consumeFreeGiftInTx(
  sql: SqlLike,
  orderId: string,
): Promise<boolean> {
  if (!(await freeGiftTablesPresent(sql))) return false;
  const rows = (await sql`
    update free_gift_redemptions
    set state = 'CONSUMED',
        consumed_at = now()
    where order_id = ${orderId} and state = 'RESERVED'
    returning id
  `) as Row[];
  return rows.length > 0;
}

export async function releaseFreeGiftInTx(
  sql: SqlLike,
  orderId: string,
  reason: string,
): Promise<boolean> {
  if (!(await freeGiftTablesPresent(sql))) return false;
  const rows = (await sql`
    update free_gift_redemptions
    set state = 'RELEASED',
        released_at = now(),
        release_reason = ${reason.slice(0, 300)}
    where order_id = ${orderId} and state = 'RESERVED'
    returning id
  `) as Row[];
  return rows.length > 0;
}

export async function releaseConsumedFreeGiftInTx(
  sql: SqlLike,
  orderId: string,
  reason: string,
): Promise<boolean> {
  if (!(await freeGiftTablesPresent(sql))) return false;
  const rows = (await sql`
    update free_gift_redemptions
    set state = 'RELEASED',
        released_at = now(),
        release_reason = ${reason.slice(0, 300)}
    where order_id = ${orderId} and state = 'CONSUMED'
    returning id
  `) as Row[];
  return rows.length > 0;
}

export async function restoreFreeGiftAfterLatePayment(
  sql: SqlLike,
  orderId: string,
): Promise<'restored' | 'limit-unavailable' | 'none'> {
  if (!(await freeGiftTablesPresent(sql))) return 'none';
  const rows = (await sql`
    select
      r.id, r.rule_id, r.customer_user_id, r.customer_email, r.state,
      g.max_gifts_total, g.per_customer_limit
    from free_gift_redemptions r
    join free_gift_rules g on g.id = r.rule_id
    where r.order_id = ${orderId}
    for update of r
  `) as Row[];

  const row = rows[0];
  if (!row || text(row.state) !== 'RELEASED') return 'none';

  const ruleId = text(row.rule_id);
  const userId = nullableText(row.customer_user_id);
  const email = text(row.customer_email).trim().toLowerCase();
  const maxTotal = nullableInt(row.max_gifts_total);
  const perCust = nullableInt(row.per_customer_limit);

  const [counts] = (await sql`
    select
      count(*)::int as total,
      count(*) filter (
        where (${userId}::text is not null and customer_user_id = ${userId})
           or (${email} <> '' and lower(customer_email) = ${email})
      )::int as mine
    from free_gift_redemptions
    where rule_id = ${ruleId}
      and state in ('RESERVED', 'CONSUMED')
      and id <> ${text(row.id)}
  `) as Row[];

  if (maxTotal !== null && int(counts?.total, 0) >= maxTotal) {
    return 'limit-unavailable';
  }
  if (perCust !== null && int(counts?.mine, 0) >= perCust) {
    return 'limit-unavailable';
  }

  const updated = (await sql`
    update free_gift_redemptions
    set state = 'CONSUMED',
        consumed_at = now()
    where id = ${text(row.id)} and state = 'RELEASED'
    returning id
  `) as Row[];
  return updated.length > 0 ? 'restored' : 'none';
}

export type FreeGiftUsageRow = {
  id: string;
  ruleId: string;
  thresholdPaise: number;
  giftProductName: string;
};

export async function getOrderThresholdGiftsInTx(
  sql: SqlLike,
  orderId: string,
): Promise<FreeGiftUsageRow[]> {
  if (!(await freeGiftTablesPresent(sql))) return [];
  const rows = (await sql`
    select r.id, r.rule_id, r.threshold_paise,
           coalesce(oi.product_name, p.name, r.gift_product_id) as gift_product_name
    from free_gift_redemptions r
    left join products p on p.id = r.gift_product_id
    left join order_items oi
      on oi.order_id = r.order_id
     and oi.free_gift_rule_id = r.rule_id
    where r.order_id = ${orderId}
      and r.state in ('RESERVED', 'CONSUMED')
  `) as Row[];
  return rows.map((row) => ({
    id: text(row.id),
    ruleId: text(row.rule_id),
    thresholdPaise: Math.max(0, int(row.threshold_paise, 0)),
    giftProductName: text(row.gift_product_name),
  }));
}

/**
 * Check whether adding a refund or return to an order with a threshold-unlocked
 * free gift brings remaining paid items below the gift threshold. Returns an
 * updated note string with `"Free gift (...) may need to be returned..."`
 * appended once (or `existingNote` unchanged when still above threshold / no threshold gift).
 */
export async function appendFreeGiftReturnThresholdNoteInTx(
  tx: SqlLike,
  input: {
    orderId: string;
    additionalRefundPaise: number;
    existingNote: string;
    maxLength: number;
  },
): Promise<{ note: string; appended: string | null }> {
  const existingNote = text(input.existingNote).trim();
  const thresholdGifts = await getOrderThresholdGiftsInTx(tx, input.orderId);
  if (thresholdGifts.length === 0) {
    return { note: existingNote.slice(0, input.maxLength), appended: null };
  }

  const [totals] = (await tx`
    select
      coalesce(o.subtotal_paise, 0)::bigint as subtotal_paise,
      coalesce(sum(f.amount_paise)::bigint, 0) as refunded_paise
    from orders o
    left join refunds f on f.order_id = o.id
    where o.id = ${input.orderId}
    group by o.id
  `) as Row[];

  const paidSubtotalPaise = Math.max(0, int(totals?.subtotal_paise, 0));
  const alreadyRefundedPaise = Math.max(0, int(totals?.refunded_paise, 0));
  const refundedAfter = alreadyRefundedPaise + Math.max(0, Math.trunc(input.additionalRefundPaise));

  const notesToAppend: string[] = [];
  for (const gift of thresholdGifts) {
    const thresholdNote = checkFreeGiftReturnThresholdNote({
      orderPaidItemSubtotalPaise: paidSubtotalPaise,
      refundedPaiseTotalAfter: refundedAfter,
      giftThresholdPaise: gift.thresholdPaise,
      giftProductName: gift.giftProductName,
    });
    if (thresholdNote && !existingNote.includes(`Free gift (${gift.giftProductName}) may need to be returned`)) {
      notesToAppend.push(thresholdNote);
    }
  }

  if (notesToAppend.length === 0) {
    return { note: existingNote.slice(0, input.maxLength), appended: null };
  }

  const appended = notesToAppend.join(' ');
  const combined = existingNote ? `${existingNote} — ${appended}` : appended;
  return {
    note: combined.slice(0, input.maxLength),
    appended,
  };
}

export interface GiftProductVariantPickerOption {
  id: string;
  sku: string;
  label: string;
  pricePaise: number;
  isActive: boolean;
  trackInventory: boolean;
  availableQty: number | null;
}

export interface GiftProductPickerOption {
  id: string;
  name: string;
  pricePaise: number;
  isGiftOnly: boolean;
  isActive: boolean;
  trackInventory: boolean;
  availableQty: number | null;
  imageUrl: string | null;
  variants: GiftProductVariantPickerOption[];
}

/**
 * Shared Store Admin picker for Free Gifts and Spin Wheel FREE_GIFT slices.
 * Includes active (and `is_gift_only`) products, their variants, and live
 * purchasable stock counts. Safe against subset schema test DBs.
 */
export async function listGiftProductPickerOptionsUsing(
  sql: SqlLike,
  options: { includeInactive?: boolean } = {},
): Promise<GiftProductPickerOption[]> {
  const [schema] = (await sql`
    select
      to_regclass('products')::text as has_products,
      to_regclass('product_variants')::text as has_variants,
      to_regclass('product_images')::text as has_images,
      to_regclass('stock')::text as has_stock
  `) as Array<{
    has_products: string | null;
    has_variants: string | null;
    has_images: string | null;
    has_stock: string | null;
  }>;

  if (!schema?.has_products) return [];

  const includeInactive = options.includeInactive === true;
  const imageExpr = schema.has_images
    ? sql`
        (
          select pi.url
          from product_images pi
          where pi.product_id = p.id
            and pi.is_active
            and pi.deleted_at is null
          order by
            case pi.role when 'primary' then 0 when 'hover' then 1 else 2 end,
            pi.sort_order,
            pi.id
          limit 1
        ) as image_url,
      `
    : sql`null::text as image_url,`;
  const stockSelect = schema.has_stock
    ? sql`
        coalesce(s.track_inventory, false) as track_inventory,
        s.on_hand,
        s.reserved
      `
    : sql`
        false as track_inventory,
        null::int as on_hand,
        null::int as reserved
      `;
  const stockJoin = schema.has_stock
    ? sql`left join stock s on s.product_id = p.id and s.variant_id is null`
    : sql``;

  const productRows = (await sql`
    select
      p.id,
      p.name,
      p.price_paise,
      p.is_active,
      coalesce((to_jsonb(p)->>'is_gift_only')::boolean, false) as is_gift_only,
      ${imageExpr}
      ${stockSelect}
    from products p
    ${stockJoin}
    where p.deleted_at is null
      and (${includeInactive}::boolean or p.is_active = true)
    order by
      coalesce((to_jsonb(p)->>'is_gift_only')::boolean, false) desc,
      p.sort_order asc,
      p.name asc
    limit 250
  `) as Row[];

  const productIds = productRows.map((r) => text(r.id)).filter(Boolean);
  const variantsByProduct = new Map<string, GiftProductVariantPickerOption[]>();

  if (schema.has_variants && productIds.length > 0) {
    const varStockSelect = schema.has_stock
      ? sql`
          coalesce(vs.track_inventory, false) as track_inventory,
          vs.on_hand,
          vs.reserved
        `
      : sql`
          false as track_inventory,
          null::int as on_hand,
          null::int as reserved
        `;
    const varStockJoin = schema.has_stock
      ? sql`left join stock vs on vs.product_id = v.product_id and vs.variant_id = v.id`
      : sql``;
    const variantRows = (await sql`
      select
        v.id,
        v.product_id,
        v.sku,
        v.is_active,
        v.is_purchasable,
        v.retired_at,
        v.price_paise_override,
        concat_ws(' / ', dm.name, nullif(btrim(v.option_value), '')) as label,
        ${varStockSelect}
      from product_variants v
      left join device_models dm on dm.id = v.device_model_id
      ${varStockJoin}
      where v.product_id = any(${productIds}::text[])
        and (${includeInactive}::boolean or (v.is_active = true and v.is_purchasable = true and v.retired_at is null))
      order by v.sort_order asc, v.sku asc
    `) as Row[];

    for (const vr of variantRows) {
      const pid = text(vr.product_id);
      const track = Boolean(vr.track_inventory);
      const availableQty = track
        ? Math.max(0, int(vr.on_hand, 0) - int(vr.reserved, 0))
        : null;
      const list = variantsByProduct.get(pid) ?? [];
      list.push({
        id: text(vr.id),
        sku: text(vr.sku),
        label: nullableText(vr.label) || text(vr.sku) || text(vr.id),
        pricePaise: Math.max(0, int(vr.price_paise_override, 0)),
        isActive: Boolean(vr.is_active) && Boolean(vr.is_purchasable) && vr.retired_at == null,
        trackInventory: track,
        availableQty,
      });
      variantsByProduct.set(pid, list);
    }
  }

  return productRows.map((pr) => {
    const id = text(pr.id);
    const track = Boolean(pr.track_inventory);
    const availableQty = track
      ? Math.max(0, int(pr.on_hand, 0) - int(pr.reserved, 0))
      : null;
    const basePrice = Math.max(0, int(pr.price_paise, 0));
    const variants = (variantsByProduct.get(id) ?? []).map((v) => ({
      ...v,
      pricePaise: v.pricePaise > 0 ? v.pricePaise : basePrice,
    }));
    return {
      id,
      name: text(pr.name),
      pricePaise: basePrice,
      isGiftOnly: Boolean(pr.is_gift_only),
      isActive: Boolean(pr.is_active),
      trackInventory: track,
      availableQty,
      imageUrl: nullableText(pr.image_url),
      variants,
    };
  });
}

export type { CouponFreeGiftPreview };

/**
 * Shared stock and active check for a coupon-granted `FREE_GIFT` (e.g. won on
 * Spin and Win), used identically by `/api/coupons/validate` and
 * `/api/free-gifts/evaluate` so preview matches checkout locking.
 */
export async function resolveCouponFreeGiftPreviewUsing(
  sql: SqlLike,
  input: {
    productId: string;
    variantId: string | null;
    cartItems: ReadonlyArray<{ id: string; variantId?: string | null; quantity: number }>;
  },
): Promise<
  | { ok: true; gift: CouponFreeGiftPreview }
  | { ok: false; giftName: string; message: string }
> {
  const snapshot = await loadGiftCatalogSnapshotUsing(sql, input.productId, input.variantId);
  const giftName = snapshot?.productName ?? 'reward item';
  if (!snapshot || !snapshot.productActive || !snapshot.variantActive) {
    return {
      ok: false,
      giftName,
      message: `Sorry, the free gift "${giftName}" for this reward is currently out of stock. Remove the code to place your order.`,
    };
  }

  if (snapshot.trackInventory) {
    const existingCartQty = input.cartItems.reduce((sum, item) => {
      if (item.id !== snapshot.productId) return sum;
      if (snapshot.variantId && (item.variantId ?? null) !== snapshot.variantId) return sum;
      return sum + Math.max(0, Math.trunc(item.quantity));
    }, 0);
    const available = Math.max(0, snapshot.onHand - snapshot.reserved);
    if (available < existingCartQty + 1) {
      return {
        ok: false,
        giftName,
        message: `Sorry, the free gift "${giftName}" for this reward is currently out of stock. Remove the code to place your order.`,
      };
    }
  }

  return {
    ok: true,
    gift: {
      productId: snapshot.productId,
      variantId: snapshot.variantId,
      productName: snapshot.productName,
      variantLabel: snapshot.variantLabel,
      regularPricePaise: snapshot.regularPricePaise,
      imageUrl: snapshot.imageUrl,
      badge: 'GIFT',
      source: 'spin_wheel',
    },
  };
}

