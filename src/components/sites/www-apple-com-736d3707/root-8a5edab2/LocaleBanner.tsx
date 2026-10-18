'use client';

import { useState } from 'react';

import { LOCALE_BANNER } from './data/locale-banner';
import { LocaleCloseIcon } from './icons';
import type { LocaleBannerOverride } from './admin-overrides';

/**
 * `aside#gz-localeswitcher` — fixed banner above the nav (z 10000). Dismissing
 * it removes the banner and lets the nav slide to top: 0, which is why the
 * parent owns the open state.
 *
 * Geometry (measured): 70px tall and a centred 980px row at >=834px; 135px tall
 * with stacked copy/actions and 16px padding below that.
 */
export function LocaleBanner({
  onDismiss,
  content,
}: {
  onDismiss: () => void;
  content?: LocaleBannerOverride;
}) {
  const [expanded, setExpanded] = useState(false);

  const copy = content?.copy ?? LOCALE_BANNER.copy;
  const selectedLabel = content?.selectedLabel ?? LOCALE_BANNER.selectedLabel;
  const continueLabel = content?.continueLabel ?? LOCALE_BANNER.continueLabel;
  const continueHref = content?.continueHref ?? LOCALE_BANNER.continueHref;

  return (
    <aside
      lang={LOCALE_BANNER.lang}
      dir="ltr"
      aria-label={LOCALE_BANNER.ariaLabel}
      className="fixed inset-x-0 top-0 z-10000 flex h-[135px] bg-[#fafafc] anav:h-[70px]"
    >
      <div className="mx-auto w-full max-w-[980px] px-[16px] anav:flex anav:items-center anav:justify-between anav:px-[22px]">
        <div className="pt-[16px] pr-[42px] text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.8)] anav:max-w-[430px] anav:p-0">
          {copy}
        </div>

        <div className="mt-[14.5px] -ml-[2px] flex items-center justify-end anav:m-0 anav:pl-[29px]">
          {/* .gz-ls-dropdown — a button that reveals the region list */}
          <div className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex h-[42px] w-[255px] items-center rounded-[11px] border border-[rgba(0,0,0,0.16)] bg-[#fafafc] px-[14px] text-left text-[17px] text-[rgba(0,0,0,0.8)] anav:w-[349px]"
            >
              <span className="grow">{selectedLabel}</span>
              <span aria-hidden="true" className="ml-[8px] text-[10px] leading-none opacity-60">
                ▾
              </span>
            </button>
            {expanded ? (
              <ul className="absolute top-[46px] left-0 z-10 w-full overflow-hidden rounded-[11px] border border-[rgba(0,0,0,0.12)] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
                {LOCALE_BANNER.options.map((option) => (
                  <li key={option.href}>
                    <a
                      href={option.href}
                      className="block px-[14px] py-[10px] text-[14px] text-[rgba(0,0,0,0.8)] hover:bg-[#f5f5f7]"
                    >
                      {option.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <a
            href={continueHref}
            role="button"
            className="ml-[13px] max-w-[calc(50%-8px)] rounded-[8px] bg-[#1d1d1f] px-[15px] py-[8px] text-[14px] leading-[18.0008px] tracking-[-0.224px] text-white anav:max-w-none"
          >
            {continueLabel}
          </a>

          <button
            type="button"
            onClick={onDismiss}
            aria-label={LOCALE_BANNER.closeLabel}
            className="absolute top-[17px] right-[14px] size-[18px] text-[rgba(0,0,0,0.8)] anav:static anav:my-[12px] anav:-mr-[2px] anav:ml-[14px]"
          >
            <LocaleCloseIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
