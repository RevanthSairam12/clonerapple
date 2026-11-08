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
    readStorePageAndContact('privacy'),
    readSeoPageOverride('privacy'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Privacy Policy - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Learn how Gadzio protects your privacy and personal data.',
  };
}

export default async function PrivacyPage() {
  const { page, contact } = await readStorePageAndContact('privacy');
  const title = page?.title || 'Gadzio Privacy Policy';
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
              Privacy Policy
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
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">Your Privacy Matters</h2>
                  <p>
                    At Gadzio, we treat any information that relates to an identified or
                    identifiable individual as personal data. This policy explains what we collect
                    when you shop with us, why we collect it, and the choices you have.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    Personal Data We Collect from You
                  </h2>
                  <p>
                    When you create a Gadzio account, sign in, or place an order, we collect
                    information such as your name, email address, phone number, delivery address,
                    and payment reference so we can provide a secure and reliable shopping
                    experience.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    How We Use Personal Data
                  </h2>
                  <p>
                    Gadzio uses personal data to process your orders, deliver your purchases,
                    provide customer support, prevent fraud, and comply with law. We do not sell
                    your personal data.
                  </p>
                </section>
              </>
            )}

            <section className="rounded-2xl border border-black/10 bg-[#e8eaee]/40 p-5 text-sm">
              <h2 className="font-semibold text-[#1d1d1f]">Privacy &amp; Support Contact</h2>
              <p className="mt-1 text-[#333336]">
                Questions about your data? Reach {contact.tradeName} at{' '}
                <span className="font-semibold">{contact.email}</span> or{' '}
                <span className="font-semibold">{contact.phone}</span>, or manage your data in{' '}
                <Link href="/account/data" className="font-semibold underline underline-offset-4">
                  Your Account
                </Link>
                .
              </p>
            </section>
          </div>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e5ea] pt-6 text-xs text-[#6e6e73]">
            <span>© 2026 {contact.tradeName}. All rights reserved.</span>
            <div className="flex flex-wrap gap-4 font-semibold text-[#1d1d1f]">
              <Link href="/terms" className="hover:underline">
                Terms &amp; Conditions
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
