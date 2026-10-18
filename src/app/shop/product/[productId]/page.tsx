import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { AccessoryDetailPage } from '@/components/sites/accessories/AccessoryDetailPage';
import { getCaseProductById, getAccessoryProductById } from '@/lib/products/registry';

interface Props {
  params: Promise<{ productId: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const product = getCaseProductById(productId) ?? getAccessoryProductById(productId);

  if (!product) {
    return {
      title: 'Product Not Found | Gadzio Store',
    };
  }

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

  // Original iPhone cases keep their polished, bespoke detail page.
  const caseProduct = getCaseProductById(productId);
  if (caseProduct) {
    return <ProductDetailPage product={caseProduct} />;
  }

  // Every other accessory category renders the generic, data-driven page.
  const accessoryProduct = getAccessoryProductById(productId);
  if (accessoryProduct) {
    return <AccessoryDetailPage product={accessoryProduct} />;
  }

  notFound();
}
