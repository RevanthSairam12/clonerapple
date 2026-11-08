import type { Metadata } from 'next';
import Link from 'next/link';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import {
  parseSafePageParagraphs,
  readSeoPageOverride,
  readStorePageAndContact,
} from '@/lib/storefront/site-pages';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [{ page }, seo] = await Promise.all([
    readStorePageAndContact('terms'),
    readSeoPageOverride('terms'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Terms of Use - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Review Gadzio terms and conditions of use.',
  };
}

export default async function TermsPage() {
  const { page, contact } = await readStorePageAndContact('terms');
  const title = page?.title || 'Gadzio Terms & Conditions';
  const lastUpdated = page?.updatedAt || 'September 2026';
  const customSections = page ? parseSafePageParagraphs(page.body) : [];

  return (
    <div
      className="gz-storefront-page min-h-screen bg-[#f5f5f7] text-[#1d1d1f] selection:bg-[#ffe100] selection:text-black"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <GadzioHeader bannerVisible={false} />
      <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs font-semibold text-[#6e6e73]">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:text-[#1d1d1f] hover:underline">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-[#1d1d1f]" aria-current="page">
              Terms &amp; Conditions
            </li>
          </ol>
        </nav>

        <article className="mx-auto max-w-3xl rounded-3xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-[#e5e5ea] pb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-sm text-[#6e6e73]">Last updated: {lastUpdated}</p>
          </header>

          <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-[#333336]">
            {customSections.length > 0 ? (
              customSections.map((section, idx) => (
                <section key={idx} className="space-y-3">
                  {section.heading && (
                    <h2 className="text-xl font-semibold text-[#1d1d1f]">{section.heading}</h2>
                  )}
                  {section.paragraphs.map((p, pIdx) => (
                    <p key={pIdx}>{p}</p>
                  ))}
                </section>
              ))
            ) : (
              <>
                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">1. Acceptance of Terms</h2>
                  <p>
                    By accessing or using Gadzio websites, applications, and services, you agree to
                    comply with and be bound by these Terms and Conditions. If you do not agree to
                    these terms, please do not use our services.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    2. Accounts and Security
                  </h2>
                  <p>
                    You are responsible for maintaining the confidentiality of your account
                    credentials and for all activities that occur under your account. Notify Gadzio
                    immediately of any unauthorized use of your account.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    3. Intellectual Property
                  </h2>
                  <p>
                    All content, graphics, user interfaces, visual interfaces, photographs,
                    trademarks, logos, sounds, music, and computer code on this site are owned by,
                    controlled by, or licensed to Gadzio, and are protected by trade dress,
                    copyright, patent, and trademark laws. Apple, iPhone, iPad, Mac, AirPods, and
                    MagSafe are trademarks of Apple Inc., registered in the U.S. and other
                    countries. Gadzio is an independent retailer of compatible accessories and is
                    not affiliated with, sponsored by, or endorsed by Apple Inc.
                  </p>
                </section>
              </>
            )}
          </div>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e5ea] pt-6 text-xs text-[#6e6e73]">
            <span>© 2026 {contact.tradeName}. All rights reserved.</span>
            <div className="flex flex-wrap gap-4 font-semibold text-[#1d1d1f]">
              <Link href="/privacy" className="hover:underline">
                Privacy Policy
              </Link>
              <Link href="/support" className="hover:underline">
                Support
              </Link>
            </div>
          </footer>
        </article>
      </main>
      <GlobalFooter
        content={
          contact.footerText || contact.cookieNotice
            ? {
                ...(contact.footerText ? { copyright: contact.footerText } : {}),
                ...(contact.cookieNotice ? { footnotesHtml: contact.cookieNotice } : {}),
              }
            : undefined
        }
      />
    </div>
  );
}
