/**
 * Pure rules for Checkout Trust Review + Delivery & Dispatch Announcements.
 *
 * Database-free and framework-free so the server, API routes, Store Admin live
 * preview, and unit tests all run the exact same normalization, sanitization,
 * and fail-closed resolution logic.
 */

import {
  CHECKOUT_DELIVERY_ICONS,
  CHECKOUT_MAX_DELIVERY_DAYS,
  CHECKOUT_MIN_DELIVERY_DAYS,
  CHECKOUT_TRUST_MODES,
  containsContactPii,
  parseDeliveryDays,
  type CheckoutDeliveryIcon,
  type CheckoutTrustMode,
} from '@/lib/store-admin/settings-rules';

export {
  CHECKOUT_DELIVERY_ICONS,
  CHECKOUT_MAX_DELIVERY_DAYS,
  CHECKOUT_MIN_DELIVERY_DAYS,
  CHECKOUT_TRUST_MODES,
  containsContactPii,
  parseDeliveryDays,
  type CheckoutDeliveryIcon,
  type CheckoutTrustMode,
};

export const CHECKOUT_TRUST_DELIVERY_PREFIXES = [
  'checkout_trust_',
  'checkout_delivery_',
] as const;

export function isCheckoutTrustDeliveryKey(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    CHECKOUT_TRUST_DELIVERY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/** Genuine review metadata safe for Store Admin selection (no email/orderId/userId). */
export interface CheckoutEligibleReview {
  id: string;
  productName: string;
  customerName: string;
  rating: number;
  title: string;
  body: string;
  /** True only when PostgreSQL confirmed a real, non-test PAID order + verified flag. */
  orderVerified: boolean;
  createdAt: string;
}

export interface PublicCheckoutTrustReview {
  kind: 'review';
  quote: string;
  reviewerName: string;
  rating: number;
  verifiedPurchase: boolean;
}

export interface PublicCheckoutTrustMessage {
  kind: 'trust_message';
  quote: string;
  authorLabel: string | null;
}

export type PublicCheckoutTrustItem =
  | PublicCheckoutTrustReview
  | PublicCheckoutTrustMessage;

export interface PublicCheckoutDeliveryAnnouncement {
  mode: 'normal' | 'sale';
  title: string;
  mainMessage: string;
  description: string;
  estimateNote: string | null;
  icon: CheckoutDeliveryIcon;
}

export interface PublicCheckoutTrustDeliveryPayload {
  trust: PublicCheckoutTrustItem | null;
  delivery: PublicCheckoutDeliveryAnnouncement | null;
  saleLive: boolean;
}

export function formatDeliveryRangeMessage(minDays: number, maxDays: number): string {
  if (minDays === 1 && maxDays === 1) return 'Delivered in 1 day';
  if (minDays === maxDays) return `Delivered in ${minDays} days`;
  return `Delivered in ${minDays}–${maxDays} days`;
}

/**
 * Format a public reviewer display name or initials safely without exposing PII.
 * Multi-word names compact to "First L." unless already an initial form like "A. M.".
 */
export function formatPublicReviewerName(rawName: string, override?: string): string {
  const cleanOverride = (override ?? '').trim();
  if (cleanOverride && !containsContactPii(cleanOverride)) {
    return cleanOverride.slice(0, 60);
  }

  const cleaned = (rawName ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned || containsContactPii(cleaned)) {
    return 'Gadzio Customer';
  }

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 60);
  }

  // Preserve already-abbreviated forms such as "Aarav M." or "A. M."
  const last = parts[parts.length - 1];
  if (last.length <= 2 && /^[A-Za-z]\.?$/.test(last)) {
    return parts.join(' ').slice(0, 60);
  }

  const first = parts[0];
  const lastInitial = last.charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`.slice(0, 60);
}

export function truncateReviewQuote(text: string, maxLen = 220): string {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= maxLen) return collapsed;
  const slice = collapsed.slice(0, Math.max(1, maxLen - 1));
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(maxLen * 0.5) ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

export function validateCheckoutTrustDeliveryCrossFields(
  settings: Record<string, string>,
): { ok: true } | { ok: false; error: string } {
  const minDays = parseDeliveryDays(settings.checkout_delivery_normal_min_days);
  const maxDays = parseDeliveryDays(settings.checkout_delivery_normal_max_days);

  if (minDays === null || maxDays === null) {
    return {
      ok: false,
      error: `Minimum and maximum delivery days must be whole numbers between ${CHECKOUT_MIN_DELIVERY_DAYS} and ${CHECKOUT_MAX_DELIVERY_DAYS}.`,
    };
  }
  if (minDays > maxDays) {
    return {
      ok: false,
      error: 'Minimum delivery days cannot be greater than maximum delivery days.',
    };
  }

  if (
    settings.checkout_delivery_normal_enabled === 'on' &&
    (settings.checkout_delivery_normal_title ?? '').trim() === ''
  ) {
    return {
      ok: false,
      error: 'Normal delivery announcement title is required when enabled.',
    };
  }

  if (settings.checkout_delivery_sale_enabled === 'on') {
    if ((settings.checkout_delivery_sale_title ?? '').trim() === '') {
      return {
        ok: false,
        error: 'Sale delivery announcement title is required when enabled.',
      };
    }
    if ((settings.checkout_delivery_sale_message ?? '').trim() === '') {
      return {
        ok: false,
        error: 'Sale dispatch main message is required when enabled.',
      };
    }
  }

  if (
    (settings.checkout_trust_reviewer_name ?? '').trim() !== '' &&
    containsContactPii(settings.checkout_trust_reviewer_name ?? '')
  ) {
    return {
      ok: false,
      error: 'Reviewer display name cannot contain an email address or phone number.',
    };
  }

  if (
    (settings.checkout_trust_text ?? '').trim() !== '' &&
    containsContactPii(settings.checkout_trust_text ?? '')
  ) {
    return {
      ok: false,
      error: 'Trust/review text cannot contain an email address or phone number.',
    };
  }

  if (settings.checkout_trust_enabled === 'on') {
    const mode = settings.checkout_trust_mode;
    if (
      mode === 'trust_message' &&
      (settings.checkout_trust_text ?? '').trim() === ''
    ) {
      return {
        ok: false,
        error: 'Enter a trust message before enabling the checkout trust card.',
      };
    }
    if (
      mode === 'manual_review' &&
      (settings.checkout_trust_review_id ?? '').trim() === ''
    ) {
      return {
        ok: false,
        error: 'Select a published customer review before enabling manual review mode.',
      };
    }
  }

  return { ok: true };
}

function safeDeliveryIcon(
  raw: unknown,
  fallback: CheckoutDeliveryIcon,
): CheckoutDeliveryIcon {
  if (
    typeof raw === 'string' &&
    (CHECKOUT_DELIVERY_ICONS as readonly string[]).includes(raw)
  ) {
    return raw as CheckoutDeliveryIcon;
  }
  return fallback;
}

function parseRating(raw: unknown): number | null {
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 5) return null;
  return num;
}

export function resolveCheckoutTrustItem(
  settings: Record<string, string>,
  eligibleReviews: readonly CheckoutEligibleReview[],
  options?: { nowMs?: number; rotationIndex?: number },
): PublicCheckoutTrustItem | null {
  if (settings.checkout_trust_enabled !== 'on') return null;

  const mode = settings.checkout_trust_mode;
  const showVerified = settings.checkout_trust_show_verified === 'on';

  if (mode === 'trust_message') {
    const quote = truncateReviewQuote(settings.checkout_trust_text ?? '', 240);
    if (!quote || containsContactPii(quote)) return null;
    const rawAuthor = (settings.checkout_trust_reviewer_name ?? '').trim().slice(0, 60);
    const authorLabel =
      rawAuthor && !containsContactPii(rawAuthor) ? rawAuthor : null;
    return {
      kind: 'trust_message',
      quote,
      authorLabel,
    };
  }

  if (mode === 'manual_review') {
    const targetId = (settings.checkout_trust_review_id ?? '').trim();
    if (!targetId) return null;
    const review = eligibleReviews.find((entry) => entry.id === targetId);
    if (!review) return null;

    const rating = parseRating(review.rating);
    if (rating === null) return null;

    const rawOverride = (settings.checkout_trust_text ?? '').trim();
    const baseText = (review.body ?? '').trim() || (review.title ?? '').trim();
    const chosenText =
      rawOverride && !containsContactPii(rawOverride) ? rawOverride : baseText;
    const quote = truncateReviewQuote(chosenText, 240);
    if (!quote || containsContactPii(quote)) return null;

    return {
      kind: 'review',
      quote,
      reviewerName: formatPublicReviewerName(
        review.customerName,
        settings.checkout_trust_reviewer_name,
      ),
      rating,
      verifiedPurchase: review.orderVerified === true && showVerified,
    };
  }

  if (mode === 'auto_rotate') {
    const minRating = parseRating(settings.checkout_trust_min_rating) ?? 4;
    const verifiedOnly = settings.checkout_trust_verified_only === 'on';

    const pool = eligibleReviews.filter((review) => {
      const rating = parseRating(review.rating);
      if (rating === null || rating < minRating) return false;
      if (verifiedOnly && review.orderVerified !== true) return false;
      const text = (review.body ?? '').trim() || (review.title ?? '').trim();
      if (!text || containsContactPii(text)) return false;
      return true;
    });

    if (pool.length === 0) return null;

    const index =
      typeof options?.rotationIndex === 'number' &&
      Number.isFinite(options.rotationIndex)
        ? Math.abs(Math.trunc(options.rotationIndex)) % pool.length
        : Math.floor((options?.nowMs ?? Date.now()) / 3_600_000) % pool.length;

    const picked = pool[index];
    const rating = parseRating(picked.rating);
    if (rating === null) return null;

    const quote = truncateReviewQuote(
      (picked.body ?? '').trim() || (picked.title ?? '').trim(),
      220,
    );
    if (!quote || containsContactPii(quote)) return null;

    return {
      kind: 'review',
      quote,
      reviewerName: formatPublicReviewerName(picked.customerName),
      rating,
      verifiedPurchase: picked.orderVerified === true && showVerified,
    };
  }

  return null;
}

export function resolveCheckoutDeliveryAnnouncement(
  settings: Record<string, string>,
  saleLive: boolean,
): PublicCheckoutDeliveryAnnouncement | null {
  if (saleLive) {
    if (settings.checkout_delivery_sale_enabled !== 'on') return null;
    const title = (settings.checkout_delivery_sale_title ?? '').trim().slice(0, 80);
    const mainMessage = (settings.checkout_delivery_sale_message ?? '').trim().slice(0, 160);
    if (!title || !mainMessage) return null;
    const description = (settings.checkout_delivery_sale_description ?? '').trim().slice(0, 300);
    const estimateRaw = (settings.checkout_delivery_sale_estimate ?? '').trim().slice(0, 120);
    return {
      mode: 'sale',
      title,
      mainMessage,
      description,
      estimateNote: estimateRaw || null,
      icon: safeDeliveryIcon(settings.checkout_delivery_sale_icon, 'clock'),
    };
  }

  if (settings.checkout_delivery_normal_enabled !== 'on') return null;
  const title = (settings.checkout_delivery_normal_title ?? '').trim().slice(0, 80);
  const minDays = parseDeliveryDays(settings.checkout_delivery_normal_min_days);
  const maxDays = parseDeliveryDays(settings.checkout_delivery_normal_max_days);
  if (!title || minDays === null || maxDays === null || minDays > maxDays) {
    return null;
  }
  const description = (settings.checkout_delivery_normal_description ?? '').trim().slice(0, 300);
  return {
    mode: 'normal',
    title,
    mainMessage: formatDeliveryRangeMessage(minDays, maxDays),
    description,
    estimateNote: null,
    icon: safeDeliveryIcon(settings.checkout_delivery_normal_icon, 'truck'),
  };
}

export function resolveCheckoutTrustDelivery(
  settings: Record<string, string>,
  eligibleReviews: readonly CheckoutEligibleReview[],
  saleLive: boolean,
  options?: { nowMs?: number; rotationIndex?: number },
): PublicCheckoutTrustDeliveryPayload {
  return {
    trust: resolveCheckoutTrustItem(settings, eligibleReviews, options),
    delivery: resolveCheckoutDeliveryAnnouncement(settings, saleLive),
    saleLive,
  };
}
