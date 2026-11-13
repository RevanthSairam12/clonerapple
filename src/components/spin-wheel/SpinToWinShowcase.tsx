'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { SpinWheelSvg } from '@/components/spin-wheel/SpinWheelSvg';
import { saveCouponCodeForCheckout } from '@/lib/cart/useCoupon';
import {
  computeTargetWheelRotation,
  WHEEL_POINTER_RIGHT_ANGLE_DEG,
} from '@/lib/spin-wheel/colors';
import {
  formatSpinCouponExpiry,
  formatSpinCountdown,
} from '@/lib/spin-wheel/countdown';
import type { CustomerSpinResultView, CustomerSpinState, SpinDrawResponse } from '@/lib/spin-wheel/store';

interface SpinToWinShowcaseProps {
  initialState: CustomerSpinState;
  variant: 'page' | 'modal';
  onClose?: () => void;
}

/**
 * Geometric blocky/pixel "SPIN TO" + coral script "win" + lavender flower + acid-lime badge SVG.
 * Uses pure SVG shapes so the poster lockup stays sharp offline and across all OS fonts.
 */
function SpinToWinWordmark() {
  return (
    <div className="mx-auto flex w-full max-w-[330px] justify-center select-none" aria-hidden="true">
      <svg viewBox="0 0 360 142" className="h-auto w-full overflow-visible">
        {/* Chunky stepped pixel-style "SPIN TO" */}
        <g fill="#0c0c0c">
          {/* S */}
          <path d="M18 14h26v10H24v16h20v34H14V60h22V44H16V20h2z" />
          {/* P */}
          <path d="M52 14h28v36H62v24H52V14zm10 10v16h8V24h-8z" />
          {/* I */}
          <path d="M88 14h24v10h-7v40h7v10H88V64h7V24h-7V14z" />
          {/* N */}
          <path d="M120 14h10l12 30V14h10v60h-10l-12-30v30h-10V14z" />
          {/* T */}
          <path d="M174 14h32v11h-11v49h-10V25h-11V14z" />
          {/* O */}
          <path d="M214 20l6-6h20l6 6v48l-6 6h-20l-6-6V20zm10 4v40h12V24h-12z" />
        </g>

        {/* Chunky retro coral script "win" */}
        <text
          x="126"
          y="108"
          textAnchor="middle"
          fill="#f25c3b"
          stroke="#111111"
          strokeWidth="2.4"
          paintOrder="stroke fill"
          fontSize="68"
          fontWeight="900"
          fontStyle="italic"
          fontFamily="Georgia, 'Times New Roman', serif"
          letterSpacing="-3"
        >
          win
        </text>

        {/* 6-petal lavender flower next to "win" */}
        <g transform="translate(220, 68)" stroke="#111111" strokeWidth="1.5">
          <circle cx="0" cy="-11" r="7.5" fill="#e8c6ff" />
          <circle cx="10" cy="-5" r="7.5" fill="#e8c6ff" />
          <circle cx="10" cy="6" r="7.5" fill="#e8c6ff" />
          <circle cx="0" cy="11" r="7.5" fill="#e8c6ff" />
          <circle cx="-10" cy="6" r="7.5" fill="#e8c6ff" />
          <circle cx="-10" cy="-5" r="7.5" fill="#e8c6ff" />
          <circle cx="0" cy="0" r="6.2" fill="#e8c6ff" stroke="none" />
          <circle cx="0" cy="0" r="3" fill="#f7e9ff" stroke="none" />
        </g>

        {/* Tilted acid-lime pill: How much will you save? */}
        <g transform="translate(262, 108) rotate(-8)">
          <rect
            x="-68"
            y="-20"
            width="136"
            height="40"
            rx="20"
            fill="#d8f561"
            stroke="#111111"
            strokeWidth="1.4"
          />
          <text
            x="0"
            y="-3"
            textAnchor="middle"
            fill="#111111"
            fontSize="11.5"
            fontStyle="italic"
            fontWeight="600"
            fontFamily="Georgia, 'Times New Roman', serif"
          >
            How much will
          </text>
          <text
            x="0"
            y="10"
            textAnchor="middle"
            fill="#111111"
            fontSize="11.5"
            fontStyle="italic"
            fontWeight="600"
            fontFamily="Georgia, 'Times New Roman', serif"
          >
            you save?
          </text>
        </g>
      </svg>
    </div>
  );
}

