'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { SpinWheelSvg } from '@/components/spin-wheel/SpinWheelSvg';
import { computeTargetWheelRotation } from '@/lib/spin-wheel/colors';
import { formatCountdownHms, formatSpinCouponExpiry } from '@/lib/spin-wheel/countdown';
import type {
  CustomerSpinResultView,
  CustomerSpinState,
  SpinDrawResponse,
} from '@/lib/spin-wheel/store';

interface Props {
  initialState: CustomerSpinState;
}

const SHOP_HREF = '/shop/iphone/accessories/cases-protection';

function closedReasonCopy(reason: CustomerSpinState['windowReason']): string {
  switch (reason) {
    case 'not_started':
      return 'Spin and Win has not started yet. Check back soon!';
    case 'ended':
      return 'This Spin and Win campaign has ended. Thanks for playing!';
    default:
      return 'Spin and Win is not running right now. Check back soon!';
  }
}

export function CustomerSpinWheelClient({ initialState }: Props) {
  const [state, setState] = useState<CustomerSpinState>(initialState);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotationDeg, setRotationDeg] = useState<number>(() => {
    if (!initialState.todaySpin || initialState.segments.length < 2) return 0;
    const idx = initialState.segments.findIndex((s) => s.id === initialState.todaySpin?.segmentId);
    return idx >= 0
      ? computeTargetWheelRotation(0, idx, initialState.segments.length, 0)
      : 0;
  });
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [resetTargetMs, setResetTargetMs] = useState<number>(
    () => Date.now() + Math.max(0, initialState.secondsUntilReset) * 1000,
  );
  const [remainingMs, setRemainingMs] = useState<number>(
    () => Math.max(0, initialState.secondsUntilReset) * 1000,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, resetTargetMs - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [resetTargetMs]);

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      // Clipboard unavailable; code remains visible in selectable monospace box.
    }
  }

  function applyResult(spin: CustomerSpinResultView, nextSec: number, nextIso: string) {
    setState((prev) => ({
      ...prev,
      todaySpin: spin,
      nextSpinAt: nextIso,
      secondsUntilReset: nextSec,
    }));
    setResetTargetMs(Date.now() + Math.max(0, nextSec) * 1000);
    setRemainingMs(Math.max(0, nextSec) * 1000);
    setAnnouncement(
      spin.segmentType === 'COUPON' && spin.couponCode
        ? `You won ${spin.couponSummary || spin.segmentLabel}! Your coupon code is ${spin.couponCode}.`
        : `${spin.segmentLabel}. You can spin again after midnight.`,
    );
  }

  async function handleSpin() {
    if (spinning || state.todaySpin || !state.signedIn || !state.isOpen) return;
    if (!termsAccepted) {
      setError('Please tick the Terms & Conditions box before spinning.');
      return;
    }

    setError(null);
    setSpinning(true);

    try {
      const response = await fetch('/api/spin-wheel/spin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ termsAccepted: true }),
      });

      const body = (await response.json().catch(() => null)) as SpinDrawResponse | null;
      if (!body || !body.ok) {
        setSpinning(false);
        setError(
          body && 'error' in body && body.error
            ? body.error
            : 'Could not complete your spin right now. Please try again.',
        );
        return;
      }

      const targetIndex = state.segments.findIndex((s) => s.id === body.spin.segmentId);
      if (reducedMotion || body.alreadySpun || targetIndex < 0 || state.segments.length < 2) {
        if (targetIndex >= 0 && state.segments.length >= 2) {
          setRotationDeg((prev) =>
            computeTargetWheelRotation(prev, targetIndex, state.segments.length, 0),
          );
        }
        setSpinning(false);
        applyResult(body.spin, body.secondsUntilReset, body.nextSpinAt);
        return;
      }

      setRotationDeg((prev) =>
        computeTargetWheelRotation(prev, targetIndex, state.segments.length, 5),
      );
      window.setTimeout(() => {
        setSpinning(false);
        applyResult(body.spin, body.secondsUntilReset, body.nextSpinAt);
      }, 4250);
    } catch {
      setSpinning(false);
      setError('Network error while spinning. Please try again.');
    }
  }

  const todayResult = state.todaySpin;
  const wheelActive = state.available && state.isOpen && state.segments.length >= 2;
  const countdownText = formatCountdownHms(remainingMs);

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-8 sm:px-6 lg:py-12">
      {/* Screen-reader live result region */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Header banner */}
      <div className="mb-8 text-center">
        <span className="inline-flex items-center rounded-full bg-[#ffe100] px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#1d1d1f]">
          Daily Offer
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#1d1d1f] sm:text-4xl">
          {state.title || 'Spin and Win'}
        </h1>
        {state.subtitle ? (
          <p className="mx-auto mt-2 max-w-xl text-sm text-[#6e6e73] sm:text-base">
            {state.subtitle}
          </p>
        ) : null}
      </div>

      {!wheelActive && !todayResult ? (
        <section className="mx-auto max-w-lg rounded-3xl border border-[#e5e5ea] bg-white p-6 text-center shadow-sm sm:p-8">
          <p className="text-base font-medium text-[#1d1d1f]">
            {closedReasonCopy(state.windowReason)}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href={SHOP_HREF}
              className="inline-flex rounded-full bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
            >
              Continue shopping
            </Link>
            <Link
              href="/account/coupons"
              className="inline-flex rounded-full border border-[#d2d2d7] bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
            >
              View my coupons
            </Link>
          </div>
        </section>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          {/* Wheel Column */}
          <section
            aria-label="Prize wheel"
            className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm sm:p-8"
          >
            <SpinWheelSvg
              segments={state.segments}
              rotationDeg={rotationDeg}
              spinning={spinning}
              size={320}
              ariaLabel={`${state.title || 'Spin and Win'} prize wheel`}
            />
            <p className="mt-4 text-center text-xs text-[#6e6e73]">
              One free spin per customer each day · Resets at midnight ({state.timeZone})
            </p>
          </section>

          {/* Controls / Result Column */}
          <section className="space-y-5 rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm sm:p-8">
            {todayResult ? (
              <div className="space-y-5">
                {todayResult.segmentType === 'COUPON' && todayResult.couponCode ? (
                  <>
                    <div>
                      <span className="inline-flex rounded-full bg-[#e8f8ec] px-3 py-1 text-xs font-bold text-[#137333]">
                        Winner!
                      </span>
                      <h2 className="mt-3 text-2xl font-bold text-[#1d1d1f]">
                        You won {todayResult.couponSummary || todayResult.segmentLabel}!
                      </h2>
                      <p className="mt-1 text-sm text-[#6e6e73]">
                        Your personal single-use code is ready in Your Coupons and works on checkout right away.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] p-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6e6e73]">
                          Coupon code
                        </p>
                        <p className="mt-0.5 font-mono text-lg font-bold tracking-wider text-[#1d1d1f]">
                          {todayResult.couponCode}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(todayResult.couponCode!)}
                        className="rounded-full bg-[#1d1d1f] px-4 py-2 text-xs font-bold text-white hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                      >
                        {copiedCode ? 'Copied!' : 'Copy code'}
                      </button>
                    </div>

                    {todayResult.couponExpiresAt ? (
                      <p className="text-xs text-[#6e6e73]">
                        Valid until{' '}
                        <strong className="text-[#1d1d1f]">
                          {formatSpinCouponExpiry(todayResult.couponExpiresAt, state.timeZone)}
                        </strong>{' '}
                        · Personal to your account (1 use)
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-3 pt-1">
                      <Link
                        href="/account/coupons"
                        className="inline-flex rounded-full bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                      >
                        View my coupons
                      </Link>
                      <Link
                        href={SHOP_HREF}
                        className="inline-flex rounded-full border border-[#d2d2d7] bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                      >
                        Continue shopping
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="inline-flex rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-semibold text-[#6e6e73]">
                        Today&apos;s spin complete
                      </span>
                      <h2 className="mt-3 text-2xl font-bold text-[#1d1d1f]">
                        {todayResult.segmentLabel || 'Better luck next time!'}
                      </h2>
                      <p className="mt-1 text-sm text-[#6e6e73]">
                        You&apos;ve used today&apos;s spin. Come back after midnight for another chance to win a coupon.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3 pt-1">
                      <Link
                        href={SHOP_HREF}
                        className="inline-flex rounded-full bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                      >
                        Continue shopping
                      </Link>
                      <Link
                        href="/account/coupons"
                        className="inline-flex rounded-full border border-[#d2d2d7] bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                      >
                        View my coupons
                      </Link>
                    </div>
                  </>
                )}

                <div className="rounded-2xl border border-[#e5e5ea] bg-[#fafafa] px-4 py-3 text-xs text-[#6e6e73]">
                  {remainingMs > 0 ? (
                    <span>
                      Next spin in <strong className="font-mono text-[#1d1d1f]">{countdownText}</strong>
                    </span>
                  ) : (
                    <span>
                      Daily limit reset —{' '}
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="font-semibold text-[#1d1d1f] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f]"
                      >
                        refresh to spin again
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ) : !state.signedIn ? (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-[#1d1d1f]">Sign in to spin the wheel</h2>
                <p className="text-sm text-[#6e6e73]">
                  Signed-in Gadzio customers get one free spin every day. Winning coupons go straight to your account.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href="/auth?redirect=/spin-and-win"
                    className="inline-flex rounded-full bg-[#ffe100] px-6 py-3 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                  >
                    Sign in to spin
                  </Link>
                  <Link
                    href="/auth?redirect=/spin-and-win&mode=signup"
                    className="inline-flex rounded-full border border-[#d2d2d7] bg-white px-6 py-3 text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                  >
                    Create account
                  </Link>
                </div>
                <p className="text-xs text-[#6e6e73]">
                  You&apos;ll come straight back here after signing in.{' '}
                  <a href="#spin-terms" className="font-semibold text-[#1d1d1f] underline">
                    Read terms
                  </a>
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-[#1d1d1f]">Ready to spin today</h2>
                  <p className="mt-1 text-sm text-[#6e6e73]">
                    No purchase needed. If you win a coupon, it unlocks on your account right away.
                  </p>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e5e5ea] bg-[#fafafa] p-3.5 text-sm text-[#1d1d1f]">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked);
                      if (e.target.checked && error) setError(null);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-[#86868b] text-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]"
                  />
                  <span>
                    I accept the{' '}
                    <a href="#spin-terms" className="font-semibold underline">
                      Spin and Win Terms &amp; Conditions
                    </a>
                    .
                  </span>
                </label>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={spinning}
                  onClick={handleSpin}
                  className="w-full rounded-full bg-[#ffe100] px-6 py-3.5 text-base font-bold text-[#1d1d1f] shadow-sm transition hover:bg-[#ffea33] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d1d1f] focus-visible:ring-offset-2"
                >
                  {spinning ? 'Spinning...' : 'Spin the Wheel'}
                </button>
              </div>
            )}

            {/* Plain-text accessible prize list */}
            <div className="border-t border-[#f5f5f7] pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                Wheel slices
              </h3>
              <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Prizes on the wheel">
                {state.segments.map((seg) => (
                  <li
                    key={seg.id}
                    className="rounded-full border border-[#e5e5ea] bg-[#fafafa] px-3 py-1 text-xs font-medium text-[#1d1d1f]"
                  >
                    {seg.label}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}

      {/* Terms & Conditions block */}
      {state.termsText ? (
        <section
          id="spin-terms"
          aria-labelledby="spin-terms-heading"
          className="mt-8 rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm sm:p-8"
        >
          <h2 id="spin-terms-heading" className="text-base font-bold text-[#1d1d1f]">
            Spin and Win Terms &amp; Conditions
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#6e6e73]">
            {state.termsText}
          </p>
        </section>
      ) : null}
    </div>
  );
}
