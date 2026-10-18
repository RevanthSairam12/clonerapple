'use client';

import { cn } from '@/lib/utils';

interface ExploreAccessoriesHeaderProps {
  heading?: string;
}

/* ----------------------------------------------------------- Hand-Drawn Doodles */

/** Playful 4-point sparkle */
function SparkleDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <path
        d="M16 2 C16 9, 18 14, 30 16 C18 18, 16 23, 16 30 C16 23, 14 18, 2 16 C14 14, 16 9, 16 2 Z"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}

/** Playful lightning zap (power & chargers) */
function LightningDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 36" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <path
        d="M16 2 L5 19 L14 19 L12 34 L23 16 L14 16 Z"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="2" y1="9" x2="5" y2="7" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="22" y1="27" x2="25" y2="25" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Musical Eighth Notes (AirPods & audio) */
function MusicNotesDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <ellipse cx="9" cy="24" rx="5" ry="3.5" strokeWidth="2.2" fill="currentColor" />
      <ellipse cx="23" cy="20" rx="5" ry="3.5" strokeWidth="2.2" fill="currentColor" />
      <path d="M14 24 L14 8 L28 4 L28 20" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 13 L28 9" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Battery Outline with Charge Bar (power) */
function BatteryDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 20" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <rect x="2" y="2" width="28" height="16" rx="4" strokeWidth="2.2" />
      <path d="M32 7 C33.5 7, 34 8.5, 34 10 C34 11.5, 33.5 13, 32 13" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="6" y="6" width="6" height="8" rx="1.5" fill="currentColor" />
      <rect x="15" y="6" width="6" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** Hand-Drawn Apple Pencil / Stylus */
function PencilDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 20" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <path d="M12 4 L34 4 C36 4, 37 6, 37 8 C37 10, 36 12, 34 12 L12 12 Z" strokeWidth="2.2" />
      <path d="M12 4 L2 8 L12 12" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1="28" y1="4" x2="28" y2="12" strokeWidth="2" />
      <circle cx="5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** Asterisk / Starburst */
function AsteriskDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <line x1="12" y1="3" x2="12" y2="21" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="3" y1="12" x2="21" y2="12" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/* ----------------------------------------------------------- Main Header */

export function ExploreAccessoriesHeader({
  heading = 'Explore Accessories',
}: ExploreAccessoriesHeaderProps) {
  // Split heading into two separate words for individual alternate floating
  const words = heading.trim().split(/\s+/);
  const firstWord = words[0] || 'Explore';
  const secondWord = words.slice(1).join(' ') || 'Accessories';

  return (
    <div
      className="relative w-full overflow-hidden select-none py-12 sm:py-16 al:py-20 text-center flex flex-col items-center justify-center"
      aria-label={heading}
    >
      {/* Screen-reader accessible heading */}
      <h2 className="sr-only">{heading}</h2>

      {/* Two separate floating components with alternate movement */}
      <div
        aria-hidden="true"
        className="relative flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-7 gap-y-2 px-6 sm:px-12"
      >
        {/* COMPONENT 1: "EXPLORE" (Movement Phase A) */}
        <div className="relative inline-block animate-smooth-float">
          {/* Sparkle star (Top-Left of Explore) */}
          <div className="absolute -top-7 -left-4 sm:-top-9 sm:-left-6 text-[#1d1d1f] animate-doodle-1 pointer-events-none">
            <SparkleDoodle className="size-6 sm:size-8 drop-shadow-sm" />
          </div>

          {/* Apple Pencil (Far-Left of Explore) */}
          <div className="absolute top-1/2 -left-9 sm:-left-13 -translate-y-1/2 -rotate-25 text-[#1d1d1f] animate-doodle-2 pointer-events-none hidden sm:block">
            <PencilDoodle className="w-9 sm:w-11 h-auto drop-shadow-sm" />
          </div>

          {/* Musical Notes (Top-Right of Explore) */}
          <div className="absolute -top-7 -right-2 sm:-top-9 sm:-right-4 text-[#1d1d1f] animate-doodle-2 pointer-events-none hidden xs:block">
            <MusicNotesDoodle className="size-5 sm:size-7 drop-shadow-sm" />
          </div>

          {/* Word 1 Text */}
          <span
            className={cn(
              'relative z-10 px-2 sm:px-3 inline-block',
              'text-[clamp(2.5rem,7vw,5.75rem)] font-[650] tracking-[-0.025em] uppercase leading-none',
              'text-[#1d1d1f] hover:text-[#0071e3] transition-colors duration-300 cursor-default',
              'drop-shadow-[0_2px_8px_rgba(0,0,0,0.03)]',
            )}
            style={{
              // DEACTIVATED (previous font) — kept for easy rollback:
              // fontFamily: "'Mona Sans', var(--gz-font-display), -apple-system, sans-serif",
              // ACTIVE — matches the hero headlines in GadzioHeroSection.tsx
              fontFamily:
                '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontStretch: '105%',
            }}
          >
            {firstWord}
          </span>
        </div>

        {/* COMPONENT 2: "ACCESSORIES" (Movement Phase B — Alternate / Inverted Float) */}
        <div className="relative inline-block animate-smooth-float-alt">
          {/* Battery charge (Top-Left of Accessories) */}
          <div className="absolute -top-6 -left-3 sm:-top-8 sm:-left-5 text-[#1d1d1f] animate-doodle-1 pointer-events-none hidden sm:block">
            <BatteryDoodle className="w-7 sm:w-9 h-auto drop-shadow-sm" />
          </div>

          {/* Lightning zap (Top-Right of Accessories) */}
          <div className="absolute -top-8 -right-3 sm:-top-10 sm:-right-5 text-[#1d1d1f] animate-doodle-1 pointer-events-none">
            <LightningDoodle className="size-6 sm:size-7 drop-shadow-sm" />
          </div>

          {/* Asterisk starburst (Bottom-Right of Accessories) */}
          <div className="absolute -bottom-5 -right-2 sm:-bottom-7 sm:-right-4 text-[#1d1d1f] animate-doodle-2 pointer-events-none">
            <AsteriskDoodle className="size-5 sm:size-6 drop-shadow-sm" />
          </div>

          {/* Word 2 Text */}
          <span
            className={cn(
              'relative z-10 px-2 sm:px-3 inline-block',
              'text-[clamp(2.5rem,7vw,5.75rem)] font-[650] tracking-[-0.025em] uppercase leading-none',
              'text-[#1d1d1f] hover:text-[#0071e3] transition-colors duration-300 cursor-default',
              'drop-shadow-[0_2px_8px_rgba(0,0,0,0.03)]',
            )}
            style={{
              // DEACTIVATED (previous font) — kept for easy rollback:
              // fontFamily: "'Mona Sans', var(--gz-font-display), -apple-system, sans-serif",
              // ACTIVE — matches the hero headlines in GadzioHeroSection.tsx
              fontFamily:
                '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontStretch: '105%',
            }}
          >
            {secondWord}
          </span>
        </div>
      </div>
    </div>
  );
}
