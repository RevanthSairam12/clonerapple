'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface WaitlistPanelInitial {
  waitlistEnabled: boolean;
  joinable: boolean;
  entryStatus: 'ACTIVE' | 'INVITED' | null;
}

type EntryStatus = 'ACTIVE' | 'INVITED' | null;

/**
 * Product-page waiting list.
 *
 * The panel is advisory: it only decides what to show. Joining is re-checked
 * inside the stock-row lock on the server, so two customers who both see
 * "Join" cannot oversubscribe a single unit, and a customer who just bought
 * the last one is told the item is back in stock instead.
 */
export function WaitlistPanel({
  productId,
  signedIn,
  signInHref,
  initial,
}: {
  productId: string;
  signedIn: boolean;
  signInHref: string;
  initial: WaitlistPanelInitial;
}) {
  const [entryStatus, setEntryStatus] = useState<EntryStatus>(initial.entryStatus);
  const [joinable, setJoinable] = useState(initial.joinable);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!initial.waitlistEnabled) return null;
  if (!entryStatus && !joinable) return null;

  async function join() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { status?: EntryStatus; message?: string; error?: string }
        | null;
      if (!response.ok) {
        setError(body?.error ?? 'Could not join the waiting list. Please try again.');
        return;
      }
      setEntryStatus(body?.status ?? 'ACTIVE');
      setJoinable(false);
      setMessage(body?.message ?? 'You are on the waiting list.');
    } catch {
      setError('Could not join the waiting list. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/waitlist?productId=${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
      const body = (await response.json().catch(() => null)) as
        | { removed?: boolean; error?: string }
        | null;
      if (!response.ok) {
        setError(body?.error ?? 'Could not leave the waiting list. Please try again.');
        return;
      }
      setEntryStatus(null);
      setJoinable(true);
      setMessage(
        body?.removed
          ? 'You have left the waiting list.'
          : 'You are not on the waiting list for this item.',
      );
    } catch {
      setError('Could not leave the waiting list. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-4 rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] p-5 text-[#1d1d1f]"
      aria-live="polite"
    >
      {entryStatus === 'INVITED' ? (
        <>
          <h2 className="text-sm font-semibold">A unit is being held for you</h2>
          <p className="text-xs text-[#86868b] mt-1.5">
            Open the claim link we sent you to complete checkout before the hold ends. The unit is
            yours only after payment is verified, and the link cannot reserve it again once the
            hold expires.
          </p>
          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="mt-3 text-xs font-medium text-[#0071e3] hover:underline disabled:opacity-50"
          >
            Give up this reservation
          </button>
        </>
      ) : entryStatus === 'ACTIVE' ? (
        <>
          <h2 className="text-sm font-semibold">You are on the waiting list</h2>
          <p className="text-xs text-[#86868b] mt-1.5">
            We will email you when a unit becomes available. Being on the list does not reserve
            stock; you will have a short window to complete checkout first.
          </p>
          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="mt-3 text-xs font-medium text-[#0071e3] hover:underline disabled:opacity-50"
          >
            Leave the waiting list
          </button>
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold">Sold out</h2>
          <p className="text-xs text-[#86868b] mt-1.5">
            This item is currently unavailable. Join the waiting list and we will email you when a
            unit can be offered to you.
          </p>
          {signedIn ? (
            <button
              type="button"
              onClick={join}
              disabled={busy}
              className="mt-3 w-full py-2.5 rounded-full bg-[#0071e3] text-white text-sm font-semibold hover:bg-[#0077ed] transition disabled:opacity-60"
            >
              {busy ? 'Joining waiting list…' : 'Join the waiting list'}
            </button>
          ) : (
            <Link
              href={signInHref}
              className="mt-3 block w-full text-center py-2.5 rounded-full bg-[#0071e3] text-white text-sm font-semibold hover:bg-[#0077ed] transition"
            >
              Sign in to join the waiting list
            </Link>
          )}
        </>
      )}

      {message ? <p className="mt-3 text-xs text-[#15803d]">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
