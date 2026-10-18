import type { Metadata } from 'next';
import { CasesProtectionPage } from '@/components/sites/cases-protection/CasesProtectionPage';
import type { CasesProtectionOverrides } from '@/components/sites/cases-protection/CasesProtectionPage';
import { getContentMany } from '@/lib/content';

import '@/app/in/shop/iphone/accessories/cases-protection/cases.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
  description:
    'Explore premium Gadzio protective cases for iPhone 17, iPhone 17 Pro, iPhone 16, and more. Featuring liquid silicone, anti-yellowing crystal clear, and AeroWeave technical fabric with MagSafe compatibility.',
  openGraph: {
    title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
    description: 'Shop Gadzio drop-tested protective cases for iPhone.',
    url: 'https://gadzio.in/shop/iphone/accessories/cases-protection',
    siteName: 'Gadzio',
    type: 'website',
  },
};

export default async function ShopCasesPage() {
  const c = await getContentMany({
    categoryLinks: ['cases.category_links', {}],
    header: ['cases.page_header', {}],
    products: ['cases.products', {}],
  });

  const overrides: CasesProtectionOverrides = {
    categoryLinks: (c.categoryLinks as { items?: CasesProtectionOverrides['categoryLinks'] })?.items,
    header: c.header as CasesProtectionOverrides['header'],
    products: (c.products as { items?: CasesProtectionOverrides['products'] })?.items,
  };

  return <CasesProtectionPage overrides={overrides} />;
}
