/** Pure review moderation rules. No database, no framework. */

export const REVIEW_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_ACTIONS = ['publish', 'reject', 'reply'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

/**
 * Moderation only moves between visible states:
 * pending → published | rejected, rejected → published, published → rejected.
 * A review is never deleted; hiding it keeps it auditable.
 */
export function canTransitionReview(from: ReviewStatus, to: ReviewStatus): boolean {
  if (from === to) return false;
  if (from === 'pending') return to === 'published' || to === 'rejected';
  if (from === 'published') return to === 'rejected';
  if (from === 'rejected') return to === 'published';
  return false;
}

/** `null` when the reason is usable, otherwise the message. */
export function rejectionReasonError(reason: unknown): string | null {
  if (typeof reason !== 'string') return 'A rejection reason is required.';
  const trimmed = reason.trim();
  if (trimmed.length < 1) return 'A rejection reason is required.';
  if (trimmed.length > 300) return 'The rejection reason must be 300 characters or fewer.';
  return null;
}

/** `null` when the reply is usable, otherwise the message. */
export function replyError(reply: unknown): string | null {
  if (typeof reply !== 'string') return 'A reply is required.';
  const trimmed = reply.trim();
  if (trimmed.length < 1) return 'A reply is required.';
  if (trimmed.length > 2000) return 'The reply must be 2,000 characters or fewer.';
  return null;
}

/**
 * Customer emails are kept for fraud checks but never rendered whole.
 * `priya@example.com` → `p***@example.com`.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed ? '***' : '';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  return `${local.slice(0, 1)}***${domain}`;
}
