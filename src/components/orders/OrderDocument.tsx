import { DocumentHeader } from '@/components/store-admin/DocumentHeader';
import { formatPaise } from '@/lib/catalog/storefront';
import { projectCustomerDocumentState, type DocumentState } from '@/lib/orders/document-policy';
import { formatRupees, type DocumentAddress, type OrderTotals } from '@/lib/store-admin/order-documents';
import { formatDate } from '@/lib/store-admin/catalog';
import type { StoreSettings } from '@/lib/store-admin/settings-rules';

export interface OrderDocumentData {
  txnid: string;
  createdAt: string;
  currency: string;
  channel?: string;
  paymentLabel?: string;
  couponCode?: string | null;
  billTo?: DocumentAddress | null;
  shipTo?: DocumentAddress | null;
  items: Array<{
    lineNumber: number;
    productName: string;
    productId?: string;
    variantId?: string | null;
    variantSku?: string | null;
    variantLabel?: string | null;
    serialNumber?: string | null;
    /** The ordered photo, snapshotted with the line (0061). */
    imageUrl?: string | null;
    imageAlt?: string | null;
    quantity: number;
    unitPricePaise: number;
    referencePricePaise?: number | null;
    lineTotalPaise: number;
    currency?: string;
    isFreeGift?: boolean;
    freeGiftBadge?: string | null;
  }>;
}

export function documentTitle(state: DocumentState): string {
  if (state.kind === 'receipt') return 'Payment receipt';
  if (state.kind === 'status') return 'Order / payment status';
  if (state.kind === 'invoice') return 'Invoice';
  if (state.kind === 'legacy') return 'Legacy bill / payment receipt';
  return 'Bill / Payment receipt';
}

/** Safe for payment-return summaries too: statuses and amounts only, never PII. */
export function OrderDocumentStatus({ state, currency = 'INR', customer = false }: {
  state: DocumentState;
  currency?: string;
  customer?: boolean;
}) {
  const money = (value: number) => currency === 'INR' ? formatPaise(value) : formatRupees(value, currency);
  return (
    <section className={customer ? 'my-5 rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] p-5 text-sm' : 'sa-doc-callout'} aria-label="Current payment and refund status">
      <p className={customer ? 'font-semibold' : 'sa-card-title'}>{state.label}</p>
      <dl className={customer ? 'mt-3 space-y-2 text-sm' : 'sa-meta'}>
        <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Order amount</dt><dd>{money(state.totalPaise)}</dd></div>
        <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Payment record</dt><dd>{state.paymentStatus === 'PAID' ? 'Payment captured' : state.paymentStatus.replaceAll('_', ' ')}</dd></div>
        <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Order status</dt><dd>{state.orderStatus.replaceAll('_', ' ')}</dd></div>
        <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Shipment status</dt><dd>{state.shipmentStatus.replaceAll('_', ' ')}</dd></div>
        <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Refund status</dt><dd>{state.refundStatus === 'NONE' ? 'None' : state.refundStatus === 'COMPLETED' ? 'Successful — full' : state.refundStatus === 'PARTIAL' ? 'Successful — partial' : state.refundStatus.replaceAll('_', ' ')}</dd></div>
        {state.capturedPaise > 0 && <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Payment captured</dt><dd>{money(state.capturedPaise)}</dd></div>}
        {state.refundedPaise > 0 && <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Refund successful ({state.refundedPaise >= state.capturedPaise ? 'full' : 'partial'})</dt><dd>{money(state.refundedPaise)}</dd></div>}
        {state.pendingRefundPaise > 0 && <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Refund initiated — not yet completed</dt><dd>{money(state.pendingRefundPaise)}</dd></div>}
        {state.refundDuePaise > 0 && <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Refund due — not yet initiated</dt><dd>{money(state.refundDuePaise)}</dd></div>}
        {(state.refundedPaise > 0 || state.pendingRefundPaise > 0) && <div className={customer ? 'flex justify-between gap-4' : undefined}><dt>Net payment retained (completed refunds only)</dt><dd>{money(state.retainedPaise)}</dd></div>}
      </dl>
      {state.kind === 'status' ? <p className={customer ? 'mt-3 text-[#6e6e73]' : 'sa-doc-muted'}>Status information only. This is not a bill or proof of payment.</p> : !state.isPaymentProof && <p className={customer ? 'mt-3 text-[#6e6e73]' : 'sa-doc-muted'}>This document retains the original order record with its current status. It is not confirmation of a current paid sale.</p>}
    </section>
  );
}

