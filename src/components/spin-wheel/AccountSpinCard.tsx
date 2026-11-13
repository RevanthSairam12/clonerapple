'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { formatSpinCountdown } from '@/lib/spin-wheel/countdown';
import type { ActiveSpinRewardView, CustomerSpinResultView } from '@/lib/spin-wheel/store';

interface AccountSpinCardProps {
  title: string;
  todaySpin: CustomerSpinResultView | null;
  secondsUntilReset: number;
  dailySpinsTotal?: number;
  remainingSpinsToday?: number;
  cooldownBlocked?: boolean;
  showNextSpinCountdown?: boolean;
  activeReward?: ActiveSpinRewardView | null;
}

export function AccountSpinCard({
  title,
  todaySpin,
  secondsUntilReset,
  dailySpinsTotal = 1,
  remainingSpinsToday,
  cooldownBlocked = false,
  showNextSpinCountdown = true,
  activeReward = null,
}: AccountSpinCardProps) {
  const [targetMs] = useState<number>(
    () => Date.now() + Math.max(0, secondsUntilReset) * 1000,
  );
  const [remainingMs, setRemainingMs] = useState<number>(
    () => Math.max(0, secondsUntilReset) * 1000,
  );

  const isWaiting = Boolean(todaySpin) || cooldownBlocked;

  useEffect(() => {
    if (!isWaiting) return;
    const tick = () => setRemainingMs(Math.max(0, targetMs - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isWaiting, targetMs]);

  const countdown = formatSpinCountdown(remainingMs);
  const readyAfterCountdown = isWaiting && remainingMs <= 0;
  const effectiveRemaining =
    readyAfterCountdown
      ? dailySpinsTotal
      : remainingSpinsToday ?? (isWaiting ? 0 : dailySpinsTotal);
  const quotaText = `${effectiveRemaining}/${dailySpinsTotal}`;

  return (
    <Link
      href="/spin-and-win"
      className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
    >
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden="true">🎡</span>
            <span className="rounded-full bg-[#e8c6ff] px-2.5 py-0.5 font-mono text-xs font-bold text-[#111111]">
              {quotaText}
            </span>
          </div>
          <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
            {isWaiting && !readyAfterCountdown ? 'View result →' : 'Spin now →'}
          </span>
        </div>
        <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">
          {title || 'Spin and Win'}
        </h2>
        <p className="mt-1 text-sm text-[#6e6e73]">
          {!isWaiting || readyAfterCountdown ? (
            <span className="font-semibold text-[#1d1d1f]">
              Spin now — {quotaText} daily free spin ready
            </span>
          ) : (todaySpin?.segmentType === 'COUPON' || todaySpin?.segmentType === 'FREE_GIFT') && todaySpin.couponCode ? (
            <>
              Won <strong>{todaySpin.couponSummary || todaySpin.segmentLabel}</strong> · Code{' '}
              <span className="font-mono font-semibold text-[#1d1d1f]">{todaySpin.couponCode}</span>
            </>
          ) : cooldownBlocked && activeReward?.couponCode ? (
            <>
              Active reward <strong>{activeReward.couponSummary || activeReward.segmentLabel}</strong> · Code{' '}
              <span className="font-mono font-semibold text-[#1d1d1f]">{activeReward.couponCode}</span>
            </>
          ) : (
            'Daily free spin complete'
          )}
        </p>
      </div>
      <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
        {!isWaiting || readyAfterCountdown ? (
          <span>Win personal coupons &amp; free gifts · Resets daily</span>
        ) : showNextSpinCountdown ? (
          <span>
            Next spin in <strong className="font-mono text-[#1d1d1f]">{countdown}</strong>
          </span>
        ) : (
          <span>Cooldown active until next eligible spin</span>
        )}
      </div>
    </Link>
  );
}
