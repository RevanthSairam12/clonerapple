import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
    readStorePageAndContact('support'),
    readSeoPageOverride('support'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Gadzio Support',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Contact Gadzio Support at support@gadzio.co.in or +916304859367. Review order-based shipping charges, replacement eligibility, and our return & refund policy.',
  };
}

interface Action {
  label: string;
  href: string;
  primary?: boolean;
  external?: boolean;
}

function ActionButton({ action }: { action: Action }) {
  const className = action.primary
    ? 'inline-flex min-h-10 items-center justify-center rounded-xl bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#ffea33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black'
    : 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

  if (action.external) {
    return (
      <a href={action.href} className={className}>
        {action.label}
      </a>
    );
  }

  return (
    <Link href={action.href} className={className}>
      {action.label}
    </Link>
  );
}

function SupportSection({
  id,
  title,
  badge,
  children,
  actions,
}: {
  id: string;
  title: string;
  badge?: string;
  children: ReactNode;
  actions: Action[];
}) {
  return (
    <section id={id} className="scroll-mt-28 rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-[#1d1d1f]">{title}</h2>
        {badge && (
          <span className="rounded-full bg-[#1d1d1f] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-3 text-[15px] leading-relaxed text-[#333336]">{children}</div>
      {actions.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-3">
          {actions.map((action) => (
            <ActionButton key={`${action.label}|${action.href}`} action={action} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function SupportPage() {
  const { page, contact } = await readStorePageAndContact('support');
  const title = page?.title || 'Gadzio Support';
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
              Support
            </li>
          </ol>
        </nav>

        <article className="mx-auto max-w-4xl rounded-3xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-[#e5e5ea] pb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-[15px] text-[#333336]">
              Reach our support team directly by email or phone, and review our shipping charges,
              replacement eligibility, and return &amp; refund policy below.
            </p>
            <p className="mt-2 text-xs text-[#6e6e73]">Last updated: {lastUpdated}</p>
          </header>

          {/* Direct Support Contact Details */}
          <section
            aria-label="Store contact details"
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
                Your Orders
              </p>
              <p className="mt-1 text-sm">
                <Link
                  href="/account/orders"
                  className="font-bold text-[#ffe100] underline underline-offset-4"
                >
                  View order status →
                </Link>
              </p>
            </div>
          </section>

          {customSections.length > 0 && (
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
          )}

          <div className="mt-8 space-y-6">
            <SupportSection
              id="shipping"
              title="Shipping Policy"
              badge="5–7 Business Days"
              actions={[
                { label: 'Read Shipping Policy', href: '/shipping-policy', primary: true },
                { label: 'View your bag', href: '/bag' },
                { label: 'Terms & Conditions', href: '/terms' },
              ]}
            >
              <p>
                Domestic orders are typically delivered in <strong>5–7 business days</strong>{' '}
                (subject to internal or external factors). <strong>We do not offer free shipping.</strong>{' '}
                Shipping charges are calculated <strong>based on your order amount</strong> and are
                shown clearly in your shopping bag and at checkout before you complete payment.
              </p>
            </SupportSection>

            <SupportSection
              id="returns"
              title="Return, Replacement & Refund Policy"
              badge="Dedicated Policy Page"
              actions={[
                {
                  label: 'Read Return & Refund Policy',
                  href: '/return-refund',
                  primary: true,
                },
                {
                  label: `Email ${SUPPORT_EMAIL}`,
                  href: `mailto:${SUPPORT_EMAIL}`,
                  external: true,
                },
                {
                  label: `Call ${SUPPORT_PHONE}`,
                  href: `tel:${SUPPORT_PHONE}`,
                  external: true,
                },
              ]}
            >
              <p>
                We do not offer general returns or full refunds once an order is confirmed, and
                sale/offer orders are non-returnable. Replacements are available only for damaged or
                defective items reported within <strong>24 hours of delivery</strong> with a
                continuous, unedited unboxing video. Unopened parcel returns carry a 50% deduction
                with return shipping borne by the customer.
              </p>
            </SupportSection>

            <SupportSection
              id="warranty"
              title="Warranty Policy"
              badge="Brand Warranty Only"
              actions={[
                { label: 'Read Return & Refund Policy', href: '/return-refund', primary: true },
                { label: 'Terms & Conditions', href: '/terms' },
              ]}
            >
              <p>
                <strong>We do not provide any store warranty of our own.</strong> Warranty
                coverage is <strong>subject to the specific product</strong> — if a product includes
                a warranty, it is <strong>officially provided directly by the brand</strong> (some
                products receive official brand warranty directly from the manufacturer, while
                others may not carry a warranty).
              </p>
            </SupportSection>

            <SupportSection
              id="order-help"
              title="Order Help & Tracking"
              actions={[
                { label: 'Your Orders', href: '/account/orders', primary: true },
                { label: 'Sign in to your account', href: '/auth' },
              ]}
            >
              <p>
                Sign in with the account you used at checkout to check your order status, payment
                reference, and delivery updates. If you received a damaged or non-working product,
                keep your order ID ready and contact our team within 24 hours of delivery with your
                unboxing video.
              </p>
            </SupportSection>

            <SupportSection
              id="payments"
              title="Payment Help"
              actions={[{ label: 'Go to checkout', href: '/checkout' }]}
            >
              <p>
                Online payments are processed securely with 256-bit SSL encryption supporting UPI,
                credit and debit cards, and NetBanking. If a payment failed or was interrupted, you
                can retry from{' '}
                <Link href="/checkout" className="font-semibold underline underline-offset-4">
                  checkout
                </Link>{' '}
                or contact us with your payment reference if an amount was debited.
              </p>
            </SupportSection>

            <SupportSection
              id="products"
              title="Product Support"
              actions={[
                {
                  label: 'Cases & Protection',
                  href: '/in/shop/iphone/accessories/cases-protection',
                },
                {
                  label: 'Power Adapters & Cables',
                  href: '/in/shop/iphone/accessories/power-adapter-cable',
                },
                {
                  label: 'Wired Earphones',
                  href: '/in/shop/iphone/accessories/wired-earphones',
                },
              ]}
            >
              <p>
                Each product page lists compatible device models, materials, and specifications. You
                can also{' '}
                <Link href="/search" className="font-semibold underline underline-offset-4">
                  search all products
                </Link>{' '}
                or browse the{' '}
                <Link href="/android" className="font-semibold underline underline-offset-4">
                  Android store
                </Link>
                .
              </p>
            </SupportSection>

            <SupportSection
              id="contact"
              title="Contact Gadzio Support"
              actions={[
                {
                  label: `Email ${SUPPORT_EMAIL}`,
                  href: `mailto:${SUPPORT_EMAIL}`,
                  primary: true,
                  external: true,
                },
                {
                  label: `Call ${SUPPORT_PHONE}`,
                  href: `tel:${SUPPORT_PHONE}`,
                  external: true,
                },
                { label: 'Your Account', href: '/account' },
                { label: 'Privacy Policy', href: '/privacy' },
              ]}
            >
              <p>
                For any order questions, unopened return requests, or to submit a damaged/defective
                replacement claim within 24 hours of delivery, email us at{' '}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="font-bold text-[#1d1d1f] underline underline-offset-4"
                >
                  {SUPPORT_EMAIL}
                </a>{' '}
                or call/message us on{' '}
                <a
                  href={`tel:${SUPPORT_PHONE}`}
                  className="font-bold text-[#1d1d1f] underline underline-offset-4"
                >
                  {SUPPORT_PHONE}
                </a>
                .
              </p>
            </SupportSection>
          </div>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e5ea] pt-6 text-xs text-[#6e6e73]">
            <Link href="/" className="font-semibold text-[#1d1d1f] hover:underline">
              ← Back to the Gadzio store
            </Link>
            <div className="flex flex-wrap gap-4 font-semibold text-[#1d1d1f]">
              <Link href="/shipping-policy" className="hover:underline">
                Shipping Policy
              </Link>
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
