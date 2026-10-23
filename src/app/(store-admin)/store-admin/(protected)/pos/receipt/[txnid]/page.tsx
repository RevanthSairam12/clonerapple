import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPosReceipt } from '@/lib/store-admin/pos';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { formatDate } from '@/lib/store-admin/catalog';
import { PrintButton } from '@/components/store-admin/PrintButton';

interface Props {
  params: Promise<{ txnid: string }>;
}

function formatAmount(amountPaise: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(amountPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function PosReceiptPage({ params }: Props) {
  const { txnid } = await params;

  const [result, settingsResult] = await Promise.all([
    getPosReceipt(txnid),
    getStoreSettings(),
  ]);
  if (!result.ok) notFound();
  if (result.receipt.txnid === '') notFound();

  const receipt = result.receipt;
  const settings = settingsResult.ok ? settingsResult.settings : null;
  const tradeName = settings?.trade_name?.trim() || 'Gadzio';
  const address = settings?.address?.trim() || '';
  const phone = settings?.phone?.trim() || '';
  const email = settings?.email?.trim() || '';
  const footer = settings?.receipt_footer?.trim() || '';

  return (
    <div className="sa-receipt-wrap">
      <div className="sa-receipt">
        <header className="sa-receipt-head">
          <strong className="sa-receipt-trade">{tradeName}</strong>
          {address ? <span className="sa-receipt-address">{address}</span> : null}
          {phone || email ? (
            <span className="sa-receipt-contact">
              {phone ? `Phone: ${phone}` : ''}
              {phone && email ? ' · ' : ''}
              {email ? `Email: ${email}` : ''}
            </span>
          ) : null}
          <h1 className="sa-receipt-title">Receipt / Bill of Supply</h1>
          <p className="sa-receipt-kicker">No tax collected — the business is not GST-registered.</p>
        </header>

        <dl className="sa-meta sa-receipt-meta-list">
          <div><dt>Receipt no.</dt><dd className="sa-mono">{receipt.receiptNo}</dd></div>
          <div><dt>Reference</dt><dd className="sa-mono">{receipt.txnid}</dd></div>
          <div><dt>Date</dt><dd>{formatDate(receipt.createdAt)}</dd></div>
          <div><dt>Cashier</dt><dd>{receipt.cashierName}</dd></div>
          {receipt.customerPhoneMasked ? (
            <div><dt>Customer phone</dt><dd className="sa-mono">{receipt.customerPhoneMasked}</dd></div>
          ) : null}
        </dl>

        <table className="sa-table sa-receipt-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="sa-num">Qty</th>
              <th className="sa-num">Unit price</th>
              <th className="sa-num">Line total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line) => (
              <tr key={line.lineNumber}>
                <td>{line.productName}</td>
                <td className="sa-num">{line.quantity}</td>
                <td className="sa-num">{formatAmount(line.unitPricePaise, line.currency)}</td>
                <td className="sa-num">{formatAmount(line.lineTotalPaise, line.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="sa-num">Subtotal</td>
              <td className="sa-num">{formatAmount(receipt.subtotalPaise, 'INR')}</td>
            </tr>
            <tr>
              <td colSpan={3} className="sa-num"><strong>Total</strong></td>
              <td className="sa-num"><strong>{formatAmount(receipt.totalPaise, 'INR')}</strong></td>
            </tr>
          </tfoot>
        </table>

        <dl className="sa-meta sa-receipt-payment">
          <div><dt>Paid by</dt><dd>{receipt.method?.replace('_', ' ') || '—'}</dd></div>
          {receipt.providerRef ? (
            <div><dt>Payment ref</dt><dd className="sa-mono">{receipt.providerRef}</dd></div>
          ) : null}
        </dl>

        {footer ? <p className="sa-receipt-footer-text">{footer}</p> : null}
        <p className="sa-receipt-note">
          This receipt is proof of payment only. It is not an invoice under GST law.
        </p>
      </div>

      <div className="sa-receipt-print-bar">
        <PrintButton />
        <Link className="sa-btn sa-btn-quiet" href="/store-admin/pos">Ring up another sale</Link>
      </div>
    </div>
  );
}
