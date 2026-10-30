import Link from 'next/link';

import { PrintButton } from '@/components/store-admin/PrintButton';
import { formatPaise } from '@/lib/store-admin/amount';
import { listCouponOptions, couponUsageReport } from '@/lib/store-admin/coupons';
import { storeDay } from '@/lib/store-admin/report-rules';
import { getDatabaseNow, loadReportFilters } from '@/lib/store-admin/store-clock';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function stateLabel(state: string): string {
  if (state === 'CONSUMED') return 'Used';
  if (state === 'RESERVED') return 'Held at checkout';
  if (state === 'RELEASED') return 'Released';
  return state;
}

/**
 * Coupon usage report.
 *
 * One row per redemption, over the same date range as every other report.
 * `RESERVED` rows are uses currently held by an unpaid checkout; only
 * `CONSUMED` rows count towards the discount and revenue totals. Order total
 * is already net of the coupon, so discount and revenue do not double-count.
 */
export default async function CouponUsageReportPage({ searchParams }: Props) {
  const raw = await searchParams;
  const params = {
    from: first(raw.from),
    to: first(raw.to),
  };
  const parsed = await loadReportFilters(params);
  const code = first(raw.code).trim().toUpperCase();

  const [result, optionsResult] = await Promise.all([
    parsed.ok
      ? couponUsageReport({
          fromDay: parsed.filters.fromDay,
          toDay: parsed.filters.toDay,
          code,
          timeZone: parsed.filters.timeZone,
        })
      : Promise.resolve(null),
    listCouponOptions(),
  ]);

  const options = optionsResult.ok ? optionsResult.data : [];

  if (!parsed.ok) {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/reports">
          ← All reports
        </Link>
        <h1 className="sa-page-title">Coupon usage</h1>
        <p className="sa-error">{parsed.error}</p>
      </div>
    );
  }

  const filters = parsed.filters;
  const exportHref = `/api/store-admin/reports/coupon-usage/export?from=${encodeURIComponent(
    filters.fromDay,
  )}&to=${encodeURIComponent(filters.toDay)}${code ? `&code=${encodeURIComponent(code)}` : ''}`;

  const data = result && result.ok ? result.data : null;
  const printedOn = storeDay(await getDatabaseNow(), filters.timeZone);

  return (
    <div className="sa-report-page">
      <div className="sa-detail-head sa-print-hide">
        <div>
          <Link className="sa-back" href="/store-admin/reports">
            ← All reports
          </Link>
          <h1 className="sa-page-title">Coupon usage</h1>
          <p className="sa-page-sub">
            Every redemption in the range with the order it belongs to, the discount it took and
            whether that use is held, used or released.
          </p>
        </div>
        <div className="sa-inline-actions">
          <a className="sa-btn sa-btn-quiet sa-btn-small" href={exportHref} download>
            Export CSV
          </a>
          <PrintButton label="Print report" />
        </div>
      </div>

      <div className="sa-print-only sa-print-head">
        <span className="sa-print-brand">Gadzio · Store Desk</span>
        <h1>Coupon usage</h1>
        <p>
          {filters.fromDay} to {filters.toDay}
          {code ? ` · ${code}` : ''}
          {` · printed ${printedOn}`}
        </p>
      </div>

      <form
        className="sa-filter-bar sa-print-hide"
        method="get"
        action="/store-admin/reports/coupon-usage"
      >
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="coupon-from">From</label>
          <input
            id="coupon-from"
            className="sa-input"
            type="date"
            name="from"
            defaultValue={filters.fromDay}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="coupon-to">To</label>
          <input
            id="coupon-to"
            className="sa-input"
            type="date"
            name="to"
            defaultValue={filters.toDay}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="coupon-code">Code</label>
          <select id="coupon-code" className="sa-input" name="code" defaultValue={code}>
            <option value="">All codes</option>
            {options.map((option) => (
              <option key={option.id} value={option.code}>
                {option.code}
              </option>
            ))}
          </select>
        </div>
        <div className="sa-filter-actions">
          <button className="sa-btn sa-btn-small" type="submit">Apply</button>
        </div>
      </form>

      {data === null ? (
        <p className="sa-notice">The coupon usage report could not be read.</p>
      ) : (
        <>
          <div className="sa-stat-row">
            <div className="sa-stat">
              <span className="sa-stat-label">Redemptions</span>
              <strong className="sa-stat-value">{data.totals.redemptions}</strong>
            </div>
            <div className="sa-stat">
              <span className="sa-stat-label">Discount given</span>
              <strong className="sa-stat-value">{formatPaise(data.totals.discountPaise)}</strong>
            </div>
            <div className="sa-stat">
              <span className="sa-stat-label">Order revenue</span>
              <strong className="sa-stat-value">{formatPaise(data.totals.revenuePaise)}</strong>
            </div>
          </div>

          <p className="sa-note">
            How this is calculated: redemptions count uses that are held or used (released uses stay
            listed but are not counted). Discount and revenue count used redemptions on orders that
            are still paid and not cancelled, by the store-timezone day of the redemption. Order
            revenue is the order total, which is already net of the coupon; the discount is the
            coupon&rsquo;s own share of it. Returns and refunds are reported separately and do not
            restore a coupon use unless the store setting says so.
          </p>

          <div className="sa-table-wrap sa-report-table-wrap">
            <table className="sa-table sa-report-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th className="sa-num">Discount</th>
                  <th className="sa-num">Order total</th>
                  <th>State</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td className="sa-empty" colSpan={7}>
                      No coupon use in this range.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row, index) => (
                    <tr key={`${row.orderNumber}-${index}`}>
                      <td>{row.code}</td>
                      <td>{row.orderNumber}</td>
                      <td>{row.customer}</td>
                      <td className="sa-num">{row.discountDisplay}</td>
                      <td className="sa-num">{row.orderTotalDisplay}</td>
                      <td>{stateLabel(row.state)}</td>
                      <td>{row.createdAt.replace('T', ' ').slice(0, 16)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td className="sa-num">{formatPaise(data.totals.discountPaise)}</td>
                  <td className="sa-num">{formatPaise(data.totals.revenuePaise)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          {data.truncated ? (
            <p className="sa-note">
              Showing the most recent 2,000 redemptions. Narrow the range or choose one code for a
              complete list.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
