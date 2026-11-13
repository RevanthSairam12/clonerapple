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

const LEGAL_BUSINESS_NAME = 'RUPEEDO TECHNOLOGIES';
const UDYAM_MSME_NUMBER = 'UDYAM-AP-12-0109134';
const BUSINESS_ADDRESS =
  'SAI NIVAS, MOGALTUR, MASJID STREET, MOGALTHUR, AP, WESTGODAVARI, 534281';
const SUPPORT_EMAIL = 'support@gadzio.co.in';
const SUPPORT_PHONE = '+916304859367';

export async function generateMetadata(): Promise<Metadata> {
  const [{ page }, seo] = await Promise.all([
    readStorePageAndContact('company-information'),
    readSeoPageOverride('company-information'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Company Information - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Legal business details, UDYAM MSME registration, registered business address, and customer support contact for RUPEEDO TECHNOLOGIES (Gadzio).',
  };
}

export default async function CompanyInformationPage() {
  const { page, contact } = await readStorePageAndContact('company-information');
  const title = page?.title || 'Company Information';
  const lastUpdated = page?.updatedAt || 'November 2026';
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
              Company Information
            </li>
          </ol>
        </nav>

        <article className="mx-auto max-w-3xl rounded-3xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-[#e5e5ea] pb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-[15px] text-[#333336]">
              Official legal entity, registration, principal business address, and customer support
              contact details for Gadzio.
            </p>
            <p className="mt-2 text-xs text-[#6e6e73]">Last updated: {lastUpdated}</p>
          </header>

          {customSections.length > 0 ? (
            <div className="mt-8 space-y-6 rounded-2xl border border-black/10 bg-[#fbfbfd] p-6 text-[15px] leading-relaxed text-[#333336]">
              {customSections.map((section, idx) => (
                <section key={idx} className="space-y-2">
                  {section.heading && (
                    <h2 className="text-xl font-bold text-[#1d1d1f]">{section.heading}</h2>
                  )}
                  {section.paragraphs.map((p, pIdx) => (
                    <p key={pIdx}>{p}</p>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              <section className="rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
                <h2 className="text-xl font-bold text-[#1d1d1f]">Legal Business Details</h2>
                <dl className="mt-4 divide-y divide-[#e5e5ea] text-[15px]">
                  <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                    <dt className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                      Legal Business Name
                    </dt>
                    <dd className="font-semibold text-[#1d1d1f] sm:col-span-2">
                      {LEGAL_BUSINESS_NAME}
                    </dd>
                  </div>
                  <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                    <dt className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                      Storefront Brand
                    </dt>
                    <dd className="font-semibold text-[#1d1d1f] sm:col-span-2">
                      {contact.tradeName || 'Gadzio'}
                    </dd>
                  </div>
                  <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                    <dt className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                      UDYAM MSME Number
                    </dt>
                    <dd className="font-semibold text-[#1d1d1f] sm:col-span-2">
                      {UDYAM_MSME_NUMBER}
                    </dd>
                  </div>
                  <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                    <dt className="text-xs font-bold uppercase tracking-wider text-[#6e6e73]">
                      Registered / Principal Business Address
                    </dt>
                    <dd className="leading-relaxed font-medium text-[#1d1d1f] sm:col-span-2">
                      {BUSINESS_ADDRESS}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-black/10 bg-[#1d1d1f] p-6 text-white">
                <h2 className="text-lg font-bold">Customer Support Contact</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                      Customer Support Email
                    </p>
                    <p className="mt-1 text-sm font-semibold break-all">
                      <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        className="text-white underline decoration-white/30 underline-offset-4 hover:text-[#ffe100] hover:decoration-[#ffe100]"
                      >
                        {SUPPORT_EMAIL}
                      </a>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                      Customer Support Phone
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      <a
                        href={`tel:${SUPPORT_PHONE}`}
                        className="text-white underline decoration-white/30 underline-offset-4 hover:text-[#ffe100] hover:decoration-[#ffe100]"
                      >
                        {SUPPORT_PHONE}
                      </a>
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#ffea33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Email {SUPPORT_EMAIL}
            </a>
            <a
              href={`tel:${SUPPORT_PHONE}`}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Call {SUPPORT_PHONE}
            </a>
            <Link
              href="/support"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Gadzio Support
            </Link>
          </div>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e5ea] pt-6 text-xs text-[#6e6e73]">
            <span>© 2026 {LEGAL_BUSINESS_NAME}. All rights reserved.</span>
            <div className="flex flex-wrap gap-4 font-semibold text-[#1d1d1f]">
              <Link href="/shipping-policy" className="hover:underline">
                Shipping Policy
              </Link>
              <Link href="/return-refund" className="hover:underline">
                Return &amp; Refund Policy
              </Link>
              <Link href="/privacy" className="hover:underline">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:underline">
                Terms &amp; Conditions
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

