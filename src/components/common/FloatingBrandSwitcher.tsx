'use client';

import { useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

interface FloatingBrandSwitcherProps {
  /** 'apple' means currently on Gadzio/Apple site (switcher links to Android).
   *  'oppo' means currently on Android/OPPO site (switcher links to Gadzio). */
  currentBrand?: 'apple' | 'oppo';
}

function AndroidLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16.86 9.07L18.47 6.28C18.6 6.05 18.52 5.76 18.29 5.63C18.06 5.5 17.77 5.58 17.64 5.81L16 8.65C14.77 8.09 13.41 7.77 12 7.77S9.23 8.09 8 8.65L6.36 5.81C6.23 5.58 5.94 5.5 5.71 5.63C5.48 5.76 5.4 6.05 5.53 6.28L7.14 9.07C4.24 10.65 2.27 13.62 2.05 17.15H21.95C21.73 13.62 19.76 10.65 16.86 9.07Z"
        fill="currentColor"
      />
      <circle cx="7.5" cy="14" r="1.15" fill="white" />
      <circle cx="16.5" cy="14" r="1.15" fill="white" />
    </svg>
  );
}

function GadzioLogo({ className }: { className?: string }) {
  return (
    <img
      src="/gadzio_logo.png"
      alt="Gadzio"
      className={cn('h-3.5 w-auto object-contain', className)}
    />
  );
}

export function FloatingBrandSwitcher({ currentBrand = 'apple' }: FloatingBrandSwitcherProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isApple = currentBrand === 'apple';
  const targetHref = isApple ? '/android' : '/';
  const targetName = isApple ? 'Android' : 'Gadzio';
  const targetBadge = isApple ? 'Smartphones & Tech' : 'Apple Store';
  const targetDesc = isApple
    ? 'Explore flagship Android devices, high-res camera phones, tablets, and smart audio.'
    : 'Shop Mac, iPad, iPhone, Apple Watch, AirPods, and student education pricing.';

  return (
    <aside
      className="fixed right-3 sm:right-5 top-1/2 -translate-y-1/2 z-[9990] select-none"
      aria-label={`Switch to ${targetName}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div className="relative flex items-center">
        {/* Expanded Drawer Card */}
        <div
          className={cn(
            'absolute right-[56px] sm:right-[64px] top-1/2 -translate-y-1/2',
            'w-[260px] sm:w-[285px] p-4 rounded-2xl shadow-2xl backdrop-blur-xl',
            'bg-[#1d1d1f]/97 text-[#f5f5f7] border border-white/20 shadow-black/70',
            'transition-all duration-300 ease-out origin-right',
            isExpanded
              ? 'opacity-100 visible translate-x-0 scale-100 pointer-events-auto'
              : 'opacity-0 invisible translate-x-3 scale-95 pointer-events-none',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-white text-black shadow-xs">
                {targetName}
              </span>
              <span className="text-[11px] text-white/70 font-medium">{targetBadge}</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(false);
              }}
              className="text-white/50 hover:text-white text-xs p-1 leading-none cursor-pointer rounded-full transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Description */}
          <p className="text-[12px] leading-relaxed text-white/80 mb-3.5">{targetDesc}</p>

          {/* Quick links & action */}
          <div className="flex flex-col gap-2">
            <Link
              href={targetHref}
              onClick={() => setIsExpanded(false)}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-full text-xs font-semibold bg-white hover:bg-white/90 text-black shadow-md active:scale-98 transition-all"
            >
              <span>Switch to {targetName} Store</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>

            {isApple ? (
              <div className="flex items-center justify-between text-[11px] text-white/60 pt-1 px-1">
                <span>📱 Smartphones</span>
                <span>🎧 Audio</span>
                <span>⚡ Fast Charge</span>
              </div>
            ) : (
              <div className="flex items-center justify-between text-[11px] text-white/60 pt-1 px-1">
                <span>💻 Mac</span>
                <span>📱 iPhone</span>
                <span>🎓 Student</span>
              </div>
            )}
          </div>
        </div>

        {/* Round Floating Action Button (Pure White & Clean) */}
        <Link
          href={targetHref}
          aria-label={`Switch to ${targetName}`}
          onClick={() => setIsExpanded(false)}
          className={cn(
            'group relative flex items-center justify-center',
            'size-12 sm:size-14 rounded-full',
            'bg-white text-zinc-900 border border-zinc-200/90 shadow-xl hover:shadow-2xl',
            'hover:scale-105 active:scale-95 transition-all duration-300 ease-out cursor-pointer',
          )}
        >
          {isApple ? (
            <div className="flex flex-col items-center justify-center">
              <AndroidLogo className="size-7 sm:size-8 text-zinc-900 group-hover:scale-110 transition-transform" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-1">
              <GadzioLogo className="group-hover:scale-110 transition-transform" />
            </div>
          )}

          {/* Tooltip hint ring on hover */}
          <span className="sr-only">Switch to {targetName}</span>
        </Link>
      </div>
    </aside>
  );
}
