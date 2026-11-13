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

const SUPPORT_EMAIL = 'support@gadzio.co.in';
const SUPPORT_PHONE = '+916304859367';

export async function generateMetadata(): Promise<Metadata> {
  const [{ page }, seo] = await Promise.all([
    readStorePageAndContact('shipping-policy'),
    readSeoPageOverride('shipping-policy'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Shipping Policy - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Review Gadzio Shipping Policy — domestic delivery timelines (5-7 business days) and order-amount based shipping charges.',
  };
}

export default async function ShippingPolicyPage() {
  const { page, contact } = await readStorePageAndContact('shipping-policy');
  const title = page?.title || 'Shipping Policy';
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
            <li>
              <Link href="/support" className="hover:text-[#1d1d1f] hover:underline">
                Support
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-[#1d1d1f]" aria-current="page">
              Shipping Policy
            </li>
          </ol>
        </nav>

        <article className="mx-auto max-w-4xl rounded-3xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-[#e5e5ea] pb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-[15px] text-[#333336]">
              Clear information on domestic delivery timelines and how shipping charges are
              calculated on Gadzio.
            </p>
            <p className="mt-2 text-xs text-[#6e6e73]">Last updated: {lastUpdated}</p>
          </header>

          {/* Direct Support Contact Bar */}
          <section
            aria-label="Shipping support contact"
            className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-[#1d1d1f] p-6 text-white sm:grid-cols-3"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                Support Email
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
                Mobile Number
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
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                Estimated Delivery
              </p>
              <p className="mt-1 text-sm font-bold text-[#ffe100]">5–7 business days</p>
            </div>
          </section>

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
                <h2 className="text-xl font-bold text-[#1d1d1f]">
                  How long will it take for my order to be delivered?
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-[#333336]">
                  Domestic orders are typically delivered in <strong>5–7 business days</strong>,
                  but delivery times may be influenced by external or internal factors and are
                  subject to change.
                </p>
              </section>

              <section className="rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold text-[#1d1d1f]">
                    What is the price for the shipping?
                  </h2>
                  <span className="rounded-full bg-[#1d1d1f] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                    Order-Amount Based
                  </span>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-[#333336]">
                  <strong>We do not offer free shipping.</strong> Shipping charges are calculated{' '}
                  <strong>based on your order amount</strong> and are shown clearly in your
                  shopping bag and at checkout before you complete payment.
                </p>
              </section>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/bag"
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#ffea33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              View your bag
            </Link>
            <Link
              href="/account/orders"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Your Orders
            </Link>
            <Link
              href="/support"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Back to Support
            </Link>
          </div>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e5ea] pt-6 text-xs text-[#6e6e73]">
            <Link href="/" className="font-semibold text-[#1d1d1f] hover:underline">
              ← Back to the Gadzio store
            </Link>
            <div className="flex flex-wrap gap-4 font-semibold text-[#1d1d1f]">
              <Link href="/return-refund" className="hover:underline">
                Return &amp; Refund Policy
              </Link>
              <Link href="/company-information" className="hover:underline">
                Company Information
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

