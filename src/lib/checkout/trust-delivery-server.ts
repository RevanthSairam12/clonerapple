import type postgres from 'postgres';
import type { TransactionSql } from 'postgres';

import { getSql } from '@/lib/platform/db';
import { DEFAULT_SETTINGS, isStoreSettingKey } from '@/lib/store-admin/settings-rules';
import { readSaleState } from '@/lib/storefront/sale-state';

import {
  resolveCheckoutTrustDelivery,
  type CheckoutEligibleReview,
  type PublicCheckoutTrustDeliveryPayload,
} from './trust-delivery-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Checkout trust & delivery server data must be read on the server only.');
}

export const CHECKOUT_TRUST_DELIVERY_CACHE_TTL_MS = 3_000;

interface CacheSlot<T> {
  value: T | null;
  at: number;
  inflight: Promise<T | null> | null;
}

interface TrustDeliveryCache {
  settings: CacheSlot<Record<string, string>>;
  reviews: CacheSlot<CheckoutEligibleReview[]>;
}

const globalForTrustDelivery = globalThis as typeof globalThis & {
  __gadzioCheckoutTrustDeliveryCache?: TrustDeliveryCache;
};

function cacheStore(): TrustDeliveryCache {
  if (!globalForTrustDelivery.__gadzioCheckoutTrustDeliveryCache) {
    globalForTrustDelivery.__gadzioCheckoutTrustDeliveryCache = {
      settings: { value: null, at: 0, inflight: null },
      reviews: { value: null, at: 0, inflight: null },
    };
  }
  return globalForTrustDelivery.__gadzioCheckoutTrustDeliveryCache;
}

export function clearCheckoutTrustDeliveryCache(): void {
  const store = cacheStore();
  store.settings.value = null;
  store.settings.at = 0;
  store.settings.inflight = null;
  store.reviews.value = null;
  store.reviews.at = 0;
  store.reviews.inflight = null;
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

/**
 * Query published product reviews with genuine server-verified paid order check.
 * Deliberately excludes customer_email, order_id, user_id, rejection_reason,
 * and store_reply.
 */
export async function listPublishedCheckoutReviewsUsing(
  sql: postgres.Sql | TransactionSql,
): Promise<CheckoutEligibleReview[]> {
  const rows = (await sql`
    select
      r.id,
      p.name as product_name,
      r.customer_name,
      r.rating,
      r.title,
      r.body,
      r.created_at,
      (
        r.verified_purchase = true
        and o.id is not null
        and o.status = 'PAID'
        and o.is_test = false
      ) as order_verified
    from product_reviews r
    join products p on p.id = r.product_id
    left join orders o on o.id = r.order_id
    where r.status = 'published'
    order by r.created_at desc, r.id desc
    limit 100
  `) as Row[];

  return rows.map((row) => ({
    id: text(row.id),
    productName: text(row.product_name),
    customerName: text(row.customer_name),
    rating: Number(row.rating) || 0,
    title: text(row.title),
    body: text(row.body),
    orderVerified: row.order_verified === true,
    createdAt: iso(row.created_at),
  }));
}

/** Uncached read for Store Admin Settings so newly published reviews appear immediately. */
export async function listAdminCheckoutReviews(): Promise<CheckoutEligibleReview[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    return await listPublishedCheckoutReviewsUsing(sql);
  } catch {
    console.warn('[checkout/trust-delivery] could not read published reviews for admin');
    return [];
  }
}

export async function listCachedPublishedCheckoutReviews(): Promise<CheckoutEligibleReview[]> {
  const sql = getSql();
  if (!sql) return [];

  const slot = cacheStore().reviews;
  const now = Date.now();
  if (slot.value && now - slot.at < CHECKOUT_TRUST_DELIVERY_CACHE_TTL_MS) {
    return slot.value;
  }
  if (slot.inflight) {
    return (await slot.inflight) ?? [];
  }

  const inflight = (async (): Promise<CheckoutEligibleReview[] | null> => {
    try {
      const reviews = await listPublishedCheckoutReviewsUsing(sql);
      slot.value = reviews;
      slot.at = Date.now();
      return reviews;
    } catch {
      console.warn('[checkout/trust-delivery] could not read published reviews');
      slot.value = null;
      slot.at = 0;
      return null;
    }
  })().finally(() => {
    if (slot.inflight === inflight) slot.inflight = null;
  });

  slot.inflight = inflight;
  return (await inflight) ?? [];
}

async function readTrustDeliverySettingsUsing(
  sql: postgres.Sql | TransactionSql,
): Promise<Record<string, string>> {
  const rows = (await sql`
    select key, value
    from store_settings
    where key like 'checkout_trust_%' or key like 'checkout_delivery_%'
  `) as Row[];

  const merged: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = text(row.key);
    if (isStoreSettingKey(key)) {
      merged[key] = text(row.value);
    }
  }
  return merged;
}

export async function readCachedCheckoutTrustDeliverySettings(): Promise<Record<string, string> | null> {
  const sql = getSql();
  if (!sql) return null;

  const slot = cacheStore().settings;
  const now = Date.now();
  if (slot.value && now - slot.at < CHECKOUT_TRUST_DELIVERY_CACHE_TTL_MS) {
    return slot.value;
  }
  if (slot.inflight) {
    return slot.inflight;
  }

  const inflight = (async (): Promise<Record<string, string> | null> => {
    try {
      const settings = await readTrustDeliverySettingsUsing(sql);
      slot.value = settings;
      slot.at = Date.now();
      return settings;
    } catch {
      console.warn('[checkout/trust-delivery] could not read checkout trust/delivery settings');
      slot.value = null;
      slot.at = 0;
      return null;
    }
  })().finally(() => {
    if (slot.inflight === inflight) slot.inflight = null;
  });

  slot.inflight = inflight;
  return inflight;
}

export async function getPublicCheckoutTrustDelivery(options?: {
  settings?: Record<string, string> | null;
  saleLive?: boolean;
  sql?: postgres.Sql;
}): Promise<PublicCheckoutTrustDeliveryPayload> {
  const saleLive =
    typeof options?.saleLive === 'boolean'
      ? options.saleLive
      : (await readSaleState()).live;

  let settings: Record<string, string> | null = options?.settings ?? null;
  if (!settings) {
    if (options?.sql) {
      try {
        settings = await readTrustDeliverySettingsUsing(options.sql);
      } catch {
        settings = null;
      }
    } else {
      settings = await readCachedCheckoutTrustDeliverySettings();
    }
  }

  if (!settings) {
    return { trust: null, delivery: null, saleLive };
  }

  const needsDbReviews =
    settings.checkout_trust_enabled === 'on' &&
    (settings.checkout_trust_mode === 'manual_review' ||
      settings.checkout_trust_mode === 'auto_rotate');

  let reviews: CheckoutEligibleReview[] = [];
  if (needsDbReviews) {
    if (options?.sql) {
      try {
        reviews = await listPublishedCheckoutReviewsUsing(options.sql);
      } catch {
        reviews = [];
      }
    } else {
      reviews = await listCachedPublishedCheckoutReviews();
    }
  }

  return resolveCheckoutTrustDelivery(settings, reviews, saleLive);
}
