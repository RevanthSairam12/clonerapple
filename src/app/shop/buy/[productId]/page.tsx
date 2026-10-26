import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { getProductDetail } from '@/lib/storefront/catalog';

interface Props {
  params: Promise<{ productId: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail || detail.kind !== 'case') {
    return { title: 'Product Not Found | Gadzio Store' };
  }

  const product = detail.product;
  return {
    title: `Buy ${product.name} | Gadzio Store`,
    description: product.description,
    openGraph: {
      title: `Buy ${product.name} | Gadzio Store`,
      description: product.description,
      images: [product.image],
    },
  };
}

export default async function BuyPage({ params }: Props) {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  // This route has always sold the bespoke case range only.
  if (!detail || detail.kind !== 'case') {
    notFound();
  }

  return <ProductDetailPage product={detail.product} />;
}
