'use client';

import React, { useEffect, useRef, useState } from 'react';
import { isValidIndianPincode, type PincodeLocation } from '@/lib/storefront/pincode';

export interface DeliveryOptionsModalProps {
  open: boolean;
  onClose: () => void;
  itemLabel: string;
  pincode: string;
  onPincodeChange: (nextPincode: string) => void;
}

/**
 * Shared delivery options modal used on case and accessory product pages.
 * Resolves valid 6-digit Indian PIN codes via `/api/pincode/[pincode]` and
 * gracefully falls back to static delivery estimates on invalid/error replies.
 */
export function DeliveryOptionsModal({
  open,
  onClose,
  itemLabel,
  pincode,
  onPincodeChange,
}: DeliveryOptionsModalProps) {
  const [location, setLocation] = useState<PincodeLocation | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setChecking(false);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open, onClose]);

  const handleInputChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6);
    onPincodeChange(cleaned);
    if (location && cleaned !== location.pincode) {
      setLocation(null);
      setSelectedDistrict('');
    }
  };

  const handleCheck = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const target = pincode.trim();

    if (!isValidIndianPincode(target)) {
      abortRef.current?.abort();
      setLocation(null);
      setSelectedDistrict('');
      setChecking(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setChecking(true);

    try {
      const response = await fetch(`/api/pincode/${encodeURIComponent(target)}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        if (!controller.signal.aborted) {
          setLocation(null);
          setSelectedDistrict('');
        }
        return;
      }

      const payload = (await response.json()) as {
        ok?: boolean;
        location?: PincodeLocation | null;
      };

      if (controller.signal.aborted) return;

      if (payload?.ok && payload.location) {
        setLocation(payload.location);
        setSelectedDistrict(payload.location.defaultDistrict || payload.location.districts[0] || '');
      } else {
        // Remain static as before when No records found / Status Error is returned.
        setLocation(null);
        setSelectedDistrict('');
      }
    } catch {
      if (!controller.signal.aborted) {
        setLocation(null);
        setSelectedDistrict('');
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setChecking(false);
      }
    }
  };

  if (!open) return null;

  const activeLocation = location && location.pincode === pincode ? location : null;
  const activeDistrict = activeLocation
    ? (selectedDistrict && activeLocation.districts.includes(selectedDistrict)
        ? selectedDistrict
        : activeLocation.defaultDistrict)
    : '';
  const regionParts = activeLocation
    ? [activeLocation.town, activeDistrict, activeLocation.state].filter(
        (part, index, list) =>
          Boolean(part) &&
          list.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index,
      )
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-options-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[950] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#e5e5ea] relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#86868b] hover:text-[#1d1d1f] w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center text-sm cursor-pointer transition-colors"
          aria-label="Close modal"
        >
          ✕
        </button>
        <h3 id="delivery-options-title" className="text-lg font-semibold text-[#1d1d1f] mb-2">
          Delivery Options
        </h3>
        <p className="text-xs text-[#6e6e73] mb-4">
          Enter your PIN code to check exact delivery dates for {itemLabel}.
        </p>

        <form onSubmit={handleCheck} className="flex gap-2 mb-4">
          <input
            type="text"
            inputMode="numeric"
            value={pincode}
            maxLength={6}
            onChange={(event) => handleInputChange(event.target.value)}
            placeholder="Enter 6-digit PIN code"
            aria-label="6-digit PIN code"
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#d2d2d7] text-sm text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
          />
          <button
            type="submit"
            disabled={checking}
            className="bg-[#1d1d1f] text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-black transition cursor-pointer disabled:opacity-60 disabled:cursor-wait min-w-[78px]"
          >
            {checking ? 'Checking…' : 'Check'}
          </button>
        </form>

        {activeLocation ? (
          <div className="mb-3 rounded-xl border border-[#d2d2d7]/70 bg-white px-3.5 py-3 shadow-2xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#86868b]">
                  Delivering to PIN {activeLocation.pincode}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f] leading-snug">
                  {regionParts.join(', ')}
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                Available
              </span>
            </div>

            {activeLocation.districts.length > 1 ? (
              <div className="mt-2.5 pt-2.5 border-t border-[#f0f0f3]">
                <p className="text-[11px] text-[#6e6e73] mb-1.5">
                  Border PIN code covers multiple districts:
                </p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select district">
                  {activeLocation.districts.map((district) => {
                    const selected = district === activeDistrict;
                    return (
                      <button
                        key={district}
                        type="button"
                        onClick={() => setSelectedDistrict(district)}
                        aria-pressed={selected}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                          selected
                            ? 'bg-[#1d1d1f] text-white'
                            : 'bg-[#f5f5f7] text-[#333336] hover:bg-[#e8e8ed]'
                        }`}
                      >
                        {district}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="bg-[#f5f5f7] rounded-xl p-3.5 space-y-2 text-xs">
          <div className="flex justify-between font-medium">
            <span>Standard Delivery:</span>
            <span className="text-emerald-700 font-semibold">FREE (7-9 Business Days)</span>
          </div>
          <div className="flex justify-between text-[#6e6e73]">
            <span>Carrier:</span>
            <span>BlueDart / Delhivery Express</span>
          </div>
        </div>
      </div>
    </div>
  );
}
