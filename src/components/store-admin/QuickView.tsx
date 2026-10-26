'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

/**
 * Slide-over shell for the orders list quick view.
 *
 * The panel content is server-rendered and passed in as children. Escape and a
 * backdrop click navigate back to the list with the same filters; the body
 * scroll is locked while the panel is open.
 */
export function QuickView({ closeHref, children }: { closeHref: string; children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') router.push(closeHref);
    }
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [closeHref, router]);

  return (
    <div className="sa-quickview" role="dialog" aria-modal="true" aria-label="Order quick view">
      <button
        type="button"
        className="sa-quickview-backdrop"
        aria-label="Close quick view"
        onClick={() => router.push(closeHref)}
      />
      <aside className="sa-quickview-panel">
        <button
          type="button"
          className="sa-quickview-close sa-icon-btn"
          aria-label="Close quick view"
          onClick={() => router.push(closeHref)}
        >
          ✕
        </button>
        {children}
      </aside>
    </div>
  );
}
