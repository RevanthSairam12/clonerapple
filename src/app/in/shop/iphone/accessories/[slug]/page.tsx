import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AccessoryCategoryPage } from '@/components/sites/accessories/AccessoryCategoryPage';
import { getAccessoryCategoryView } from '@/lib/storefront/catalog';
import { siteOpenGraphUrl } from '@/lib/storefront/metadata';
import { readSaleState } from '@/lib/storefront/sale-state';

import '@/components/sites/accessories/accessory-category.css';

/** Catalogue edits must show without a rebuild. */
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const view = await getAccessoryCategoryView(slug);

  if (!view) {
    return { title: 'Category Not Found | Gadzio Store' };
  }

  const seoTitle = view.config.seo.title || view.config.title;
  const seoDescription = view.config.seo.description || view.config.subhead;
  const ogUrl = siteOpenGraphUrl(`/in/shop/iphone/accessories/${view.config.slug}`);

  return {
    title: seoTitle,
    description: seoDescription,
    openGraph: {
      title: seoTitle,
      description: seoDescription,
      ...(ogUrl ? { url: ogUrl } : {}),
      siteName: 'Gadzio',
      locale: 'en_IN',
      type: 'website',
    },
    icons: { icon: '/gadzio_logo.png' },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const [view, sale] = await Promise.all([
    getAccessoryCategoryView(slug),
    readSaleState(),
  ]);

  if (!view) notFound();

  return (
    <AccessoryCategoryPage
      config={view.config}
      products={view.products}
      saleLive={sale.live}
    />
  );
}
