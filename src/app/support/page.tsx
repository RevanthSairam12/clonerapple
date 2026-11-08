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
      'Get help with your Gadzio order — shipping, returns, payments, product support, and how to reach us.',
  };
}

interface Action {
  label: string;
  href: string;
  primary?: boolean;
}

function SupportSection({
  id,
  title,
  children,
  actions,
}: {
  id: string;
  title: string;
  children: ReactNode;
  actions: Action[];
}) {
  return (
    <section id={id} className="scroll-mt-28 rounded-2xl border border-black/10 bg-[#fbfbfd] p-6">
      <h2 className="text-xl font-bold text-[#1d1d1f]">{title}</h2>
      <div className="mt-3 text-[15px] leading-relaxed text-[#333336]">{children}</div>
      <div className="mt-4 flex flex-wrap gap-3">
        {actions.map((action) => (
          <Link
            key={`${action.label}|${action.href}`}
            href={action.href}
            className={
              action.primary
                ? 'inline-flex min-h-10 items-center justify-center rounded-xl bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#ffea33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black'
                : 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1d1d1f] transition hover:bg-[#e8eaee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black'
            }
          >
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function SupportPage() {
  const { page, contact } = await readStorePageAndContact('support');
  const title = page?.title || 'Gadzio Support';
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
              Support
            </li>
          </ol>
        </nav>

        <article className="mx-auto max-w-4xl rounded-3xl border border-black/10 bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-[#e5e5ea] pb-6">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-[15px] text-[#333336]">
              How can we help? Pick a topic below — every link goes to a real page you can act on
              right now.
            </p>
            <p className="mt-2 text-xs text-[#6e6e73]">Last updated: {lastUpdated}</p>
          </header>

          {/* Store Contact Details from Settings -> Business */}
          <section
            aria-label="Store contact details"
            className="mt-8 grid gap-4 rounded-2xl border border-black/10 bg-[#1d1d1f] p-6 text-white sm:grid-cols-3"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                Support Email
              </p>
              <p className="mt-1 text-sm font-semibold break-all">{contact.email}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                Support Phone
              </p>
              <p className="mt-1 text-sm font-semibold">{contact.phone}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">
                Order Self-Service
              </p>
              <p className="mt-1 text-sm">
                <Link
                  href="/account/orders"
                  className="font-bold text-[#ffe100] underline underline-offset-4"
                >
                  Track or manage orders →
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
              id="order-help"
              title="Order Help"
              actions={[
                { label: 'Your Orders & Requests', href: '/account/orders', primary: true },
                { label: 'Sign in to your account', href: '/auth' },
                { label: 'View your bag', href: '/bag' },
              ]}
            >
              <p>
                After checkout you&apos;ll see an on-screen confirmation with your payment
                reference, and you can review everything in your bag before you place an order.
                Sign in with the account you used at checkout to manage orders, request a
                cancellation before dispatch, or open a return after delivery. If a payment failed
                or was cancelled, you can retry from{' '}
                <Link href="/checkout" className="font-semibold underline underline-offset-4">
                  checkout
                </Link>
                .
              </p>
            </SupportSection>

            <SupportSection
              id="shipping"
              title="Shipping & Delivery"
              actions={[{ label: 'Read the Terms of Use', href: '/terms' }]}
            >
              <p>
                We deliver online orders across India, with standard dispatch within 24–48 hours.
                Shipping rates and any free-shipping threshold are shown clearly in your bag and at
                checkout before you pay.
              </p>
            </SupportSection>

            <SupportSection
              id="returns"
              title="Returns & Refunds"
              actions={[
                { label: 'Open a return request', href: '/account/orders', primary: true },
                { label: 'Warranty & return terms', href: '/terms' },
              ]}
            >
              <p>
                Eligible delivered orders can be returned within the return window from your{' '}
                <Link href="/account/orders" className="font-semibold underline underline-offset-4">
                  account orders page
                </Link>
                . All cases, chargers, and protection accessories carry a 1-Year Limited
                Replacement Guarantee covering manufacturing defects.
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
                Each product page lists compatible phone models, materials, and specifications. You
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
              id="payments"
              title="Payment Help"
              actions={[{ label: 'Go to checkout', href: '/checkout' }]}
            >
              <p>
                Online payments are processed with 256-bit SSL encryption supporting UPI, credit
                and debit cards, and NetBanking. If a payment was debited while your browser tab
                closed, our automatic reconciliation verifies the transaction and updates your
                order status.
              </p>
            </SupportSection>

            <SupportSection
              id="contact"
              title="Contact Gadzio"
              actions={[
                { label: 'Your Account', href: '/account', primary: true },
                { label: 'Privacy Policy', href: '/privacy' },
              ]}
            >
              <p>
                Email us at <strong>{contact.email}</strong> or call{' '}
                <strong>{contact.phone}</strong>. Account and order requests can also be submitted
                directly from your Gadzio account.
              </p>
            </SupportSection>
          </div>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e5ea] pt-6 text-xs text-[#6e6e73]">
            <Link href="/" className="font-semibold text-[#1d1d1f] hover:underline">
              ← Back to the Gadzio store
            </Link>
            <div className="flex flex-wrap gap-4 font-semibold text-[#1d1d1f]">
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
