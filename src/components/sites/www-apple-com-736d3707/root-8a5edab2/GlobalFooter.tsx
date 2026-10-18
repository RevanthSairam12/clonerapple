'use client';

import type { FooterOverride } from './admin-overrides';
import { GadzioFooter } from '@/components/footer/GadzioFooter';

/**
 * GlobalFooter — the site-wide Gadzio storefront footer.
 *
 * `content` carries the admin's `apple.footer` override; GadzioFooter consumes
 * the copyright / locale fields from it and falls back to the code defaults in
 * data/footer.ts for anything unset (the homepage passes `{}` when no DB row
 * exists, so every field must be allowed to fall through).
 */
export function GlobalFooter({ content }: { content?: FooterOverride } = {}) {
  return <GadzioFooter content={content} />;
}

/* =========================================================================
   PREVIOUS GADZIO / APPLE FOOTER CODE (KEPT COMMENTED AS REQUESTED - DO NOT REMOVE)
   =========================================================================
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FOOTER_BOTTOM, FOOTER_DIRECTORY, FOOTER_FOOTNOTES_HTML } from './data/footer';
import { FooterChevronIcon } from './icons';

export function PreviousAppleFooter({ content }: { content?: FooterOverride } = {}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const footnotesHtml = content?.footnotesHtml ?? FOOTER_FOOTNOTES_HTML;
  const copyright = content?.copyright ?? FOOTER_BOTTOM.copyright;
  const localeLabel = content?.localeLabel ?? FOOTER_BOTTOM.localeLabel;
  const localeHref = content?.localeHref ?? FOOTER_BOTTOM.localeHref;

  const toggle = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <footer id="gz-globalfooter" className="relative z-1 bg-[#f5f5f7]">
      <div className="mx-auto box-content max-w-[980px] px-[16px] anav:px-[22px]">
        <h2 className="gz-visuallyhidden">Gadzio Footer</h2>

        <section
          aria-label="Footnotes"
          className="gz-sosumi pt-[17px] pb-[11px]"
          dangerouslySetInnerHTML={{ __html: footnotesHtml }}
        />

        <nav aria-label="Gadzio Directory" className="flex flex-col pt-[20px] anav:flex-row">
          {FOOTER_DIRECTORY.map((column, columnIndex) => (
            <div key={columnIndex} className="anav:w-[196px] anav:shrink ant-basis-1/4">
              {column.sections.map((section, sectionIndex) => {
                const key = `${columnIndex}:${section.title}`;
                const isOpen = Boolean(openSections[key]);
                return (
                  <div
                    key={section.title}
                    className={cn(
                      'gz-footer-section -ml-[4px] overflow-hidden px-[4px] pb-[1px] anav:m-0 anav:overflow-visible anav:p-0',
                      sectionIndex > 0 && 'anav:pt-[24px]',
                      !isOpen && 'max-h-[37px] anav:max-h-none',
                    )}
                  >
                    <h3 className="text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.88)] anav:mb-[9.5px]">
                      <span className="hidden font-semibold anav:inline">{section.title}</span>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => toggle(key)}
                        className="flex h-[36px] w-full cursor-pointer items-center justify-between text-left font-semibold anav:hidden"
                      >
                        <span>{section.title}</span>
                        <span
                          aria-hidden="true"
                          className={cn(
                            'gz-footer-accordion-icon h-[6px] w-[11px] transition-transform duration-[320ms]',
                            isOpen && 'rotate-180',
                          )}
                        >
                          <FooterChevronIcon />
                        </span>
                      </button>
                    </h3>
                    <ul
                      className={cn(
                        'block overflow-hidden pt-[5px] pb-[16px] anav:mr-[20px] anav:overflow-visible anav:p-0',
                        isOpen ? 'visible' : 'invisible anav:visible',
                      )}
                    >
                      {section.links.map((link) => (
                        <li
                          key={`${link.label}|${link.href}`}
                          className="block anav:mb-[9.6px] anav:h-[16px] anav:last:mb-0"
                        >
                          <a
                            href={link.href}
                            className="gz-footer-link block px-[14px] py-[6px] text-[12px] leading-[16.0005px] tracking-[-0.12px] anav:-mr-[20px] anav:-my-[4px] anav:inline-block anav:py-[4px] anav:pr-[20px] anav:pl-0"
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <section className="pt-[17px] pb-[9px] anav:pt-[37px] anav:pb-[11px]">
          <div
            className="gz-footer-shop mb-[8px] pb-[8px] text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.56)] anav:mb-[16px] anav:pb-[19px]"
            dangerouslySetInnerHTML={{ __html: FOOTER_BOTTOM.shopHtml }}
          />

          <div className="mt-[5px] pt-[4px] text-[12px] leading-[16.0005px] tracking-[-0.12px] anav:hidden">
            <a
              href={localeHref}
              title="Choose your country or region"
              className="gz-footer-locale-link -my-[4px] inline-block py-[4px] whitespace-nowrap"
            >
              {localeLabel}
            </a>
          </div>

          <div className="relative pt-[12px] text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.56)] anav:flow-root anav:pt-0">
            <div className="mt-[5px] anav:mr-[30px] anav:float-left">{copyright}</div>
            <ul className="mt-[5px] block anav:mr-[30px] anav:float-left" role="list">
              {FOOTER_BOTTOM.legalLinks.map((link) => (
                <li key={link.href} className="gz-footer-legal-item mt-[8px] mr-[6px] inline-block anav:mt-[5px]" role="listitem">
                  <a
                    href={link.href}
                    className="gz-footer-legal-link relative -my-[4px] -ml-[9px] inline-block px-[9px] py-[4px] whitespace-nowrap"
                  >
                    {link.label}
                  </a>
                </li>
              )).flatMap((node, i) => (i === 0 ? [node] : [' ', node]))}
            </ul>
            <div className="hidden anav:block anav:text-right">
              <a
                href={localeHref}
                title="Choose your country or region"
                className="gz-footer-locale-link -my-[4px] inline-block py-[4px] whitespace-nowrap"
              >
                {localeLabel}
              </a>
            </div>
          </div>
        </section>
      </div>
    </footer>
  );
}
========================================================================= */
