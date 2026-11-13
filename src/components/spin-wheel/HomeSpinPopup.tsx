'use client';

import { useCallback, useEffect, useState } from 'react';

import { SpinToWinShowcase } from '@/components/spin-wheel/SpinToWinShowcase';
import type { CustomerSpinState } from '@/lib/spin-wheel/store';

const DISMISS_STORAGE_KEY = 'gadzio_spin_popup_dismissed';

interface HomeSpinPopupProps {
  spinState?: CustomerSpinState;
}

export function HomeSpinPopup({ spinState }: HomeSpinPopupProps) {
  const [open, setOpen] = useState(false);

  const eligibleToAutoOpen = Boolean(
    spinState?.available
    && spinState.showOnHomePage
    && spinState.isOpen
    && spinState.segments.length >= 2
    && !spinState.todaySpin
    && !spinState.cooldownBlocked
    && spinState.remainingSpinsToday > 0,
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    try {
      window.sessionStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore storage access errors in restricted browsing contexts.
    }
  }, []);

  useEffect(() => {
    if (!eligibleToAutoOpen) return;
    try {
      if (window.sessionStorage.getItem(DISMISS_STORAGE_KEY) === '1') {
        return;
      }
    } catch {
      // Fall through and allow opening if sessionStorage is unavailable.
    }
    const timer = window.setTimeout(() => setOpen(true), 250);
    return () => window.clearTimeout(timer);
  }, [eligibleToAutoOpen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  if (!open || !spinState) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={spinState.title || 'Spin and Win'}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6"
    >
      <div className="relative max-h-[94dvh] w-full max-w-[980px] overflow-y-auto rounded-[22px] border border-[#111111]/15 bg-[#fbf8ef] shadow-2xl">
        <SpinToWinShowcase initialState={spinState} variant="modal" onClose={handleClose} />
      </div>
    </div>
  );
}

