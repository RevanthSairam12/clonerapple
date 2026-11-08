import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountFrame } from '@/components/account/AccountFrame';
import { PrintButton } from '@/components/account/PrintButton';
import { OrderDocument } from '@/components/orders/OrderDocument';
import { requireAccountPageSession } from '@/lib/account/auth';
import { getCustomerOrderDetail } from '@/lib/account/orders';
import { getCustomerDocumentState } from '@/lib/orders/document-data';
import { optionSnapshotLabel } from '@/lib/orders/option-snapshot';
import { parseCustomerDocumentMode } from '@/lib/orders/document-policy';
import { orderTotals } from '@/lib/store-admin/order-documents';

export const dynamic = 'force-dynamic';

export default async function AccountReceiptPage({ params, searchParams }: {
  params: Promise<{ txnid: string }>;
  searchParams: Promise<{ document?: string | string[] }>;
}) {
  const { txnid } = await params;
  const mode = parseCustomerDocumentMode((await searchParams).document);
  const suffix = mode === 'invoice' || mode === 'receipt' ? `?document=${mode}` : '';
  const session = await requireAccountPageSession(`/account/orders/${encodeURIComponent(txnid)}/receipt${suffix}`);
  const order = await getCustomerOrderDetail(session.userId, txnid);
  if (!order) notFound();
  if (mode === null) notFound();
  // Ownership is established first. Gate explicit invoice access before constructing
  // any address/item/totals document DTO; never substitute a receipt in this mode.
  const state = await getCustomerDocumentState(order.id, mode);
  const back = <Link href={`/account/orders/${encodeURIComponent(order.txnid)}`} className="text-sm font-semibold text-[#1d1d1f]">← Back to order</Link>;
  if ((mode === 'invoice' && !state.canViewInvoice) || !state.canViewBill) {
    return <AccountFrame session={session} active="/account/orders">
      <div className="mx-auto max-w-4xl space-y-5">
        {back}
        <section className="rounded-3xl border border-[#e5e5ea] bg-white p-6" aria-label="Document unavailable">
          <h1 className="text-2xl font-semibold">Document unavailable</h1>
          <p className="mt-3 text-sm text-[#6e6e73]">This document is not available for the current order and payment state.</p>
        </section>
      </div>
    </AccountFrame>;
  }
  const address = order.address ? {
    type: 'shipping', fullName: order.address.name, phone: order.address.phone,
    line1: order.address.line1, line2: order.address.line2 || null,
    city: order.address.city, state: order.address.state,
    postalCode: order.address.pincode, country: 'IN',
  } : null;
  const items = order.items.map((item, index) => ({
    lineNumber: index + 1, productName: item.name, productId: item.id,
    variantId: item.variantId, variantSku: item.variantSku,
    // The snapshot label ("iPhone 16 · Red") replaces the live row label.
    variantLabel: optionSnapshotLabel(item) ?? item.variantLabel,
    imageUrl: item.image, imageAlt: item.imageAlt ?? item.name,
    quantity: item.quantity, unitPricePaise: Math.round(item.unitPrice * 100),
    lineTotalPaise: Math.round(item.totalPrice * 100), currency: order.currency,
  }));
  const totals = orderTotals({ ...order, items });

  return <AccountFrame session={session} active="/account/orders">
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="mb-4 flex justify-between gap-3 print:hidden">
        {back}
        <PrintButton />
      </div>
      <OrderDocument customer state={state} totals={totals} order={{
        txnid: order.txnid, createdAt: order.createdAt.toISOString(), currency: order.currency,
        couponCode: order.couponCode, shipTo: address, items,
      }} />
    </div>
  </AccountFrame>;
}
