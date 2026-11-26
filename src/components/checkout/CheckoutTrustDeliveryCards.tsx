import React from 'react';

import type {
  CheckoutDeliveryIcon,
  PublicCheckoutDeliveryAnnouncement,
  PublicCheckoutTrustItem,
} from '@/lib/checkout/trust-delivery-rules';

function QuoteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-[#86868b]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4.2-4 5" />
      <path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4.2-4 5" />
    </svg>
  );
}

function TrustShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-[#0071e3]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 4.5 6v6c0 4.6 3.2 7.8 7.5 9 4.3-1.2 7.5-4.4 7.5-9V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function DeliveryIcon({ icon }: { icon: CheckoutDeliveryIcon }) {
  if (icon === 'none') return null;

  switch (icon) {
    case 'truck':
      return (
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h11v10H3z" />
          <path d="M14 9h4l3 3v4h-7V9z" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="17.5" cy="17.5" r="1.5" />
        </svg>
      );
    case 'package':
      return (
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
          <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
        </svg>
      );
    case 'calendar':
      return (
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M8 2v4M16 2v4M3 10h18" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m12 3 1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3Z" />
          <path d="m18.5 15 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
        </svg>
      );
    case 'clock':
    default:
      return (
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
  }
}

export function CheckoutTrustReviewCard({
  item,
}: {
  item: PublicCheckoutTrustItem;
}) {
  if (item.kind === 'trust_message') {
    return (
      <section
        aria-label="Customer trust note"
        data-testid="checkout-trust-review"
        data-kind="trust_message"
        className="rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] px-4 py-3.5 text-[#1d1d1f]"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white border border-[#e5e5ea]">
            <TrustShieldIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-[13px] leading-relaxed text-[#333336]">
              {item.quote}
            </p>
            {item.authorLabel ? (
              <p className="mt-1.5 text-[11px] font-medium text-[#6e6e73]">
                {item.authorLabel}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Customer review"
      data-testid="checkout-trust-review"
      data-kind="review"
      className="rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] px-4 py-3.5 text-[#1d1d1f]"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white border border-[#e5e5ea]">
          <QuoteIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-0.5"
            aria-label={`${item.rating} out of 5 stars`}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <svg
                key={star}
                aria-hidden="true"
                className={`h-3.5 w-3.5 ${
                  star <= item.rating ? 'text-[#f59e0b]' : 'text-[#d2d2d7]'
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>

          <p className="mt-1.5 text-xs sm:text-[13px] leading-relaxed text-[#333336]">
            &ldquo;{item.quote}&rdquo;
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="font-semibold text-[#1d1d1f]">{item.reviewerName}</span>
            {item.verifiedPurchase ? (
              <span className="inline-flex items-center gap-1 font-medium text-[#15803d]">
                <svg
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 5.29a1 1 0 01.006 1.414l-7.25 7.3a1 1 0 01-1.42-.004l-3.25-3.25a1 1 0 111.414-1.414l2.54 2.54 6.543-6.58a1 1 0 011.417-.006z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Verified Purchase</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CheckoutDeliveryAnnouncementCard({
  announcement,
}: {
  announcement: PublicCheckoutDeliveryAnnouncement;
}) {
  const isSale = announcement.mode === 'sale';

  return (
    <section
      role="status"
      aria-label={announcement.title}
      data-testid="checkout-delivery-announcement"
      data-mode={announcement.mode}
      className={
        isSale
          ? 'rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-amber-950'
          : 'rounded-2xl border border-[#bfdbfe] bg-[#f0f7ff] px-4 py-3.5 text-[#1d1d1f]'
      }
    >
      <div className="flex items-start gap-3">
        {announcement.icon !== 'none' ? (
          <span
            className={
              isSale
                ? 'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-white text-amber-700'
                : 'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#bfdbfe] bg-white text-[#0071e3]'
            }
          >
            <DeliveryIcon icon={announcement.icon} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p
            className={
              isSale
                ? 'text-[11px] font-semibold uppercase tracking-wider text-amber-800'
                : 'text-[11px] font-semibold uppercase tracking-wider text-[#005bb5]'
            }
          >
            {announcement.title}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-snug">
            {announcement.mainMessage}
          </p>
          {announcement.description ? (
            <p
              className={
                isSale
                  ? 'mt-1 text-xs leading-relaxed text-amber-900/90'
                  : 'mt-1 text-xs leading-relaxed text-[#424245]'
              }
            >
              {announcement.description}
            </p>
          ) : null}
          {isSale && announcement.estimateNote ? (
            <p className="mt-1.5 text-xs font-medium text-amber-900">
              {announcement.estimateNote}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
