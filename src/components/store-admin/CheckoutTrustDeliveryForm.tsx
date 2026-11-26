'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import {
  CheckoutDeliveryAnnouncementCard,
  CheckoutTrustReviewCard,
} from '@/components/checkout/CheckoutTrustDeliveryCards';
import { SaleStatusBadge } from '@/components/store-admin/SaleStatusBadge';
import {
  CHECKOUT_DELIVERY_ICONS,
  CHECKOUT_MAX_DELIVERY_DAYS,
  CHECKOUT_MIN_DELIVERY_DAYS,
  CHECKOUT_TRUST_MODES,
  parseDeliveryDays,
  resolveCheckoutTrustDelivery,
  truncateReviewQuote,
  type CheckoutEligibleReview,
} from '@/lib/checkout/trust-delivery-rules';
import type { SaleStatus } from '@/lib/storefront/sale';

const CHECKOUT_KEYS = [
  'checkout_trust_enabled',
  'checkout_trust_mode',
  'checkout_trust_review_id',
  'checkout_trust_text',
  'checkout_trust_reviewer_name',
  'checkout_trust_min_rating',
  'checkout_trust_show_verified',
  'checkout_trust_verified_only',
  'checkout_delivery_normal_enabled',
  'checkout_delivery_normal_title',
  'checkout_delivery_normal_min_days',
  'checkout_delivery_normal_max_days',
  'checkout_delivery_normal_description',
  'checkout_delivery_normal_icon',
  'checkout_delivery_sale_enabled',
  'checkout_delivery_sale_title',
  'checkout_delivery_sale_message',
  'checkout_delivery_sale_description',
  'checkout_delivery_sale_estimate',
  'checkout_delivery_sale_icon',
] as const;

const ICON_LABELS: Record<(typeof CHECKOUT_DELIVERY_ICONS)[number], string> = {
  truck: 'Delivery truck',
  package: 'Package box',
  clock: 'Clock',
  calendar: 'Calendar',
  sparkles: 'Sparkles',
  none: 'No icon',
};

function pickInitial(source: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CHECKOUT_KEYS) {
    out[key] = source[key] ?? '';
  }
  return out;
}

interface Props {
  initial: Record<string, string>;
  reviews: CheckoutEligibleReview[];
  saleStatus: SaleStatus;
  saleLive: boolean;
  canEdit: boolean;
}

