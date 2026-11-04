import { OrderResultPage, type OrderResultPageProps } from '@/components/orders/OrderResultPage';

export const dynamic = 'force-dynamic';

export default async function OrderCancelledPage(props: OrderResultPageProps) {
  return OrderResultPage({ ...props, route: 'cancelled' });
}
