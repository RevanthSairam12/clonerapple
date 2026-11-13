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
    readStorePageAndContact('return-refund'),
    readSeoPageOverride('return-refund'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Return & Refund Policy - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Review Gadzio Return, Replacement & Refund Policy — sale exclusions, 24-hour damaged/defective replacement unboxing video rules, and unopened parcel return terms.',
  };
}

export default async function ReturnRefundPage() {
  const { page, contact } = await readStorePageAndContact('return-refund');
  const title = page?.title || 'Return & Refund Policy';
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
              Return &amp; Refund Policy
            </li>
          </ol>
        </nav>

        <article className="mx-auto max-w-4xl rounded-3xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-[#e5e5ea] pb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-[15px] text-[#333336]">
              Please read our replacement, return, and refund terms carefully before placing an
              order.
            </p>
            <p className="mt-2 text-xs text-[#6e6e73]">Last updated: {lastUpdated}</p>
          </header>

          {/* Direct Support Contact Bar */}
          <section
            aria-label="Replacement and return support contact"
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
                Claim Window
              </p>
              <p className="mt-1 text-sm font-bold text-[#ffe100]">
                Within 24 hours of delivery
              </p>
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
                <h2 className="text-xl font-bold text-[#1d1d1f]">1. No Returns or Refunds</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-[#333336]">
                  <li>
                    Orders placed during any <strong>Sale, Offer, or Discount Campaign</strong> are
                    not eligible for return or refund.
                  </li>
                  <li>
                    We do <strong>not</strong> offer full refunds under any circumstances once the
                    order is confirmed.
                  </li>
                </ul>
              </section>

              <section className="rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold text-[#1d1d1f]">2. Replacement Policy</h2>
                  <span className="rounded-full bg-[#1d1d1f] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                    Damaged or Defective Only
                  </span>
                </div>
                <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-[#333336]">
                  <p>
                    We offer <strong>replacements only</strong> under the following conditions: if
                    the product received is <strong>damaged or defective</strong> (not working).
                  </p>

                  <div className="rounded-xl border border-black/10 bg-white p-4">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-[#1d1d1f]">
                      How to Claim a Replacement (Within 24 Hours)
                    </h3>
                    <p className="mt-2 text-sm text-[#333336]">
                      To claim a replacement for a damaged or defective product, connect with our
                      team at{' '}
                      <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        className="font-semibold text-[#1d1d1f] underline underline-offset-4"
                      >
                        {SUPPORT_EMAIL}
                      </a>{' '}
                      or{' '}
                      <a
                        href={`tel:${SUPPORT_PHONE}`}
                        className="font-semibold text-[#1d1d1f] underline underline-offset-4"
                      >
                        {SUPPORT_PHONE}
                      </a>{' '}
                      <strong>within 24 hours of delivery</strong> with an unboxing video clearly
                      showing all of the following:
                    </p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#1d1d1f]">
                      <li>
                        <strong>Continuous, unedited video:</strong> One continuous recording from
                        start to finish with <strong>no cuts or edits</strong>.
                      </li>
                      <li>
                        <strong>Clear packaging view:</strong> The outer parcel packing clearly
                        shown before opening.
                      </li>
                      <li>
                        <strong>Clear product seal:</strong> The seal of the product (if the
                        product is sealed) clearly shown intact before opening.
                      </li>
                      <li>
                        <strong>Serial number on the box:</strong> The serial number printed on the
                        box clearly visible.
                      </li>
                      <li>
                        <strong>Issue demonstrated:</strong> The physical damage or defective /
                        non-working condition clearly shown within the same continuous video.
                      </li>
                    </ul>
                  </div>

                  <p className="text-xs text-[#6e6e73]">
                    Replacement claims submitted after 24 hours of delivery or without a
                    continuous, unedited unboxing video showing the packing, seal (if sealed), and
                    serial number on the box cannot be approved.
                  </p>
                </div>
              </section>

              <section className="rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold text-[#1d1d1f]">
                    3. Return &amp; Refund Policy (After Delivery)
                  </h2>
                  <span className="rounded-full border border-black/15 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1d1d1f]">
                    Unopened Parcel Only
                  </span>
                </div>
                <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[#333336]">
                  <p>
                    If you wish to return the product after delivery{' '}
                    <strong>without opening the parcel</strong>:
                  </p>
                  <ul className="list-disc space-y-2 pl-5 text-[#1d1d1f]">
                    <li>
                      A <strong>50% amount deduction</strong> will be applied.
                    </li>
                    <li>
                      The refund will be processed{' '}
                      <strong>only after we receive the parcel back in original condition</strong>{' '}
                      (with the <strong>transparent sealed paper</strong> intact).
                    </li>
                    <li>
                      If the parcel is <strong>opened</strong>,{' '}
                      <strong>no replacement or refund</strong> will be provided (outside eligible
                      damaged or defective replacements under Section 2).
                    </li>
                    <li>
                      <strong>Return shipping charges</strong> will be borne by the customer.
                    </li>
                  </ul>
                </div>
              </section>

              <section className="rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
                <h2 className="text-xl font-bold text-[#1d1d1f]">
                  4. Non-Replaceable / Non-Returnable Items
                </h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-[#333336]">
                  <li>
                    Products purchased under any <strong>Sale, Discount, or Offer</strong>.
                  </li>
                  <li>
                    Products that have been <strong>used, unsealed, or tampered with</strong> after
                    delivery.
                  </li>
                </ul>
              </section>

              <section id="warranty" className="scroll-mt-28 rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-bold text-[#1d1d1f]">5. Warranty Policy</h2>
                  <span className="rounded-full border border-black/15 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1d1d1f]">
                    Brand Warranty Only
                  </span>
                </div>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-[#333336]">
                  <li>
                    <strong>We do not provide any Gadzio/seller warranty</strong> on products sold
                    on the store.
                  </li>
                  <li>
                    Warranty availability is <strong>subject to the specific product</strong>. If a
                    product carries a warranty, it is{' '}
                    <strong>officially provided directly by the respective brand</strong> (some
                    products come with official brand warranty, while others do not).
                  </li>
                  <li>
                    Any eligible warranty service or claim must be handled directly with the
                    respective brand or its authorized service center under the brand&apos;s terms.
                  </li>
                </ul>
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
              <Link href="/support" className="hover:underline">
                Support
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