export function SpinToWinShowcase({
  initialState,
  variant,
  onClose,
}: SpinToWinShowcaseProps) {
  const router = useRouter();
  const [state, setState] = useState<CustomerSpinState>(initialState);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [guestPhone, setGuestPhone] = useState<string>('');
  const [spinning, setSpinning] = useState<boolean>(false);
  const [revealedSpin, setRevealedSpin] = useState<CustomerSpinResultView | null>(
    initialState.todaySpin,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const [targetResetMs, setTargetResetMs] = useState<number>(
    () => Date.now() + Math.max(0, initialState.secondsUntilReset) * 1000,
  );
  const [remainingMs, setRemainingMs] = useState<number>(
    () => Math.max(0, initialState.secondsUntilReset) * 1000,
  );

  // Restored slice angle if the customer already spun today
  const [rotationDeg, setRotationDeg] = useState<number>(() => {
    if (!initialState.todaySpin?.segmentId || initialState.segments.length === 0) return 0;
    const idx = initialState.segments.findIndex(
      (s) => s.id === initialState.todaySpin?.segmentId,
    );
    return idx >= 0
      ? computeTargetWheelRotation(
          0,
          idx,
          initialState.segments.length,
          0,
          WHEEL_POINTER_RIGHT_ANGLE_DEG,
        )
      : 0;
  });

  const isLockedAfterSpin = Boolean(revealedSpin) || state.cooldownBlocked;

  useEffect(() => {
    if (!isLockedAfterSpin) return;
    const tick = () => setRemainingMs(Math.max(0, targetResetMs - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isLockedAfterSpin, targetResetMs]);

  const wheelSlices = useMemo(
    () =>
      state.segments.map((s) => ({
        id: s.id,
        label: s.label,
        colorHex: s.colorHex,
        textColorHex: s.textColorHex,
      })),
    [state.segments],
  );

  const countdownReadyToSpin = isLockedAfterSpin && remainingMs <= 0 && !spinning;
  const effectiveRemainingSpins = countdownReadyToSpin
    ? state.dailySpinsTotal
    : revealedSpin || state.cooldownBlocked
      ? 0
      : state.remainingSpinsToday;
  const quotaLabel = `${effectiveRemainingSpins}/${state.dailySpinsTotal}`;
  const canSubmitSpin =
    state.available
    && state.isOpen
    && state.segments.length >= 2
    && effectiveRemainingSpins > 0
    && !spinning;

  const countdownFormatted = formatSpinCountdown(remainingMs);
  const wonExpiryFormatted = formatSpinCouponExpiry(
    revealedSpin?.couponExpiresAt ?? state.activeReward?.couponExpiresAt ?? null,
    state.timeZone,
  );

  function handleDismiss() {
    if (onClose) {
      onClose();
      return;
    }
    router.push('/');
  }

  async function refreshStatusFromServer() {
    try {
      const res = await fetch('/api/spin-wheel', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as CustomerSpinState;
      setState(body);
      setRevealedSpin(body.todaySpin);
      setTargetResetMs(Date.now() + Math.max(0, body.secondsUntilReset) * 1000);
      setRemainingMs(Math.max(0, body.secondsUntilReset) * 1000);
    } catch {
      // Leave current client state intact if background refresh fails.
    }
  }

  async function handleSpinClick() {
    if (spinning) return;
    setErrorMessage(null);

    if (!state.signedIn) {
      router.push('/auth?redirect=/spin-and-win');
      return;
    }

    if (!termsAccepted) {
      setErrorMessage('Please accept the Terms & conditions before spinning.');
      return;
    }

    if (!canSubmitSpin) return;

    setSpinning(true);
    setLiveAnnouncement('Spinning the wheel...');

    try {
      const res = await fetch('/api/spin-wheel/spin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ termsAccepted: true }),
      });

      const body = (await res.json().catch(() => ({}))) as SpinDrawResponse;
      if (!res.ok || !body.ok) {
        setSpinning(false);
        const message = !body.ok && body.error ? body.error : 'Could not complete your spin.';
        setErrorMessage(message);
        setLiveAnnouncement(message);
        if (!body.ok && body.reason === 'reward_cooldown') {
          await refreshStatusFromServer();
        }
        return;
      }

      const nextTargetMs = Date.now() + Math.max(0, body.secondsUntilReset) * 1000;
      setTargetResetMs(nextTargetMs);
      setRemainingMs(Math.max(0, body.secondsUntilReset) * 1000);

      const targetIndex = body.spin.segmentId
        ? state.segments.findIndex((s) => s.id === body.spin.segmentId)
        : -1;

      const reducedMotion =
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (targetIndex >= 0 && state.segments.length >= 2) {
        setRotationDeg((prev) =>
          reducedMotion
            ? computeTargetWheelRotation(prev, targetIndex, state.segments.length, 0, WHEEL_POINTER_RIGHT_ANGLE_DEG)
            : computeTargetWheelRotation(prev, targetIndex, state.segments.length, 5, WHEEL_POINTER_RIGHT_ANGLE_DEG),
        );
      }

      const isPrizeOutcome = (t: CustomerSpinResultView['segmentType']) =>
        t === 'COUPON' || t === 'FREE_GIFT';

      const announceOutcome = (outcomeSpin: CustomerSpinResultView) => {
        const wonPrize = isPrizeOutcome(outcomeSpin.segmentType);
        setRevealedSpin(outcomeSpin);
        setState((prev) => ({
          ...prev,
          todaySpin: outcomeSpin,
          remainingSpinsToday: 0,
          nextSpinAt: body.nextSpinAt,
          secondsUntilReset: body.secondsUntilReset,
          cooldownBlocked: prev.rewardCooldownMode !== 'disabled' && wonPrize,
          activeReward: wonPrize
            ? {
                couponCode: outcomeSpin.couponCode,
                couponSummary: outcomeSpin.couponSummary,
                couponExpiresAt: outcomeSpin.couponExpiresAt,
                segmentLabel: outcomeSpin.segmentLabel,
              }
            : prev.activeReward,
        }));
        setSpinning(false);
        const prizeTitle =
          outcomeSpin.segmentType === 'FREE_GIFT' && outcomeSpin.giftProductName
            ? `Free gift: ${outcomeSpin.giftProductName}`
            : outcomeSpin.couponSummary || outcomeSpin.segmentLabel;
        const announcement =
          wonPrize && outcomeSpin.couponCode
            ? `Congratulations! You won ${prizeTitle}. Reward code ${outcomeSpin.couponCode} saved to Your Coupons.`
            : `Result: ${outcomeSpin.segmentLabel}. Better luck next time.`;
        setLiveAnnouncement(announcement);
      };

      if (reducedMotion || body.alreadySpun) {
        announceOutcome(body.spin);
      } else {
        window.setTimeout(() => announceOutcome(body.spin), 4300);
      }
    } catch {
      setSpinning(false);
      const fallback = 'Network error while spinning. Please try again.';
      setErrorMessage(fallback);
      setLiveAnnouncement(fallback);
    }
  }

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      setCopiedCode(false);
    }
  }

  const subtitleText =
    state.subtitle?.trim()
    || 'LOVE A SNEAKY SURPRISE? SPIN THE WHEEL TO REVEAL YOUR EXCLUSIVE DISCOUNT!';

  const displaySpin = revealedSpin;

  return (
    <section
      aria-label={state.title || 'Spin to Win'}
      className="relative w-full overflow-hidden bg-[#fbf8ef] text-[#111111]"
      style={{
        fontFamily: 'transducer, var(--font-site), sans-serif',
      }}
    >
      {/* Top-right dismiss X button */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Close Spin and Win"
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full text-2xl font-light text-[#3f3f3a] transition hover:bg-black/5 hover:text-[#111111] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
      >
        <span aria-hidden="true">×</span>
      </button>

      {/* Screen-reader live region */}
      <div className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </div>

      <div
        className={
          variant === 'modal'
            ? 'mx-auto grid w-full max-w-[960px] items-center gap-4 px-4 py-8 sm:px-6 md:grid-cols-[minmax(0,1.02fr)_minmax(0,430px)] md:gap-6 md:px-0 md:py-10'
            : 'mx-auto grid w-full max-w-[1060px] items-center gap-6 px-4 py-8 sm:px-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,450px)] md:gap-8 md:px-4 md:py-12'
        }
      >
        {/* Left: Oversized wheel peeking from left edge on desktop, centered on mobile */}
        <div className="flex items-center justify-center overflow-visible pt-2 md:justify-start md:pt-0">
          <div className="w-[290px] sm:w-[340px] md:-ml-[215px] md:w-[540px] lg:-ml-[240px] lg:w-[600px]">
            <SpinWheelSvg
              segments={wheelSlices}
              rotationDeg={rotationDeg}
              spinning={spinning}
              size={600}
              pointerAngleDeg={WHEEL_POINTER_RIGHT_ANGLE_DEG}
              ariaLabel="Spin to Win wheel"
            />
          </div>
        </div>

        {/* Right: Poster heading, 1/1 quota badge, boxed fields, lilac SPIN TO WIN CTA */}
        <div className="mx-auto flex w-full max-w-[380px] flex-col items-center text-center md:pr-10">
          {/* Daily spins 1/1 -> 0/1 indicator */}
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#111111]/20 bg-white px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#111111] shadow-2xs">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: effectiveRemainingSpins > 0 ? '#5b8f00' : '#f25c3b' }}
              aria-hidden="true"
            />
            <span>Daily Spin</span>
            <span className="rounded bg-[#d8f561] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#111111]">
              {quotaLabel}
            </span>
          </div>

          <h1 className="sr-only">{state.title || 'Spin to Win'}</h1>
          <SpinToWinWordmark />

          <p className="mt-3 max-w-[340px] font-mono text-[12.5px] font-medium uppercase leading-[1.45] tracking-[0.06em] text-[#1c1c1c]">
            {subtitleText}
          </p>

          {/* Unavailable / Window Closed */}
          {(!state.available || !state.isOpen || state.segments.length < 2) && !displaySpin ? (
            <div className="mt-6 w-full max-w-[330px] border border-[#111111] bg-white p-5 text-center">
              <p className="text-sm font-semibold text-[#111111]">
                {state.windowReason === 'not_started'
                  ? 'The next Spin & Win round opens soon.'
                  : state.windowReason === 'ended'
                    ? 'This Spin & Win promotion has ended.'
                    : 'Spin & Win is currently unavailable.'}
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex h-[44px] w-full items-center justify-center rounded-full border border-[#111111] bg-[#e8c6ff] px-5 text-xs font-bold uppercase tracking-[0.08em] text-[#111111] hover:bg-[#dfb4ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              >
                Continue shopping
              </Link>
            </div>
          ) : displaySpin ? (
            /* Today's Spin Result View */
            (() => {
              const displayIsPrize =
                displaySpin.segmentType === 'COUPON' || displaySpin.segmentType === 'FREE_GIFT';
              const displayTitle =
                displaySpin.segmentType === 'FREE_GIFT'
                  ? `You won ${displaySpin.giftProductName ? `Free gift: ${displaySpin.giftProductName}` : displaySpin.couponSummary || displaySpin.segmentLabel}`
                  : displayIsPrize
                    ? `You won ${displaySpin.couponSummary || displaySpin.segmentLabel}`
                    : displaySpin.segmentLabel;
              return (
            <div className="mt-6 w-full max-w-[335px] space-y-3">
              <div className="border border-[#111111] bg-white p-5 text-left shadow-xs">
                <span className="inline-block rounded-full bg-[#d8f561] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#111111]">
                  {displayIsPrize ? 'Reward unlocked' : 'Daily spin used'}
                </span>
                <h2 className="mt-2.5 text-lg font-bold tracking-tight text-[#111111]">
                  {displayTitle}
                </h2>
                {displaySpin.segmentType === 'FREE_GIFT' && displaySpin.giftProductName ? (
                  <p className="mt-1 text-xs font-medium text-[#15803d]">
                    Apply this personal code in your bag or checkout to receive {displaySpin.giftProductName} for ₹0.
                  </p>
                ) : null}

                {displayIsPrize && displaySpin.couponCode ? (
                  <>
                    <div className="mt-3 flex items-center justify-between gap-2 border border-dashed border-[#111111] bg-[#fbf8ef] px-3 py-2.5">
                      <code className="font-mono text-sm font-bold tracking-wider text-[#111111]">
                        {displaySpin.couponCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(displaySpin.couponCode!)}
                        className="rounded-full border border-[#111111] bg-[#e8c6ff] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#111111] transition hover:bg-[#dfb4ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                      >
                        {copiedCode ? 'Copied' : 'Copy code'}
                      </button>
                    </div>
                    <p className="mt-2.5 text-xs text-[#404040]">
                      Saved privately to Your Coupons
                      {wonExpiryFormatted ? ` · Valid until ${wonExpiryFormatted}` : ''}.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        saveCouponCodeForCheckout(displaySpin.couponCode!);
                        onClose?.();
                        router.push('/cart');
                      }}
                      className="mt-3 inline-flex h-[44px] w-full items-center justify-center rounded-full border border-[#111111] bg-[#111111] text-xs font-bold uppercase tracking-[0.08em] text-white transition hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] cursor-pointer"
                    >
                      {displaySpin.segmentType === 'FREE_GIFT' ? 'Apply & claim gift →' : 'Apply to bag →'}
                    </button>
                    <Link
                      href="/account/coupons"
                      className="mt-2 inline-flex h-[40px] w-full items-center justify-center rounded-full border border-[#111111] bg-[#e8c6ff] text-xs font-bold uppercase tracking-[0.08em] text-[#111111] transition hover:bg-[#dfb4ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                    >
                      View my coupons →
                    </Link>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-[#404040]">
                    No prize this round — thank you for playing!
                  </p>
                )}
              </div>

              {/* Next spin countdown / reward cooldown note */}
              <div className="border border-[#111111]/15 bg-white/85 px-4 py-3 text-xs text-[#262626]">
                {countdownReadyToSpin ? (
                  <button
                    type="button"
                    onClick={() => void refreshStatusFromServer()}
                    className="font-bold uppercase tracking-[0.06em] text-[#111111] underline"
                  >
                    Next spin is ready — refresh wheel
                  </button>
                ) : state.showNextSpinCountdown ? (
                  <div>
                    Next spin in{' '}
                    <strong className="font-mono text-[#111111]">{countdownFormatted}</strong>
                  </div>
                ) : (
                  <span>You have used today&apos;s spin ({quotaLabel}).</span>
                )}
                {(state.cooldownBlocked || (state.rewardCooldownMode !== 'disabled' && displayIsPrize)) ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-[#404040]">
                    {state.rewardCooldownMode === 'until_coupon_expires'
                      ? 'Daily Spin pauses while your won coupon is still active so you can redeem it first.'
                      : `Reward cooldown active (${state.rewardCooldownDays}-day wait after winning a prize).`}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleDismiss}
                className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#262626] hover:text-[#111111] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              >
                {variant === 'modal' ? 'NO THANKS' : 'Continue shopping'}
              </button>
            </div>
              );
            })()
          ) : state.cooldownBlocked ? (
            /* Subsequent-day Reward Cooldown Blocked View (0/1 quota left!) */
            <div className="mt-6 w-full max-w-[335px] space-y-3">
              <div className="border border-[#111111] bg-white p-5 text-left">
                <span className="inline-block rounded-full bg-[#e8c6ff] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#111111]">
                  Active reward cooldown · {quotaLabel}
                </span>
                <h2 className="mt-2.5 text-base font-bold text-[#111111]">
                  You already have an active Spin &amp; Win reward
                </h2>
                <p className="mt-1.5 text-xs text-[#404040]">
                  {state.rewardCooldownMode === 'until_coupon_expires'
                    ? 'Daily Spin pauses until your active reward coupon expires so you have time to redeem it.'
                    : `Reward cooldown is set to ${state.rewardCooldownDays} day${state.rewardCooldownDays === 1 ? '' : 's'} after each prize win.`}
                </p>
                {state.activeReward?.couponCode ? (
                  <p className="mt-1.5 text-xs text-[#262626]">
                    Coupon <strong className="font-mono">{state.activeReward.couponCode}</strong> (
                    {state.activeReward.couponSummary || state.activeReward.segmentLabel})
                    {wonExpiryFormatted ? ` expires on ${wonExpiryFormatted}.` : '.'}
                  </p>
                ) : null}
                {state.showNextSpinCountdown ? (
                  <p className="mt-2.5 text-xs text-[#262626]">
                    Next spin in{' '}
                    <strong className="font-mono text-[#111111]">{countdownFormatted}</strong>
                  </p>
                ) : null}
                <Link
                  href="/account/coupons"
                  className="mt-3 inline-flex h-[44px] w-full items-center justify-center rounded-full border border-[#111111] bg-[#e8c6ff] text-xs font-bold uppercase tracking-[0.08em] text-[#111111] transition hover:bg-[#dfb4ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                >
                  Use your active coupon →
                </Link>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#333333] hover:text-[#111111] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              >
                NO THANKS
              </button>
            </div>
          ) : (
            /* Default 1:1 Poster Entry State
             * Privacy: Signed-in email and phone come pre-masked from the server.
             * Neither field is sent to newsletters, third-party endpoints, or even
             * POST /api/spin-wheel/spin (which authenticates strictly via HTTP-only cookie).
             */
            <div className="mt-6 w-full max-w-[330px] space-y-2.5">
              {/* Boxed field 1: YOUR EMAIL (1px solid black border exact match) */}
              <div className="flex h-[46px] items-center border border-[#111111] bg-white px-3.5">
                <input
                  type={state.signedIn ? 'text' : 'email'}
                  aria-label="Your Email"
                  placeholder="YOUR EMAIL"
                  autoComplete="off"
                  readOnly={state.signedIn}
                  value={
                    state.signedIn
                      ? state.customerProfile?.email || 'Signed-in account'
                      : guestEmail
                  }
                  onChange={(e) => setGuestEmail(e.target.value)}
                  className="w-full bg-transparent text-xs font-medium tracking-[0.06em] text-[#111111] placeholder:text-[#525252] focus:outline-none"
                />
                {state.signedIn ? (
                  <span className="ml-2 shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#3a5a00]">
                    Signed in
                  </span>
                ) : null}
              </div>

              {/* Boxed field 2: YOUR PHONE NUMBER (crisp borderless white box exact match) */}
              <div className="flex h-[46px] items-center border border-transparent bg-white px-3.5 focus-within:border-[#111111]">
                <input
                  type="tel"
                  aria-label="Your Phone Number"
                  placeholder="YOUR PHONE NUMBER"
                  autoComplete="off"
                  readOnly={state.signedIn}
                  value={
                    state.signedIn
                      ? state.customerProfile?.phone ?? ''
                      : guestPhone
                  }
                  onChange={(e) => setGuestPhone(e.target.value)}
                  className="w-full bg-transparent text-xs font-medium tracking-[0.06em] text-[#111111] placeholder:text-[#525252] focus:outline-none"
                />
              </div>

              {/* Signed-in Terms Checkbox OR Signed-out account links */}
              {state.signedIn ? (
                <label className="flex cursor-pointer items-start gap-2 pt-1 text-left text-[11px] leading-snug text-[#444444]">
                  <input
                    id="spin-terms"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked);
                      if (e.target.checked) setErrorMessage(null);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#111111] focus-visible:ring-2 focus-visible:ring-[#111111]"
                  />
                  <span>
                    I accept the{' '}
                    <a
                      href="#spin-terms"
                      onClick={(e) => {
                        e.preventDefault();
                        const panel = document.getElementById('spin-terms-panel');
                        if (panel instanceof HTMLDetailsElement) {
                          panel.open = true;
                          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                      }}
                      className="font-semibold text-[#111111] underline"
                    >
                      Terms &amp; conditions
                    </a>
                    .
                  </span>
                </label>
              ) : (
                <p className="pt-0.5 text-[11px] text-[#404040]">
                  Sign in to spin once daily &amp; save rewards:{' '}
                  <Link
                    href="/auth?redirect=/spin-and-win"
                    className="font-semibold text-[#111111] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                  >
                    Sign in
                  </Link>
                  {' · '}
                  <Link
                    href="/auth?redirect=/spin-and-win&mode=signup"
                    className="font-semibold text-[#111111] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                  >
                    Create account
                  </Link>
                </p>
              )}

              {errorMessage ? (
                <p
                  role="alert"
                  className="border border-[#b91c1c]/30 bg-red-50 px-3 py-2 text-left text-xs font-medium text-[#b91c1c]"
                >
                  {errorMessage}
                </p>
              ) : null}

              {/* Primary Lilac Pill CTA: SPIN TO WIN */}
              <button
                type="button"
                disabled={spinning}
                onClick={handleSpinClick}
                className="mt-2 inline-flex h-[48px] w-full items-center justify-center rounded-full border border-[#111111] bg-[#e8c6ff] px-6 text-sm font-bold uppercase tracking-[0.07em] text-[#111111] transition hover:bg-[#dfb4ff] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2"
              >
                {spinning ? 'SPINNING...' : 'SPIN TO WIN'}
              </button>

              {/* NO THANKS */}
              <button
                type="button"
                onClick={handleDismiss}
                className="inline-block pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#262626] transition hover:text-[#111111] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              >
                NO THANKS
              </button>
            </div>
          )}

          {/* Compact accessible disclosure for plain-text prize list + terms */}
          {state.segments.length >= 2 ? (
            <details
              id="spin-terms-panel"
              className="mt-5 w-full max-w-[335px] text-left text-[11px] text-[#404040]"
            >
              <summary className="cursor-pointer text-center font-semibold uppercase tracking-[0.07em] text-[#404040] hover:text-[#111111]">
                Prizes &amp; official rules
              </summary>
              <div className="mt-2.5 border border-[#111111]/15 bg-white p-3.5">
                <p className="font-bold uppercase tracking-wider text-[#111111]">Prizes on the wheel</p>
                <ul
                  aria-label="Prizes on the wheel"
                  className="mt-1.5 flex flex-wrap gap-1.5"
                >
                  {state.segments.map((seg) => (
                    <li
                      key={seg.id}
                      className="rounded-full border border-[#111111]/15 px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: seg.colorHex, color: seg.textColorHex }}
                    >
                      {seg.label}
                    </li>
                  ))}
                </ul>
                {state.termsText ? (
                  <p className="mt-2.5 whitespace-pre-line text-[11px] leading-relaxed text-[#333333]">
                    {state.termsText}
                  </p>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}
