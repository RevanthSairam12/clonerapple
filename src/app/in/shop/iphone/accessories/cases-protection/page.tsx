import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CasesProtectionPage } from '@/components/sites/cases-protection/CasesProtectionPage';
import type { CasesProtectionOverrides } from '@/components/sites/cases-protection/CasesProtectionPage';
import { getContent, getContentMany } from '@/lib/content';
import { getCasesCategoryView } from '@/lib/storefront/catalog';
import { siteOpenGraphUrl } from '@/lib/storefront/metadata';
import { readSaleState } from '@/lib/storefront/sale-state';

import './cases.css';

/** Catalogue edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const baseMetadata: Metadata = {
  title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
  description:
    'Shop Gadzio protective cases for iPhone. Find MagSafe liquid silicone cases, crystal clear cases, and AeroWeave technical textile cases with military-grade drop defense.',
  openGraph: {
    title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
    description: 'Shop Gadzio drop-tested protective cases for iPhone.',
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
  const url = siteOpenGraphUrl('/in/shop/iphone/accessories/cases-protection');
  return {
    ...baseMetadata,
    title: seo.title ?? baseMetadata.title,
    description: seo.description ?? baseMetadata.description,
    openGraph: {
      ...baseMetadata.openGraph,
      ...(url ? { url } : {}),
      title: seo.title ?? 'Cases & Protection - iPhone Accessories | Gadzio Store',
      description: seo.description ?? baseMetadata.openGraph?.description,
    },
  };
}

export default async function Page() {
  // Page furniture only. The product grid is never read from content_blocks:
  // products live in the `products` table and are edited in store admin.
  const [view, sale, c] = await Promise.all([
    getCasesCategoryView(),
    readSaleState(),
    getContentMany({
      categoryLinks: ['cases.category_links', {}],
      header: ['cases.page_header', {}],
    }),
  ]);
  if (!view) notFound();

  const overrides: CasesProtectionOverrides = {
    categoryLinks: (c.categoryLinks as { items?: CasesProtectionOverrides['categoryLinks'] })?.items,
    header: c.header as CasesProtectionOverrides['header'],
  };

  return (
    <CasesProtectionPage
      config={view.config}
      products={view.products}
      overrides={overrides}
      saleLive={sale.live}
    />
  );
}