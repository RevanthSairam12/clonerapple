'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { SpinToWinShowcase } from '@/components/spin-wheel/SpinToWinShowcase';
import type { CustomerSpinState } from '@/lib/spin-wheel/store';

export const SPIN_POPUP_SESSION_KEY = 'gadzio_spin_popup_session_seen_v1';
export const SPIN_POPUP_DISMISS_UNTIL_KEY = 'gadzio_spin_popup_dismissed_until_v1';
export const SPIN_POPUP_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const BLOCKED_POPUP_PREFIXES = [
  '/checkout',
  '/order',
  '/payu',
  '/account',
  '/store-admin',
  '/admin',
  '/spin-and-win',
] as const;

export function isSpinPopupRouteBlocked(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return BLOCKED_POPUP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el === document.activeElement),
  );
}

function readPopupSuppressed(): boolean {
  try {
    if (window.sessionStorage.getItem(SPIN_POPUP_SESSION_KEY) === '1') {
      return true;
    }
    const rawUntil = window.localStorage.getItem(SPIN_POPUP_DISMISS_UNTIL_KEY);
    const dismissedUntil = rawUntil ? Number.parseInt(rawUntil, 10) : 0;
    if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) {
      return true;
    }
  } catch {
    // Allow graceful fallback when storage is disabled in restricted contexts.
  }
  return false;
}

function markSessionSeen() {
  try {
    window.sessionStorage.setItem(SPIN_POPUP_SESSION_KEY, '1');
  } catch {
    // Ignore storage access errors.
  }
}

function markDismissedForSevenDays() {
  try {
    window.sessionStorage.setItem(SPIN_POPUP_SESSION_KEY, '1');
    window.localStorage.setItem(
      SPIN_POPUP_DISMISS_UNTIL_KEY,
      String(Date.now() + SPIN_POPUP_DISMISS_TTL_MS),
    );
  } catch {
    // Ignore storage access errors.
  }
}

interface HomeSpinPopupProps {
  spinState?: CustomerSpinState;
}

export function HomeSpinPopup({ spinState }: HomeSpinPopupProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [showMobilePill, setShowMobilePill] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(() => !(spinState?.popupRequireScroll ?? true));
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mobilePillRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const routeBlocked = isSpinPopupRouteBlocked(pathname);
  const eligible = Boolean(
    !routeBlocked
    && spinState?.available
    && spinState.showOnHomePage
    && spinState.popupEnabled
    && spinState.isOpen
    && spinState.segments.length >= 2
    && !spinState.todaySpin
    && !spinState.cooldownBlocked
    && spinState.remainingSpinsToday > 0,
  );

  // Track mobile breakpoint + prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mobileMq = window.matchMedia('(max-width: 767px)');
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setIsMobileViewport(mobileMq.matches);
      setReducedMotion(motionMq.matches);
    };
    sync();
    mobileMq.addEventListener?.('change', sync);
    motionMq.addEventListener?.('change', sync);
    return () => {
      mobileMq.removeEventListener?.('change', sync);
      motionMq.removeEventListener?.('change', sync);
    };
  }, []);

  // Wait for initial scroll when admin setting popupRequireScroll is enabled.
  useEffect(() => {
    if (!eligible) return;
    if (!spinState?.popupRequireScroll) {
      setHasScrolled(true);
      return;
    }
    const checkScroll = () => {
      if (window.scrollY > 40) {
        setHasScrolled(true);
      }
    };
    checkScroll();
    window.addEventListener('scroll', checkScroll, { passive: true });
    return () => window.removeEventListener('scroll', checkScroll);
  }, [eligible, spinState?.popupRequireScroll]);

  // Honor session + 7-day dismissal cap, configured delay, scroll gate, and mobile mode.
  useEffect(() => {
    if (!eligible || !hasScrolled || open) return;
    if (readPopupSuppressed()) return;

    const delayMs = Math.max(0, Number(spinState?.popupDelaySeconds ?? 10)) * 1000;
    const timer = window.setTimeout(() => {
      if (readPopupSuppressed()) return;

      if (isMobileViewport && (spinState?.popupMobileFloatingButton ?? true)) {
        setShowMobilePill(true);
        return;
      }

      if (document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }
      markSessionSeen();
      setOpen(true);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    eligible,
    hasScrolled,
    open,
    isMobileViewport,
    spinState?.popupDelaySeconds,
    spinState?.popupMobileFloatingButton,
  ]);

  const restorePreviousFocus = useCallback(() => {
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    if (prev && prev.isConnected) {
      window.requestAnimationFrame(() => {
        prev.focus();
      });
    }
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setShowMobilePill(false);
    markDismissedForSevenDays();
    restorePreviousFocus();
  }, [restorePreviousFocus]);

  const handleOpenFromMobilePill = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    } else if (mobilePillRef.current) {
      previousFocusRef.current = mobilePillRef.current;
    }
    markSessionSeen();
    setShowMobilePill(false);
    setOpen(true);
  }, []);

  // Move focus inside dialog when opened + trap Tab / Shift+Tab + close on Escape.
  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const dialogEl = dialogRef.current;
    const rafId = window.requestAnimationFrame(() => {
      const focusables = getFocusableElements(dialogEl);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialogEl.focus();
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = getFocusableElements(dialogRef.current);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handleClose]);

  if (!eligible || !spinState) return null;

  return (
    <>
      {showMobilePill && !open ? (
        <div className="fixed bottom-4 right-4 z-[85] md:hidden">
          <button
            ref={mobilePillRef}
            type="button"
            onClick={handleOpenFromMobilePill}
            aria-label={`Open ${spinState.title || 'Spin and Win'}`}
            className={`inline-flex items-center gap-2 rounded-full border border-[#111111] bg-[#e8c6ff] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.06em] text-[#111111] shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 ${
              reducedMotion ? 'transition-none' : 'transition hover:bg-[#dfb4ff] active:scale-[0.98]'
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-[#3a5a00]" aria-hidden="true" />
            <span>Spin &amp; Win</span>
            <span className="rounded-full bg-[#d8f561] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#111111]">
              {spinState.remainingSpinsToday}/{spinState.dailySpinsTotal}
            </span>
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={spinState.title || 'Spin and Win'}
          onClick={(event) => {
            if (event.target === event.currentTarget) handleClose();
          }}
          className={`fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-3 sm:p-6 ${
            reducedMotion ? 'transition-none' : 'backdrop-blur-[2px] transition-opacity'
          }`}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="relative max-h-[94dvh] w-full max-w-[980px] overflow-y-auto rounded-[22px] border border-[#111111]/15 bg-[#fbf8ef] shadow-2xl focus:outline-none"
          >
            <SpinToWinShowcase initialState={spinState} variant="modal" onClose={handleClose} />
          </div>
        </div>
      ) : null}
    </>
  );
}
