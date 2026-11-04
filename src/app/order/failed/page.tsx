import { OrderResultPage, type OrderResultPageProps } from '@/components/orders/OrderResultPage';

export const dynamic = 'force-dynamic';

export default async function OrderFailedPage(props: OrderResultPageProps) {
  return OrderResultPage({ ...props, route: 'failed' });
}
