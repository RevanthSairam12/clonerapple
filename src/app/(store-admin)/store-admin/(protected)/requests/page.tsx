import Link from 'next/link';
import { listOrderRequests, REQUESTS_UNAVAILABLE_MESSAGE } from '@/lib/store-admin/order-requests';

export const dynamic = 'force-dynamic';

const statuses = [['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['REJECTED', 'Rejected']];

export default async function StoreAdminRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const result = await listOrderRequests(status);

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Requests</h1>
        <p className="sa-page-sub">Customer cancellation, return, and help requests.</p>
        <p className="sa-notice">{REQUESTS_UNAVAILABLE_MESSAGE}</p>
      </div>
    );
  }

  const { requests, counts } = result.data;
  return <div><h1 className="sa-page-title">Requests</h1><p className="sa-page-sub">Customer cancellation, return, and help requests.</p><div className="sa-filter-row">{statuses.map(([value, label]) => <Link key={label} href={value ? `/store-admin/requests?status=${value}` : '/store-admin/requests'} className="sa-filter-chip">{label} {value ? `(${counts[value as keyof typeof counts]})` : `(${Object.values(counts).reduce((sum, count) => sum + count, 0)})`}</Link>)}</div><div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Request</th><th>Customer</th><th>Order</th><th>Status</th><th>Created</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td><Link href={`/store-admin/requests/${request.id}`} className="sa-table-link">{request.type}</Link></td><td>{request.customerName}<br /><span className="sa-muted">{request.customerEmail}</span></td><td><Link href={`/store-admin/orders/${request.txnid}`} className="sa-table-link">{request.txnid}</Link></td><td><span className="sa-status">{request.status}</span></td><td>{request.createdAt.toLocaleString('en-IN')}</td></tr>)}</tbody></table>{requests.length === 0 && <p className="sa-empty">No requests match this filter.</p>}</div></div>;
}
