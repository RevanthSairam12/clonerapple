import type { Metadata } from 'next';

import { CasesProtectionPage } from '@/components/sites/cases-protection/CasesProtectionPage';
import type { CasesProtectionOverrides } from '@/components/sites/cases-protection/CasesProtectionPage';
import { getContent, getContentMany } from '@/lib/content';

import './cases.css';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const metadata: Metadata = {
  title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
  description:
    'Shop Gadzio protective cases for iPhone. Find MagSafe liquid silicone cases, crystal clear cases, and AeroWeave technical textile cases with military-grade drop defense.',
  openGraph: {
    title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
    description: 'Shop Gadzio drop-tested protective cases for iPhone.',
    url: 'https://gadzio.in/in/shop/iphone/accessories/cases-protection',
    siteName: 'Gadzio',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/gadzio_logo.png',
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
      title: seo.title ?? 'Cases & Protection - iPhone Accessories | Gadzio Store',
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