export function CheckoutTrustDeliveryForm({
  initial,
  reviews,
  saleStatus,
  saleLive,
  canEdit,
}: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, string>>(() => pickInitial(initial));
  const [values, setValues] = useState<Record<string, string>>(() => pickInitial(initial));
  const [previewSaleLive, setPreviewSaleLive] = useState<boolean>(saleLive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const changed = useMemo(
    () =>
      CHECKOUT_KEYS.filter((key) => (saved[key] ?? '') !== (values[key] ?? '')).map(
        (key) => ({ key, value: values[key] ?? '' }),
      ),
    [saved, values],
  );

  const minRating = Number(values.checkout_trust_min_rating) || 4;
  const filteredReviews = useMemo(
    () => reviews.filter((review) => review.rating >= minRating),
    [reviews, minRating],
  );
  const selectedReview = useMemo(
    () => reviews.find((review) => review.id === values.checkout_trust_review_id) ?? null,
    [reviews, values.checkout_trust_review_id],
  );
  const autoRotatePoolCount = useMemo(() => {
    const verifiedOnly = values.checkout_trust_verified_only === 'on';
    return reviews.filter(
      (review) =>
        review.rating >= minRating &&
        (!verifiedOnly || review.orderVerified) &&
        ((review.body ?? '').trim().length > 0 || (review.title ?? '').trim().length > 0),
    ).length;
  }, [reviews, minRating, values.checkout_trust_verified_only]);

  const minDays = parseDeliveryDays(values.checkout_delivery_normal_min_days);
  const maxDays = parseDeliveryDays(values.checkout_delivery_normal_max_days);
  const daysInvalid =
    minDays === null || maxDays === null || minDays > maxDays;

  const preview = useMemo(
    () =>
      resolveCheckoutTrustDelivery(values, reviews, previewSaleLive, {
        rotationIndex: 0,
      }),
    [values, reviews, previewSaleLive],
  );

  function set(key: (typeof CHECKOUT_KEYS)[number], value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/store-admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: changed }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : 'Checkout trust & delivery settings could not be saved.',
        );
      }
      const nextSaved = { ...values };
      setSaved(nextSaved);
      const count = Array.isArray(payload.changes) ? payload.changes.length : 0;
      setMessage(
        count === 0 ? 'No changes to save.' : `${count} checkout setting(s) saved.`,
      );
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Checkout trust & delivery settings could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  const trustMode = values.checkout_trust_mode;

  return (
    <form className="sa-edit-form" onSubmit={save}>
      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="sa-success" role="status">
          {message}
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {/* A. Customer Trust Message */}
        <div
          style={{
            border: '1px solid #e5e5ea',
            borderRadius: '14px',
            padding: '1.1rem',
            background: '#fbfbfd',
          }}
        >
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 700 }}>
            A. Customer Trust Message
          </h3>
          <p className="sa-hint" style={{ marginBottom: '1rem' }}>
            Appears directly below the Order Summary. Only genuine published reviews or an
            honest store trust message are allowed — never generated ratings or false
            verified badges.
          </p>

          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Customer trust card</span>
              <span className="sa-checkbox">
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={values.checkout_trust_enabled === 'on'}
                  onChange={(event) =>
                    set('checkout_trust_enabled', event.target.checked ? 'on' : 'off')
                  }
                />
                <span>{values.checkout_trust_enabled === 'on' ? 'Enabled' : 'Disabled'}</span>
              </span>
              <span className="sa-hint">
                Off hides the review/trust card completely on checkout.
              </span>
            </label>

            <label className="sa-field">
              <span className="sa-label">Display mode</span>
              <select
                className="sa-input"
                disabled={!canEdit || busy}
                value={trustMode}
                onChange={(event) => set('checkout_trust_mode', event.target.value)}
              >
                <option value={CHECKOUT_TRUST_MODES[2]}>
                  Honest store trust message (no fake stars)
                </option>
                <option value={CHECKOUT_TRUST_MODES[0]}>
                  Manual selection (published customer review)
                </option>
                <option value={CHECKOUT_TRUST_MODES[1]}>
                  Automatic rotation (published customer reviews)
                </option>
              </select>
              <span className="sa-hint">
                Choose a published review, hourly auto-rotation, or an honest store note.
              </span>
            </label>

            {trustMode === 'manual_review' || trustMode === 'auto_rotate' ? (
              <label className="sa-field">
                <span className="sa-label">Rating filter</span>
                <select
                  className="sa-input"
                  disabled={!canEdit || busy}
                  value={values.checkout_trust_min_rating}
                  onChange={(event) => set('checkout_trust_min_rating', event.target.value)}
                >
                  <option value="5">5 stars only</option>
                  <option value="4">4+ stars</option>
                  <option value="3">3+ stars</option>
                  <option value="2">2+ stars</option>
                  <option value="1">1+ stars</option>
                </select>
                <span className="sa-hint">
                  Uses the genuine star rating stored on each published review.
                </span>
              </label>
            ) : null}

            {trustMode === 'manual_review' ? (
              <label className="sa-field sa-field-wide">
                <span className="sa-label">Select genuine published review</span>
                <select
                  className="sa-input"
                  disabled={!canEdit || busy}
                  value={values.checkout_trust_review_id}
                  onChange={(event) => set('checkout_trust_review_id', event.target.value)}
                >
                  <option value="">
                    {filteredReviews.length === 0
                      ? 'No published reviews match this rating filter'
                      : 'Choose a published review…'}
                  </option>
                  {selectedReview &&
                  !filteredReviews.some((entry) => entry.id === selectedReview.id) ? (
                    <option value={selectedReview.id}>
                      ★{selectedReview.rating} · {selectedReview.productName} ·{' '}
                      {selectedReview.orderVerified ? 'Verified Order' : 'Unverified'} ·{' '}
                      {truncateReviewQuote(selectedReview.body || selectedReview.title, 70)}
                    </option>
                  ) : null}
                  {filteredReviews.map((review) => (
                    <option key={review.id} value={review.id}>
                      ★{review.rating} · {review.productName} ·{' '}
                      {review.orderVerified ? 'Verified Order' : 'Unverified'} ·{' '}
                      {truncateReviewQuote(review.body || review.title, 70)}
                    </option>
                  ))}
                </select>
                <span className="sa-hint">
                  {reviews.length === 0 ? (
                    <>
                      No published reviews exist yet.{' '}
                      <Link href="/store-admin/reviews" style={{ color: '#0071e3' }}>
                        Moderate reviews
                      </Link>{' '}
                      or use Honest store trust message mode.
                    </>
                  ) : selectedReview ? (
                    `Selected review rating: ${selectedReview.rating}/5 · Order verification: ${
                      selectedReview.orderVerified
                        ? 'Confirmed paid non-test order'
                        : 'Not order-verified (badge will stay hidden)'
                    }.`
                  ) : (
                    'Only published reviews appear here; verification status comes strictly from paid orders.'
                  )}
                </span>
              </label>
            ) : null}

            {trustMode === 'auto_rotate' ? (
              <label className="sa-field">
                <span className="sa-label">Auto-rotate verified purchases only</span>
                <span className="sa-checkbox">
                  <input
                    type="checkbox"
                    disabled={!canEdit || busy}
                    checked={values.checkout_trust_verified_only === 'on'}
                    onChange={(event) =>
                      set(
                        'checkout_trust_verified_only',
                        event.target.checked ? 'on' : 'off',
                      )
                    }
                  />
                  <span>
                    {values.checkout_trust_verified_only === 'on'
                      ? 'Verified orders only'
                      : 'Any published review'}
                  </span>
                </span>
                <span className="sa-hint">
                  {autoRotatePoolCount} eligible published review(s) currently match your
                  rotation filter.
                </span>
              </label>
            ) : null}

            {trustMode === 'manual_review' || trustMode === 'auto_rotate' ? (
              <label className="sa-field">
                <span className="sa-label">Verified Purchase label</span>
                <span className="sa-checkbox">
                  <input
                    type="checkbox"
                    disabled={!canEdit || busy}
                    checked={values.checkout_trust_show_verified === 'on'}
                    onChange={(event) =>
                      set(
                        'checkout_trust_show_verified',
                        event.target.checked ? 'on' : 'off',
                      )
                    }
                  />
                  <span>
                    {values.checkout_trust_show_verified === 'on'
                      ? 'Show when order-verified'
                      : 'Hidden'}
                  </span>
                </span>
                <span className="sa-hint">
                  Displayed only when PostgreSQL confirms the review links to a real paid
                  order.
                </span>
              </label>
            ) : null}

            {trustMode === 'manual_review' || trustMode === 'trust_message' ? (
              <>
                <label className="sa-field sa-field-wide">
                  <span className="sa-label">
                    {trustMode === 'manual_review'
                      ? 'Shortened review excerpt (optional)'
                      : 'Trust message text'}
                    <span className="sa-hint"> up to 240</span>
                  </span>
                  <textarea
                    className="sa-input"
                    rows={2}
                    maxLength={240}
                    disabled={!canEdit || busy}
                    value={values.checkout_trust_text}
                    placeholder={
                      trustMode === 'manual_review'
                        ? 'Leave blank to use the selected published review text verbatim.'
                        : 'e.g. Every Gadzio accessory ships from India with 7-day replacement support.'
                    }
                    onChange={(event) => set('checkout_trust_text', event.target.value)}
                  />
                  <span className="sa-hint">
                    {trustMode === 'manual_review'
                      ? 'Optional shortened quote for the selected review (never include emails or phone numbers).'
                      : 'Shown as an honest store reassurance note without fake star ratings or verified badges.'}
                  </span>
                </label>

                <label className="sa-field">
                  <span className="sa-label">
                    {trustMode === 'manual_review'
                      ? 'Reviewer display name / initials (optional)'
                      : 'Attribution label (optional)'}
                    <span className="sa-hint"> up to 60</span>
                  </span>
                  <input
                    className="sa-input"
                    type="text"
                    maxLength={60}
                    disabled={!canEdit || busy}
                    value={values.checkout_trust_reviewer_name}
                    placeholder={
                      trustMode === 'manual_review' ? 'e.g. Aarav M.' : 'e.g. Gadzio Care Team'
                    }
                    onChange={(event) =>
                      set('checkout_trust_reviewer_name', event.target.value)
                    }
                  />
                  <span className="sa-hint">
                    Leave blank in manual review mode to format the customer&apos;s name
                    safely (First L.).
                  </span>
                </label>
              </>
            ) : null}
          </div>
        </div>

        {/* B. Delivery & Dispatch */}
        <div
          style={{
            border: '1px solid #e5e5ea',
            borderRadius: '14px',
            padding: '1.1rem',
            background: '#fbfbfd',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginBottom: '0.5rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
              B. Delivery &amp; Dispatch Announcement
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <SaleStatusBadge status={saleStatus} />
              <Link href="/store-admin/sale" className="sa-btn sa-btn-quiet sa-btn-small">
                Manage Sale Mode
              </Link>
            </div>
          </div>
          <p className="sa-hint" style={{ marginBottom: '1rem' }}>
            Checkout reads Store Admin Sale Mode automatically from{' '}
            <code>sale_settings</code>. When Sale Mode is live, checkout switches to the
            Sale Mode configuration automatically and returns to Normal Mode as soon as the
            sale ends.
          </p>

          <h4 style={{ margin: '0 0 0.65rem', fontSize: '0.9rem', fontWeight: 700 }}>
            Normal Store Mode
          </h4>
          <div className="sa-control-grid" style={{ marginBottom: '1.25rem' }}>
            <label className="sa-field">
              <span className="sa-label">Normal mode announcement</span>
              <span className="sa-checkbox">
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={values.checkout_delivery_normal_enabled === 'on'}
                  onChange={(event) =>
                    set(
                      'checkout_delivery_normal_enabled',
                      event.target.checked ? 'on' : 'off',
                    )
                  }
                />
                <span>
                  {values.checkout_delivery_normal_enabled === 'on'
                    ? 'Enabled'
                    : 'Disabled'}
                </span>
              </span>
              <span className="sa-hint">
                Hidden when disabled or when settings are incomplete.
              </span>
            </label>

            <label className="sa-field">
              <span className="sa-label">
                Announcement title <span className="sa-hint"> up to 80</span>
              </span>
              <input
                className="sa-input"
                type="text"
                maxLength={80}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_normal_title}
                onChange={(event) =>
                  set('checkout_delivery_normal_title', event.target.value)
                }
              />
              <span className="sa-hint">Example: Expected Delivery</span>
            </label>

            <label className="sa-field">
              <span className="sa-label">Minimum delivery days</span>
              <input
                className="sa-input"
                type="number"
                min={CHECKOUT_MIN_DELIVERY_DAYS}
                max={CHECKOUT_MAX_DELIVERY_DAYS}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_normal_min_days}
                onChange={(event) =>
                  set('checkout_delivery_normal_min_days', event.target.value)
                }
              />
              <span className="sa-hint">Whole number between 1 and 60 days.</span>
            </label>

            <label className="sa-field">
              <span className="sa-label">Maximum delivery days</span>
              <input
                className="sa-input"
                type="number"
                min={CHECKOUT_MIN_DELIVERY_DAYS}
                max={CHECKOUT_MAX_DELIVERY_DAYS}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_normal_max_days}
                onChange={(event) =>
                  set('checkout_delivery_normal_max_days', event.target.value)
                }
              />
              <span className="sa-hint">
                {daysInvalid
                  ? 'Minimum days must be <= maximum days (both 1–60).'
                  : `Renders as: Delivered in ${
                      minDays === maxDays ? `${minDays} day${minDays === 1 ? '' : 's'}` : `${minDays}–${maxDays} days`
                    }`}
              </span>
            </label>

            <label className="sa-field sa-field-wide">
              <span className="sa-label">
                Supporting description <span className="sa-hint"> up to 300</span>
              </span>
              <textarea
                className="sa-input"
                rows={2}
                maxLength={300}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_normal_description}
                onChange={(event) =>
                  set('checkout_delivery_normal_description', event.target.value)
                }
              />
              <span className="sa-hint">
                Shown directly below the delivery range on checkout.
              </span>
            </label>

            <label className="sa-field">
              <span className="sa-label">Optional icon</span>
              <select
                className="sa-input"
                disabled={!canEdit || busy}
                value={values.checkout_delivery_normal_icon}
                onChange={(event) =>
                  set('checkout_delivery_normal_icon', event.target.value)
                }
              >
                {CHECKOUT_DELIVERY_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {ICON_LABELS[icon]}
                  </option>
                ))}
              </select>
              <span className="sa-hint">Choose None to display text only.</span>
            </label>
          </div>

          <h4 style={{ margin: '0 0 0.65rem', fontSize: '0.9rem', fontWeight: 700 }}>
            Sale Mode (Automatic when Sale Mode is live)
          </h4>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Sale mode announcement</span>
              <span className="sa-checkbox">
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={values.checkout_delivery_sale_enabled === 'on'}
                  onChange={(event) =>
                    set(
                      'checkout_delivery_sale_enabled',
                      event.target.checked ? 'on' : 'off',
                    )
                  }
                />
                <span>
                  {values.checkout_delivery_sale_enabled === 'on'
                    ? 'Enabled'
                    : 'Disabled'}
                </span>
              </span>
              <span className="sa-hint">
                When off during a live sale, the delivery box stays hidden instead of
                showing normal delivery days.
              </span>
            </label>

            <label className="sa-field">
              <span className="sa-label">
                Sale announcement title <span className="sa-hint"> up to 80</span>
              </span>
              <input
                className="sa-input"
                type="text"
                maxLength={80}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_sale_title}
                onChange={(event) =>
                  set('checkout_delivery_sale_title', event.target.value)
                }
              />
              <span className="sa-hint">Example: Sale Dispatch Update</span>
            </label>

            <label className="sa-field sa-field-wide">
              <span className="sa-label">
                Highlighted main message <span className="sa-hint"> up to 160</span>
              </span>
              <input
                className="sa-input"
                type="text"
                maxLength={160}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_sale_message}
                onChange={(event) =>
                  set('checkout_delivery_sale_message', event.target.value)
                }
              />
              <span className="sa-hint">
                Example: Dispatch starts after the sale ends.
              </span>
            </label>

            <label className="sa-field sa-field-wide">
              <span className="sa-label">
                Supporting description <span className="sa-hint"> up to 300</span>
              </span>
              <textarea
                className="sa-input"
                rows={2}
                maxLength={300}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_sale_description}
                onChange={(event) =>
                  set('checkout_delivery_sale_description', event.target.value)
                }
              />
              <span className="sa-hint">
                Explain order processing during active sales clearly.
              </span>
            </label>

            <label className="sa-field">
              <span className="sa-label">
                Optional post-sale dispatch estimate{' '}
                <span className="sa-hint"> up to 120</span>
              </span>
              <input
                className="sa-input"
                type="text"
                maxLength={120}
                disabled={!canEdit || busy}
                value={values.checkout_delivery_sale_estimate}
                placeholder="Leave blank unless a reliable estimate is known"
                onChange={(event) =>
                  set('checkout_delivery_sale_estimate', event.target.value)
                }
              />
              <span className="sa-hint">
                Leave blank to avoid promising a specific dispatch date.
              </span>
            </label>

            <label className="sa-field">
              <span className="sa-label">Optional icon</span>
              <select
                className="sa-input"
                disabled={!canEdit || busy}
                value={values.checkout_delivery_sale_icon}
                onChange={(event) =>
                  set('checkout_delivery_sale_icon', event.target.value)
                }
              >
                {CHECKOUT_DELIVERY_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {ICON_LABELS[icon]}
                  </option>
                ))}
              </select>
              <span className="sa-hint">Choose None to display text only.</span>
            </label>
          </div>
        </div>

        {/* Live Checkout Preview */}
        <div
          style={{
            border: '1px solid #e5e5ea',
            borderRadius: '14px',
            padding: '1.1rem',
            background: '#ffffff',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                Live Checkout Preview (below Order Summary)
              </h3>
              <p className="sa-hint" style={{ margin: '0.2rem 0 0' }}>
                Preview how these two cards appear on checkout in Normal vs Sale Mode.
              </p>
            </div>
            <div className="sa-chip-row" style={{ margin: 0 }}>
              <button
                type="button"
                className={`sa-chip${!previewSaleLive ? ' is-active' : ''}`}
                onClick={() => setPreviewSaleLive(false)}
              >
                Preview Normal Mode
              </button>
              <button
                type="button"
                className={`sa-chip${previewSaleLive ? ' is-active' : ''}`}
                onClick={() => setPreviewSaleLive(true)}
              >
                Preview Sale Mode
              </button>
            </div>
          </div>

          <div
            style={{
              background: '#e8eaee',
              borderRadius: '14px',
              padding: '1rem',
              display: 'grid',
              gap: '0.75rem',
              maxWidth: '520px',
            }}
          >
            <div
              style={{
                borderRadius: '12px',
                border: '1px dashed #c7c7cc',
                background: 'rgba(255,255,255,0.75)',
                padding: '0.65rem 0.9rem',
                fontSize: '0.8rem',
                color: '#6e6e73',
                fontWeight: 600,
              }}
            >
              1. Existing Order Summary (unchanged)
            </div>

            {preview.trust ? (
              <CheckoutTrustReviewCard item={preview.trust} />
            ) : (
              <p className="sa-hint" style={{ margin: 0 }}>
                2. Customer Trust Message: Hidden on checkout (disabled or no eligible
                published review/message).
              </p>
            )}

            {preview.delivery ? (
              <CheckoutDeliveryAnnouncementCard announcement={preview.delivery} />
            ) : (
              <p className="sa-hint" style={{ margin: 0 }}>
                3. Delivery &amp; Dispatch Announcement: Hidden on checkout in{' '}
                {previewSaleLive ? 'Sale Mode' : 'Normal Mode'}.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="sa-edit-actions">
        {canEdit ? (
          <button
            className="sa-btn sa-btn-primary"
            type="submit"
            disabled={busy || changed.length === 0}
          >
            {busy
              ? 'Saving…'
              : changed.length === 0
                ? 'Saved'
                : `Save ${changed.length} change(s)`}
          </button>
        ) : (
          <span className="sa-lock-note">Read-only access.</span>
        )}
        <span className="sa-note">Every save writes one audit row per changed setting.</span>
      </div>
    </form>
  );
}
