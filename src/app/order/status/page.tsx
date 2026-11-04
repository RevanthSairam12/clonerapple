import { OrderResultPage, type OrderResultPageProps } from '@/components/orders/OrderResultPage';

export const dynamic = 'force-dynamic';

export default async function OrderStatusPage(props: OrderResultPageProps) {
  return OrderResultPage({ ...props, route: 'status' });
}
