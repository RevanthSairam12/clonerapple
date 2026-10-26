import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AccessoryCategoryPage } from '@/components/sites/accessories/AccessoryCategoryPage';
import { toAccessoryProduct, toCategoryConfig } from '@/lib/catalog/adapter';
import { getStorefrontCategory } from '@/lib/catalog/storefront';

import '@/components/sites/accessories/accessory-category.css';

/** Catalogue edits must show without a rebuild. */
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getStorefrontCategory(slug);

  if (!category) {
    return { title: 'Category Not Found | Gadzio Store' };
  }

  const seoTitle = category.seo.title || category.title;
  const seoDescription = category.seo.description || category.subhead;

  return {
    title: seoTitle,
    description: seoDescription,
    openGraph: {
      title: seoTitle,
      description: seoDescription,
      url: `https://gadzio.in/in/shop/iphone/accessories/${category.slug}`,
      siteName: 'Gadzio',
      locale: 'en_IN',
      type: 'website',
    },
    icons: { icon: '/gadzio_logo.png' },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const category = await getStorefrontCategory(slug);

  if (!category) notFound();

  const config = toCategoryConfig(category);
  const products = category.products.map(toAccessoryProduct);

  return <AccessoryCategoryPage config={config} products={products} />;
}