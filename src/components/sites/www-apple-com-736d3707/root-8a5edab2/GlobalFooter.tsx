'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import { FOOTER_BOTTOM, FOOTER_DIRECTORY, FOOTER_FOOTNOTES_HTML } from './data/footer';
import { FooterChevronIcon } from './icons';
import type { FooterOverride } from './admin-overrides';

/**
 * `footer#ac-globalfooter`.
 *
 * Layout: a content-box 980px column (padding 22px at >=834px, 16px below) with
 * three stacked blocks — legal footnotes, the 5-column directory, and the bottom
 * shop/legal row. Below 834px the directory becomes a stack of collapsible
 * accordions (measured collapsed: section height 37px, list `visibility:hidden`
 * clipped by `overflow:hidden`, `aria-expanded="false"`).
 */
export function GlobalFooter({ content }: { content?: FooterOverride } = {}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const footnotesHtml = content?.footnotesHtml ?? FOOTER_FOOTNOTES_HTML;
  const copyright = content?.copyright ?? FOOTER_BOTTOM.copyright;
  const localeLabel = content?.localeLabel ?? FOOTER_BOTTOM.localeLabel;
  const localeHref = content?.localeHref ?? FOOTER_BOTTOM.localeHref;

  const toggle = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <footer id="ac-globalfooter" className="relative z-1 bg-[#f5f5f7]">
      <div className="mx-auto box-content max-w-[980px] px-[16px] anav:px-[22px]">
        <h2 className="ac-visuallyhidden">Apple Footer</h2>

        {/* .ac-gf-sosumi — rendered verbatim so the ul/ol nesting keeps its height */}
        <section
          aria-label="Footnotes"
          className="ac-sosumi pt-[17px] pb-[11px]"
          dangerouslySetInnerHTML={{ __html: footnotesHtml }}
        />

        {/* .ac-gf-directory */}
        <nav aria-label="Apple Directory" className="flex flex-col pt-[20px] anav:flex-row">
          {FOOTER_DIRECTORY.map((column, columnIndex) => (
            <div key={columnIndex} className="anav:w-[196px] anav:shrink anav:basis-1/4">
              {column.sections.map((section, sectionIndex) => {
                const key = `${columnIndex}:${section.title}`;
                const isOpen = Boolean(openSections[key]);
                return (
                  <div
                    key={section.title}
                    className={cn(
                      'ac-footer-section -ml-[4px] overflow-hidden px-[4px] pb-[1px] anav:m-0 anav:overflow-visible anav:p-0',
                      // every section after the first is pushed down 24px at >=834px
                      sectionIndex > 0 && 'anav:pt-[24px]',
                      !isOpen && 'max-h-[37px] anav:max-h-none',
                    )}
                  >
                    <h3 className="text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.88)] anav:mb-[9.5px]">
                      {/* static heading at >=834px, accordion trigger below it */}
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
                            'ac-footer-accordion-icon h-[6px] w-[11px] transition-transform duration-[320ms]',
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
                            className="ac-footer-link block px-[14px] py-[6px] text-[12px] leading-[16.0005px] tracking-[-0.12px] anav:-mr-[20px] anav:-my-[4px] anav:inline-block anav:py-[4px] anav:pr-[20px] anav:pl-0"
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

        {/* .ac-gf-footer */}
        <section className="pt-[17px] pb-[9px] anav:pt-[37px] anav:pb-[11px]">
          <div
            className="ac-footer-shop mb-[8px] pb-[8px] text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.56)] anav:mb-[16px] anav:pb-[19px]"
            // Verbatim: "More ways to shop: Find an Apple Store or other retailer…"
            dangerouslySetInnerHTML={{ __html: FOOTER_BOTTOM.shopHtml }}
          />

          {/* locale link — shown only below 834px, where it sits above the legal row */}
          <div className="mt-[5px] pt-[4px] text-[12px] leading-[16.0005px] tracking-[-0.12px] anav:hidden">
            <a
              href={localeHref}
              title="Choose your country or region"
              className="ac-footer-locale-link -my-[4px] inline-block py-[4px] whitespace-nowrap"
            >
              {localeLabel}
            </a>
          </div>

          <div className="relative pt-[12px] text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[rgba(0,0,0,0.56)] anav:flow-root anav:pt-0">
            <div className="mt-[5px] anav:mr-[30px] anav:float-left">{copyright}</div>
            <ul className="mt-[5px] block anav:mr-[30px] anav:float-left" role="list">
              {FOOTER_BOTTOM.legalLinks.map((link) => (
                <li key={link.href} className="ac-footer-legal-item mt-[8px] mr-[6px] inline-block anav:mt-[5px]" role="listitem">
                  <a
                    href={link.href}
                    className="ac-footer-legal-link relative -my-[4px] -ml-[9px] inline-block px-[9px] py-[4px] whitespace-nowrap"
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
                className="ac-footer-locale-link -my-[4px] inline-block py-[4px] whitespace-nowrap"
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
