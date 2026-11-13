'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { formatCountdownHms } from '@/lib/spin-wheel/countdown';
import type { CustomerSpinResultView } from '@/lib/spin-wheel/store';

interface AccountSpinCardProps {
  title: string;
  todaySpin: CustomerSpinResultView | null;
  secondsUntilReset: number;
}

export function AccountSpinCard({
  title,
  todaySpin,
  secondsUntilReset,
}: AccountSpinCardProps) {
  const [targetMs] = useState<number>(
    () => Date.now() + Math.max(0, secondsUntilReset) * 1000,
  );
  const [remainingMs, setRemainingMs] = useState<number>(
    () => Math.max(0, secondsUntilReset) * 1000,
  );

  useEffect(() => {
    if (!todaySpin) return;
    const tick = () => setRemainingMs(Math.max(0, targetMs - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [todaySpin, targetMs]);

  const countdown = formatCountdownHms(remainingMs);
  const readyAfterCountdown = todaySpin !== null && remainingMs <= 0;

  return (
    <Link
      href="/spin-and-win"
      className="group flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm transition hover:border-[#1d1d1f] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="text-2xl" aria-hidden="true">🎡</span>
          <span className="text-xs font-semibold text-[#1d1d1f] group-hover:underline">
            {todaySpin && !readyAfterCountdown ? 'View result →' : 'Spin now →'}
          </span>
        </div>
        <h2 className="mt-3 text-lg font-semibold text-[#1d1d1f]">
          {title || 'Spin and Win'}
        </h2>
        <p className="mt-1 text-sm text-[#6e6e73]">
          {!todaySpin || readyAfterCountdown ? (
            <span className="font-semibold text-[#1d1d1f]">Spin now — 1 free spin ready today</span>
          ) : todaySpin.segmentType === 'COUPON' && todaySpin.couponCode ? (
            <>
              Won <strong>{todaySpin.couponSummary || todaySpin.segmentLabel}</strong> · Code{' '}
              <span className="font-mono font-semibold text-[#1d1d1f]">{todaySpin.couponCode}</span>
            </>
          ) : (
            'Today’s free spin complete'
          )}
        </p>
      </div>
      <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
        {!todaySpin || readyAfterCountdown ? (
          <span>Win instant personal coupons · Resets daily</span>
        ) : (
          <span>
            Next spin in <strong className="font-mono text-[#1d1d1f]">{countdown}</strong>
          </span>
        )}
      </div>
    </Link>
  );
}

