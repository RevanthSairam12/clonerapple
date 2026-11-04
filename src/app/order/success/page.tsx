import { OrderResultPage, type OrderResultPageProps } from '@/components/orders/OrderResultPage';

export const dynamic = 'force-dynamic';

export default async function OrderSuccessPage(props: OrderResultPageProps) {
  return OrderResultPage({ ...props, route: 'success' });
}
