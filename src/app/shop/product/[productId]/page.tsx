import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { AccessoryDetailPage } from '@/components/sites/accessories/AccessoryDetailPage';
import { getProductDetail } from '@/lib/storefront/catalog';

interface Props {
  params: Promise<{ productId: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail) {
    return {
      title: 'Product Not Found | Gadzio Store',
    };
  }

  const product = detail.product;
  return {
    title: `${product.name} | Gadzio Store`,
    description: product.description,
    openGraph: {
      title: `${product.name} | Gadzio Store`,
      description: product.description,
      images: [product.image],
      url: `https://gadzio.in/shop/product/${product.id}`,
      siteName: 'Gadzio',
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail) notFound();

  // Original iPhone cases keep their polished, bespoke detail page.
  if (detail.kind === 'case') {
    return <ProductDetailPage product={detail.product} />;
  }

  // Every other accessory category renders the generic, data-driven page.
  return <AccessoryDetailPage product={detail.product} />;
}