function formatIstDateStamp(value?: string | Date): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '00000000';
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    const digits = formatted.replace(/\D/g, '');
    if (digits.length === 8) return digits;
  } catch {
    // Fallback to UTC stamp when Intl timeZone data is unavailable.
  }
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/** Deterministic unique barcode value mixing order ID, order date, and current date. */
export function buildOrderBarcodeValue(
  txnid: string,
  createdAt?: string,
  now: Date = new Date(),
): string {
  const cleanId = txnid.toUpperCase().replace(/[^A-Z0-9]/g, '') || '0';
  const orderDate = formatIstDateStamp(createdAt);
  const currentDate = formatIstDateStamp(now);
  const dateMix = `${orderDate}${currentDate}`;
  let mixed = '';
  const maxLen = Math.max(cleanId.length, dateMix.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i < cleanId.length) mixed += cleanId[i];
    if (i < dateMix.length) mixed += dateMix[i];
  }
  const checksum = fnv1aHex(`${cleanId}|${orderDate}|${currentDate}`);
  return `GZ-${mixed}-${checksum}`;
}

function OrderBarcode({ code, customer }: { code: string; customer: boolean }) {
  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 0;
  const pushGuard = (pattern: number[]) => {
    pattern.forEach((w, idx) => {
      if (idx % 2 === 0) bars.push({ x: cursor, w });
      cursor += w;
    });
  };

  pushGuard([2, 1, 1, 2, 1, 1]);
  for (let i = 0; i < code.length; i += 1) {
    const ch = code.charCodeAt(i);
    for (let slot = 0; slot < 3; slot += 1) {
      const barWidth = ((ch >> (slot * 2)) & 1) === 1 ? 2 : 1;
      const gapWidth = (((ch + i) >> slot) & 1) === 1 ? 2 : 1;
      bars.push({ x: cursor, w: barWidth });
      cursor += barWidth + gapWidth;
    }
  }
  pushGuard([2, 1, 1, 1, 2]);

  return (
    <div
      className={
        customer
          ? 'mt-6 flex flex-col items-center border-t border-[#e5e5ea] pt-5 text-center'
          : 'sa-doc-barcode mt-6 flex flex-col items-center border-t border-black/10 pt-4 text-center'
      }
      data-order-barcode={code}
    >
      <svg
        role="img"
        aria-label={`Order verification barcode ${code}`}
        viewBox={`0 0 ${cursor} 44`}
        className="h-11 w-full max-w-[340px]"
        preserveAspectRatio="none"
      >
        {bars.map((bar) => (
          <rect key={bar.x} x={bar.x} y={0} width={bar.w} height={44} fill="#111111" />
        ))}
      </svg>
      <span className="mt-1.5 font-mono text-xs tracking-[0.18em] text-[#1d1d1f]">{code}</span>
    </div>
  );
}

function ShippedToName({ address, customer }: { address: DocumentAddress | null | undefined; customer: boolean }) {
  const name = address?.fullName?.trim();
  if (!name) return <p className="sa-doc-muted text-sm text-[#6e6e73]">Customer</p>;
  return (
    <p className={customer ? 'mt-2 text-sm not-italic leading-6' : 'sa-doc-address'}>
      <strong>{name}</strong>
    </p>
  );
}

