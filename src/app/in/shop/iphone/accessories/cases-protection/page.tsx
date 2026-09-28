import type { Metadata } from 'next';

import { CasesProtectionPage } from '@/components/sites/cases-protection/CasesProtectionPage';
import type { CasesProtectionOverrides } from '@/components/sites/cases-protection/CasesProtectionPage';
import { getContent, getContentMany } from '@/lib/content';

import './cases.css';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const metadata: Metadata = {
  title: 'Cases & Protection - iPhone Accessories - Apple (IN)',
  description:
    'Shop iPhone cases and protection from Apple. Find MagSafe cases, silicone cases, clear cases, FineWoven cases and more for iPhone 17, iPhone 17 Pro, iPhone 16 and more.',
  openGraph: {
    title: 'Cases & Protection - iPhone Accessories - Apple (IN)',
    description: 'Shop iPhone cases from Apple India.',
    url: 'https://www.apple.com/in/shop/iphone/accessories/cases-protection',
    siteName: 'Apple',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico',
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getContent<{ title?: string; description?: string }>('cases.seo', {});
  return {
    ...metadata,
    title: seo.title ?? metadata.title,
    description: seo.description ?? metadata.description,
    openGraph: {
      ...metadata.openGraph,
      title: seo.title ?? 'Cases & Protection - iPhone Accessories - Apple (IN)',
      description: seo.description ?? metadata.openGraph?.description,
    },
  };
}

export default async function Page() {
  const c = await getContentMany({
    categoryLinks: ['cases.category_links', {}],
    header: ['cases.page_header', {}],
    products: ['cases.products', {}],
  });

  const overrides: CasesProtectionOverrides = {
    categoryLinks: (c.categoryLinks as { items?: CasesProtectionOverrides['categoryLinks'] }).items,
    header: c.header as CasesProtectionOverrides['header'],
    products: (c.products as { items?: CasesProtectionOverrides['products'] }).items,
  };

  return <CasesProtectionPage overrides={overrides} />;
}
