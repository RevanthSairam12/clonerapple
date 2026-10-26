'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface DetailTab {
  key: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/**
 * Section switcher for the order detail page.
 *
 * The panels are server-rendered and handed in as children, so switching tabs
 * is instant and never refetches. Only the active panel is visible; the rest
 * stay mounted so half-filled forms survive a tab change.
 */
export function OrderDetailTabs({ tabs }: { tabs: readonly DetailTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0 || tabs.length === 0) return;
    event.preventDefault();
    const next = (index + delta + tabs.length) % tabs.length;
    setActive(tabs[next].key);
    buttonsRef.current[next]?.focus();
  }

  return (
    <div className="sa-detail-tabs">
      <div className="sa-tabs sa-tabs-bar" role="tablist" aria-label="Order sections">
        {tabs.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`order-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`order-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              ref={(element) => {
                buttonsRef.current[index] = element;
              }}
              className={`sa-tab sa-tab-btn${selected ? ' is-active' : ''}`}
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span className="sa-tab-count">{tab.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`order-panel-${tab.key}`}
          aria-labelledby={`order-tab-${tab.key}`}
          hidden={tab.key !== active}
          className="sa-tab-panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
