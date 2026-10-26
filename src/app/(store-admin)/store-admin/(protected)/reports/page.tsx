import Link from 'next/link';

import {
  REPORTS,
  defaultReportRange,
  type ReportGroup,
} from '@/lib/store-admin/report-rules';

export const dynamic = 'force-dynamic';

const GROUP_ORDER: ReportGroup[] = ['Sales', 'Money', 'Catalogue', 'Customers'];

const GROUP_NOTE: Record<ReportGroup, string> = {
  Sales: 'Revenue, orders and day-by-day movement.',
  Money: 'Every payment, refund and expense on one set of definitions.',
  Catalogue: 'What sold, what is left and what needs reordering.',
  Customers: 'Who bought, how often and what they are worth.',
};

/**
 * Reports hub.
 *
 * Ten fixed reports plus the expense ledger. Each card opens the report with
 * the last 30 days selected, so the first click always produces a table.
 */
export default function StoreAdminReportsPage() {
  const range = defaultReportRange();

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Reports</h1>
          <p className="sa-page-sub">
            Every report takes a date range and the filters that make sense for it, prints
            cleanly and exports the same table as CSV. Defaults open on the last 30 days
            ({range.fromDay} to {range.toDay}).
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/expenses">
            Expense ledger
          </Link>
        </div>
      </div>

      {GROUP_ORDER.map((group) => {
        const items = REPORTS.filter((report) => report.group === group);
        if (items.length === 0) return null;
        return (
          <section className="sa-report-section" key={group}>
            <div className="sa-report-heading">
              <h2 className="sa-section-title">{group}</h2>
              <p className="sa-card-note">{GROUP_NOTE[group]}</p>
            </div>
            <div className="sa-report-grid">
              {items.map((report) => (
                <Link
                  className="sa-report-card"
                  key={report.key}
                  href={`/store-admin/reports/${report.key}?from=${range.fromDay}&to=${range.toDay}`}
                >
                  <span className="sa-report-kicker">{report.group}</span>
                  <h3 className="sa-report-title">{report.title}</h3>
                  <p className="sa-report-desc">{report.description}</p>
                  <span className="sa-report-open">Open report →</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section className="sa-report-section">
        <div className="sa-report-heading">
          <h2 className="sa-section-title">Expenses</h2>
          <p className="sa-card-note">
            Rent, packaging, salaries and everything else the shop spends money on.
          </p>
        </div>
        <div className="sa-report-grid">
          <Link className="sa-report-card" href="/store-admin/expenses">
            <span className="sa-report-kicker">Ledger</span>
            <h3 className="sa-report-title">Expense ledger</h3>
            <p className="sa-report-desc">
              Record and correct manual expenses, attach a receipt photo and see the running
              total for any period.
            </p>
            <span className="sa-report-open">Open ledger →</span>
          </Link>
          <Link className="sa-report-card" href="/store-admin/reports/expenses">
            <span className="sa-report-kicker">Report</span>
            <h3 className="sa-report-title">Expense report</h3>
            <p className="sa-report-desc">
              The ledger rolled up by day and category, with a total for the chosen range.
            </p>
            <span className="sa-report-open">Open report →</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
