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
    readStorePageAndContact('privacy'),
    readSeoPageOverride('privacy'),
  ]);
  return {
    title: page?.seoTitle || seo?.metaTitle || 'Privacy Policy - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Learn how Gadzio collects, uses, secures, and lets you control your personal information and cookies.',
  };
}

export default async function PrivacyPage() {
  const { page, contact } = await readStorePageAndContact('privacy');
  const title = page?.title || 'Gadzio Privacy Policy';
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
                    What we do with the information we gather
                  </h2>
                  <p>
                    We use this information to enhance our service and meet your needs.
                    Specifically, we utilize it for the following purposes:
                  </p>
                  <ul className="list-disc space-y-2 pl-5">
                    <li>Internal record keeping.</li>
                    <li>Enhancing our products and services.</li>
                    <li>
                      Sending promotional emails regarding new products, special offers, or other
                      relevant information to the email address you have provided.
                    </li>
                    <li>
                      Conducting market research and contacting you for such purposes via email,
                      phone, fax, or mail.
                    </li>
                    <li>Customizing the website based on your interests.</li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">Security</h2>
                  <p>
                    We prioritize the security of your information. To prevent unauthorized access
                    or disclosure, we have implemented appropriate physical, electronic, and
                    managerial measures to safeguard and secure the online information we collect.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">How we use cookies</h2>
                  <p>
                    A cookie is a small file that is placed on your computer&apos;s hard drive with
                    your permission. It helps analyze web traffic and provides personalized
                    experiences by remembering your preferences. We use traffic log cookies to
                    identify popular pages, analyze data for statistical purposes, and improve our
                    website based on customer needs. Cookies do not give us access to your computer
                    or personal information, except for the data you choose to share with us. You
                    can choose to accept or decline cookies, though declining them may limit your
                    website experience.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    Controlling your personal information
                  </h2>
                  <p>
                    You have the option to control the collection and use of your personal
                    information in the following ways:
                  </p>
                  <ul className="list-disc space-y-2 pl-5">
                    <li>
                      When filling out a form on our website, look for the checkbox that allows you
                      to indicate your preference for not using the information for direct marketing
                      purposes.
                    </li>
                    <li>
                      If you previously consented to the use of your personal information for direct
                      marketing purposes but have changed your mind, you can update your
                      preferences in your{' '}
                      <Link
                        href="/account/preferences"
                        className="font-semibold text-[#1d1d1f] underline underline-offset-4"
                      >
                        dashboard
                      </Link>
                      .
                    </li>
                    <li>
                      We will not sell, distribute, or lease your personal information to third
                      parties unless we have your permission or are required to do so by law. If
                      you would like to receive promotional information about third parties, you can
                      let us know and we will consider your request.
                    </li>
                    <li>
                      If you believe that the personal information we have about you is incorrect or
                      incomplete, please contact us promptly at{' '}
                      <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        className="font-semibold text-[#1d1d1f] underline underline-offset-4"
                      >
                        {SUPPORT_EMAIL}
                      </a>
                      . We will make every effort to promptly correct any inaccuracies found in the
                      information we hold.
                    </li>
                  </ul>
                </section>
              </>
            )}

            <section className="rounded-2xl border border-black/10 bg-[#e8eaee]/40 p-5 text-sm">
              <h2 className="font-semibold text-[#1d1d1f]">Privacy &amp; Support Contact</h2>
              <p className="mt-1 text-[#333336]">
                Questions about your data? Reach {contact.tradeName} at{' '}
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
                </a>
                , or manage your data in{' '}
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
              <Link href="/shipping-policy" className="hover:underline">
                Shipping Policy
              </Link>
              <Link href="/return-refund" className="hover:underline">
                Return &amp; Refund Policy
              </Link>
              <Link href="/company-information" className="hover:underline">
                Company Information
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
