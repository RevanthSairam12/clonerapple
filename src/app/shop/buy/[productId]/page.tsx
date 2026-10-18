import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductById } from '@/components/sites/cases-protection/data/products';
import { ProductDetailPage } from '@/components/shop/ProductDetailPage';

interface Props {
  params: Promise<{ productId: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const product = getProductById(productId);

  if (!product) {
    return { title: 'Product Not Found | Gadzio Store' };
  }

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
  const product = getProductById(productId);

  if (!product) {
    notFound();
  }

  return <ProductDetailPage product={product} />;
}