/** Presentation only. Each caller must authorize and construct its own address/item DTO. */
export function OrderDocument({ order, totals, state, settings = null, customer = false }: {
  order: OrderDocumentData;
  totals: OrderTotals;
  state: DocumentState;
  settings?: StoreSettings | null;
  customer?: boolean;
}) {
  // Defense in depth for callers still holding internal staff document facts.
  if (customer) {
    const mode = state.kind === 'receipt' ? 'receipt'
      : 'canViewInvoice' in state && (state.kind === 'invoice' || state.kind === 'status') ? 'invoice' : undefined;
    state = projectCustomerDocumentState(state, mode);
  }
  const money = (value: number, currency = order.currency) => currency === 'INR' ? formatPaise(value) : formatRupees(value, currency);
  const showBill = state.kind !== 'status' && state.canViewBill;
  const paymentReceipt = state.kind === 'receipt';
  const showInvoiceIdentity = !customer || (showBill && state.kind === 'invoice');
  const rowClass = customer ? 'flex justify-between gap-4 py-1' : 'sa-doc-total-row';
  const serialNumbers = order.items
    .map((item) => item.serialNumber?.trim())
    .filter((value): value is string => Boolean(value));
  const barcodeValue =
    showBill && !paymentReceipt ? buildOrderBarcodeValue(order.txnid, order.createdAt) : '';
  const receiptNotice =
    'This is a payment receipt only and cannot be used for any warranty claim or any other purpose.';
  return (
    <article
      data-order-document="true"
      className={
        customer
          ? 'rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none'
          : 'sa-doc-sheet'
      }
    >
      <DocumentHeader
        settings={settings}
        customer={customer}
        showBusinessDetails={showBill && !paymentReceipt}
        title={showBill ? documentTitle(state) : 'Order / payment status'}
        badge={showBill ? (paymentReceipt ? 'Payment record' : 'Bill of supply') : 'Status only'}
        kicker={
          showBill
            ? paymentReceipt
              ? receiptNotice
              : 'No tax collected — the business is not GST-registered.'
            : 'This is not proof of payment.'
        }
      />
      <OrderDocumentStatus state={state} currency={order.currency} customer={customer} />
      <div className={customer ? 'my-6 grid gap-6 sm:grid-cols-2' : 'sa-doc-parties'}>
        {showBill && (
          <section className="sa-doc-block">
            <h2 className={customer ? 'font-semibold' : undefined}>Shipped to</h2>
            <ShippedToName address={order.shipTo ?? order.billTo} customer={customer} />
          </section>
        )}
        <section className="sa-doc-block sa-doc-facts">
          <h2 className={customer ? 'font-semibold' : undefined}>Details</h2>
          <dl className={customer ? 'mt-2 space-y-2 text-sm' : 'sa-doc-facts-list'}>
            <div className={rowClass}><dt>Order ref</dt><dd className="font-mono">{order.txnid}</dd></div>
            {showInvoiceIdentity && state.invoiceNumber && <div className={rowClass}><dt>Invoice ref</dt><dd className="font-mono">{state.invoiceNumber}</dd></div>}
            {showInvoiceIdentity && state.invoiceIssuedAt && <div className={rowClass}><dt>Invoice issued</dt><dd>{formatDate(state.invoiceIssuedAt)}</dd></div>}
            {showInvoiceIdentity && serialNumbers.length > 0 && (
              <div className={rowClass}>
                <dt>{serialNumbers.length === 1 ? 'Serial number' : 'Serial numbers'}</dt>
                <dd className="font-mono">{serialNumbers.join(', ')}</dd>
              </div>
            )}
            <div className={rowClass}><dt>Order date</dt><dd>{formatDate(order.createdAt)}</dd></div>
            {order.channel && <div className={rowClass}><dt>Channel</dt><dd>{order.channel === 'pos' ? 'Point of sale' : 'Online store'}</dd></div>}
            {order.paymentLabel && <div className={rowClass}><dt>Payment method</dt><dd>{order.paymentLabel}</dd></div>}
          </dl>
        </section>
      </div>
      {showBill ? <>
        {state.kind === 'provisional' && <p className={customer ? 'mb-5 text-sm text-[#6e6e73]' : 'sa-doc-callout'}>Bill / Payment receipt — invoice follows on shipment. This provisional document has no permanent invoice number.</p>}
        {state.kind === 'legacy' && <p className={customer ? 'mb-5 text-sm text-[#6e6e73]' : 'sa-doc-callout'}>Legacy document. No permanent invoice number or issuance date was recorded. The order reference is not an invoice number.</p>}
        <div className={customer ? 'overflow-x-auto' : undefined}>
          <table className={customer ? 'w-full border-collapse text-left text-sm' : 'sa-table sa-doc-table'}>
            <thead><tr className={customer ? 'border-b border-[#e5e5ea]' : undefined}><th className="py-3">#</th><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{order.items.map((item) => <tr key={item.lineNumber} className={customer ? 'border-b border-[#e5e5ea]' : undefined}>
              <td className="py-3">{item.lineNumber}</td>
              <td>{item.imageUrl && <img src={item.imageUrl} alt={item.imageAlt ?? item.productName} className="mr-2 inline-block h-10 w-10 rounded object-contain align-middle" />}{item.productName}{item.isFreeGift && <span className={customer ? 'ml-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-900' : 'sa-badge sa-badge-ok ml-2'}>{item.freeGiftBadge || 'FREE GIFT'}</span>}{item.variantLabel && <span className="sa-row-sub block text-xs text-[#6e6e73]">{item.variantLabel}</span>}{item.variantSku && <span className="sa-row-sub block text-xs text-[#6e6e73]">SKU: {item.variantSku}</span>}{!paymentReceipt && item.serialNumber && <span className="sa-row-sub block text-xs font-medium text-[#1d1d1f]">Serial No: <span className="font-mono">{item.serialNumber}</span></span>}{item.productId && <span className="sa-row-sub block text-xs text-[#6e6e73]">{item.productId}</span>}{item.isFreeGift && item.referencePricePaise != null && item.referencePricePaise > 0 ? <span className="sa-row-sub block text-xs text-[#6e6e73]">Regular value <span className="line-through">{money(item.referencePricePaise, item.currency)}</span></span> : item.referencePricePaise != null && item.referencePricePaise !== item.unitPricePaise ? <span className="sa-row-sub block text-xs text-[#6e6e73]">List price at sale {money(item.referencePricePaise, item.currency)}</span> : null}</td>
              <td className="sa-num text-right">{item.quantity}</td><td className="sa-num text-right">{item.isFreeGift ? 'FREE' : money(item.unitPricePaise, item.currency)}</td><td className="sa-num text-right">{item.isFreeGift ? `FREE (${money(0, item.currency)})` : money(item.lineTotalPaise, item.currency)}</td>
            </tr>)}{order.items.length === 0 && <tr><td colSpan={5} className="sa-doc-muted py-3">No item snapshot is available for this order.</td></tr>}</tbody>
          </table>
        </div>
        <div className={customer ? 'ml-auto mt-5 max-w-sm text-sm' : 'sa-doc-totals'}>
          <div className={rowClass}><span>Subtotal</span><span>{money(totals.subtotalPaise)}</span></div>
          {totals.discountPaise > 0 && <div className={rowClass}><span>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</span><span>−{money(totals.discountPaise)}</span></div>}
          <div className={rowClass}><span>Shipping</span><span>{totals.shippingPaise === 0 ? 'Free' : money(totals.shippingPaise)}</span></div>
          <div className={`${rowClass} ${customer ? 'mt-3 text-lg font-semibold' : 'is-total'}`}><span>Order total</span><span>{money(totals.totalPaise)}</span></div>
          {!state.isPaymentProof && state.capturedPaise < state.totalPaise && <div className={rowClass}><span>Payment not confirmed</span><span>{money(Math.max(0, state.totalPaise - state.capturedPaise))}</span></div>}
        </div>
      </> : <p className={customer ? 'text-sm text-[#6e6e73]' : 'sa-doc-muted'}>The current order and payment state does not permit a payment receipt.</p>}
      <footer className={customer ? 'mt-8 text-sm text-[#6e6e73]' : 'sa-doc-note'}>
        {settings?.receipt_footer?.trim() && <p>{settings.receipt_footer.trim()}</p>}
        {showBill && paymentReceipt && (
          <p className={customer ? 'font-medium text-[#1d1d1f]' : undefined}>{receiptNotice}</p>
        )}
        {showBill && !paymentReceipt && <p>This document is a bill of supply for a non-GST-registered business. It is not a tax invoice and no GST has been charged.</p>}
        {showBill && !paymentReceipt && barcodeValue && (
          <OrderBarcode code={barcodeValue} customer={customer} />
        )}
      </footer>
    </article>
  );
}
