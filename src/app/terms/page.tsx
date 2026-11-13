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
    title: page?.seoTitle || seo?.metaTitle || 'Terms & Conditions - Gadzio',
    description:
      page?.seoDescription ||
      seo?.metaDescription ||
      'Review the Terms and Conditions governing your use of the Gadzio website and purchases of smartphone accessories.',
  };
}

export default async function TermsPage() {
  const { page, contact } = await readStorePageAndContact('terms');
  const title = page?.title || 'Gadzio Terms & Conditions';
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
                <p>
                  Please read these Terms and Conditions carefully before using our ecommerce
                  website (&quot;Website&quot;) and purchasing smartphone accessories
                  (&quot;Products&quot;) from us. By accessing or using the Website and purchasing
                  Products, you agree to be bound by these Terms and Conditions. If you do not
                  agree with any part of these Terms and Conditions, please do not use the Website
                  or purchase Products from us.
                </p>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">1. General Terms</h2>
                  <div className="space-y-3">
                    <p>
                      <strong>a.</strong> The Website and Products are provided on an &quot;as
                      is&quot; and &quot;as available&quot; basis. We make no representations or
                      warranties of any kind, express or implied, regarding the accuracy,
                      reliability, or completeness of the information or content on the Website or
                      the suitability or quality of the Products for any particular purpose.
                    </p>
                    <p>
                      <strong>b.</strong> We reserve the right to modify, suspend, or discontinue
                      any part of the Website or the availability of the Products at any time
                      without prior notice.
                    </p>
                    <p>
                      <strong>c.</strong> We do not guarantee that the Website will be
                      uninterrupted, error-free, or free from viruses or other harmful components.
                    </p>
                    <p>
                      <strong>d.</strong> We reserve the right to refuse service, terminate
                      accounts, or cancel orders at our discretion if we believe the customer has
                      violated these Terms and Conditions or applicable laws.
                    </p>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    2. Product Descriptions and Pricing
                  </h2>
                  <div className="space-y-3">
                    <p>
                      <strong>a.</strong> We strive to provide accurate and up-to-date information
                      regarding our Products, including descriptions, images, and pricing. However,
                      we do not warrant that the information is error-free, complete, or current.
                    </p>
                    <p>
                      <strong>b.</strong> We reserve the right to correct any errors, inaccuracies,
                      or omissions, and to change or update information or cancel orders if any
                      information on the Website is inaccurate at any time without prior notice.
                    </p>
                    <p>
                      <strong>c.</strong> Prices are subject to change without notice, and any such
                      changes will not affect orders already placed.
                    </p>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    3. Ordering and Payment
                  </h2>
                  <div className="space-y-3">
                    <p>
                      <strong>a.</strong> By placing an order, you confirm that you are authorized
                      to use the payment method provided and that all information you provide is
                      accurate and complete.
                    </p>
                    <p>
                      <strong>b.</strong> We reserve the right to limit the quantities of Products
                      available for purchase and to refuse or cancel any order placed with us.
                    </p>
                    <p>
                      <strong>c.</strong> Payment must be made in full at the time of ordering. We
                      accept various payment methods as specified on the Website.
                    </p>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    4. Limitation of Liability
                  </h2>
                  <div className="space-y-3">
                    <p>
                      <strong>a.</strong> In no event shall we, our officers, directors, employees,
                      agents, or affiliates be liable to you or any third party for any direct,
                      indirect, incidental, consequential, special, or exemplary damages, including
                      but not limited to, damages for loss of profits, goodwill, data, or other
                      intangible losses, arising out of or in connection with your use of the
                      Website or the purchase or use of the Products.
                    </p>
                    <p>
                      <strong>b.</strong> To the maximum extent permitted by applicable law, our
                      total liability to you for any claim arising out of or relating to these
                      Terms and Conditions, the Website, or the Products shall not exceed the total
                      amount paid by you for the Products in question.
                    </p>
                    <p>
                      <strong>c.</strong> We shall not be liable for any delay or failure in
                      performance resulting from acts beyond our control, including but not limited
                      to acts of God, natural disasters, power outages, strikes, or governmental
                      actions.
                    </p>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">5. Indemnification</h2>
                  <p>
                    You agree to indemnify, defend, and hold harmless our company, its officers,
                    directors, employees, agents, and affiliates from any claims, liabilities,
                    damages, costs, or expenses (including reasonable attorneys&apos; fees) arising
                    out of or in connection with your use of the Website or the purchase or use of
                    the Products, your violation of these Terms and Conditions, or your violation of
                    any rights of a third party.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">
                    6. Governing Law and Jurisdiction
                  </h2>
                  <p>
                    These Terms and Conditions shall be governed by the laws of India. Any disputes
                    arising out of or in connection with these Terms and Conditions shall be
                    subject to the jurisdiction of the competent courts in India.
                  </p>
                </section>

                <section id="warranty" className="scroll-mt-28 space-y-3">
                  <h2 className="text-xl font-semibold text-[#1d1d1f]">7. Warranty Policy</h2>
                  <p>
                    We do not provide any seller or store warranty of our own on Products. Warranty
                    is strictly subject to the individual Product — where applicable, warranty is
                    officially provided directly by the respective brand (some Products carry
                    official brand warranty, while others may not include any warranty). All
                    warranty claims must be directed to the respective brand under its official
                    warranty terms.
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
