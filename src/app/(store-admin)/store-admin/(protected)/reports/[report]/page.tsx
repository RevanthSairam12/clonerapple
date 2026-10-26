import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PrintButton } from '@/components/store-admin/PrintButton';
import { listBrands, listCategoryOptions } from '@/lib/store-admin/catalog';
import { listExpenseCategories } from '@/lib/store-admin/expenses';
import { getReport } from '@/lib/store-admin/reports';
import {
  ORDER_STATUSES,
  REPORT_CHANNELS,
  REPORT_GROUP_BY,
  formatReportValue,
  isReportKey,
  parseReportFilters,
  reportDefinition,
  reportHref,
  reportQuery,
  type ReportColumn,
  type ReportData,
  type ReportRow,
} from '@/lib/store-admin/report-rules';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface Option {
  id: string;
  name: string;
}

function flatParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function cellClass(column: ReportColumn): string | undefined {
  return column.align === 'right' ? 'sa-num' : undefined;
}

function ReportTable({ data }: { data: ReportData }) {
  const { columns, rows, totals } = data;

  return (
    <div className="sa-table-wrap sa-report-table-wrap">
      <table className="sa-table sa-report-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cellClass(column)}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="sa-empty" colSpan={columns.length}>
                Nothing matches this range and these filters.
              </td>
            </tr>
          ) : (
            rows.map((row: ReportRow, index) => (
              <tr key={`${String(row[columns[0]?.key] ?? index)}-${index}`}>
                {columns.map((column) => {
                  const href = reportHref(row, column);
                  const value = formatReportValue(row[column.key] ?? null, column.format);
                  return (
                    <td key={column.key} className={cellClass(column)}>
                      {href ? (
                        <Link className="sa-product-link" href={href}>
                          {value}
                        </Link>
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
        {totals ? (
          <tfoot>
            <tr>
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {formatReportValue(totals[column.key] ?? null, column.format)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export default async function StoreAdminReportPage({ params, searchParams }: Props) {
  const { report: key } = await params;
  if (!isReportKey(key)) notFound();

  const definition = reportDefinition(key);
  const raw = flatParams(await searchParams);
  const parsed = parseReportFilters(raw);

  if (!parsed.ok) {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/reports">
          ← All reports
        </Link>
        <h1 className="sa-page-title">{definition.title}</h1>
        <p className="sa-error">{parsed.error}</p>
      </div>
    );
  }

  const filters = parsed.filters;

  const [result, categoryResult, brandResult] = await Promise.all([
    getReport(key, filters),
    key === 'expenses'
      ? listExpenseCategories().then((r) =>
          r.ok ? r.data.map((category) => ({ id: category.id, name: category.name })) : [],
        )
      : definition.filters.category
        ? listCategoryOptions().then((r) =>
            r.ok ? r.data.map((category) => ({ id: category.id, name: category.name })) : [],
          )
        : Promise.resolve([] as Option[]),
    definition.filters.brand
      ? listBrands().then((r) =>
          r.ok ? r.data.map((brand) => ({ id: brand.id, name: brand.name })) : [],
        )
      : Promise.resolve([] as Option[]),
  ]);

  const exportHref = `/api/store-admin/reports/export${reportQuery(filters, { report: key })}`;
  const hasFilters =
    filters.status !== 'all' ||
    filters.channel !== 'all' ||
    filters.categoryId !== null ||
    filters.brandId !== null ||
    filters.groupBy !== 'day' ||
    raw.from !== undefined ||
    raw.to !== undefined;

  return (
    <div className="sa-report-page">
      <div className="sa-detail-head sa-print-hide">
        <div>
          <Link className="sa-back" href="/store-admin/reports">
            ← All reports
          </Link>
          <h1 className="sa-page-title">{definition.title}</h1>
          <p className="sa-page-sub">{definition.description}</p>
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
        <h1>{definition.title}</h1>
        <p>
          {filters.fromDay} to {filters.toDay}
          {definition.groupBy ? ` · grouped by ${filters.groupBy}` : ''}
          {` · printed ${new Date().toISOString().slice(0, 10)}`}
        </p>
      </div>

      <form
        className="sa-filter-bar sa-print-hide"
        method="get"
        action={`/store-admin/reports/${key}`}
      >
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="report-from">From</label>
          <input
            id="report-from"
            className="sa-input"
            type="date"
            name="from"
            defaultValue={filters.fromDay}
          />
        </div>
        <div className="sa-filter-field">
          <label className="sa-label" htmlFor="report-to">To</label>
          <input
            id="report-to"
            className="sa-input"
            type="date"
            name="to"
            defaultValue={filters.toDay}
          />
        </div>
        {definition.groupBy ? (
          <div className="sa-filter-field">
            <label className="sa-label" htmlFor="report-group">Group by</label>
            <select
              id="report-group"
              className="sa-input"
              name="group"
              defaultValue={filters.groupBy}
            >
              {REPORT_GROUP_BY.map((group) => (
                <option key={group} value={group}>
                  {group === 'day' ? 'Day' : group === 'week' ? 'Week' : 'Month'}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {definition.filters.status ? (
          <div className="sa-filter-field">
            <label className="sa-label" htmlFor="report-status">Order status</label>
            <select
              id="report-status"
              className="sa-input"
              name="status"
              defaultValue={filters.status}
            >
              <option value="all">All statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {definition.filters.channel ? (
          <div className="sa-filter-field">
            <label className="sa-label" htmlFor="report-channel">Channel</label>
            <select
              id="report-channel"
              className="sa-input"
              name="channel"
              defaultValue={filters.channel}
            >
              <option value="all">Web and POS</option>
              {REPORT_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel === 'web' ? 'Web' : 'POS'}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {definition.filters.category ? (
          <div className="sa-filter-field">
            <label className="sa-label" htmlFor="report-category">
              {key === 'expenses' ? 'Expense category' : 'Category'}
            </label>
            <select
              id="report-category"
              className="sa-input"
              name="category"
              defaultValue={filters.categoryId ?? ''}
            >
              <option value="">All</option>
              {categoryResult.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {definition.filters.brand ? (
          <div className="sa-filter-field">
            <label className="sa-label" htmlFor="report-brand">Brand</label>
            <select
              id="report-brand"
              className="sa-input"
              name="brand"
              defaultValue={filters.brandId ?? ''}
            >
              <option value="">All</option>
              {brandResult.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="sa-filter-actions">
          <button type="submit" className="sa-btn sa-btn-primary sa-btn-small">Apply</button>
          {hasFilters ? (
            <Link className="sa-back sa-back-inline" href={`/store-admin/reports/${key}`}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {!result.ok ? (
        <p className="sa-notice">
          This report is not available. Check the database configuration and that
          migrations 0027 and 0028 are applied.
        </p>
      ) : (
        <>
          {result.data.stats.length > 0 ? (
            <div className="sa-stat-grid">
              {result.data.stats.map((stat) => (
                <div className="sa-stat" key={stat.label}>
                  <div className="sa-stat-top">
                    <span className="sa-stat-label">{stat.label}</span>
                  </div>
                  <p className="sa-stat-value">
                    {formatReportValue(stat.value, stat.format)}
                  </p>
                  {stat.hint ? <span className="sa-stat-meta">{stat.hint}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {result.data.truncated ? (
            <p className="sa-notice sa-print-hide">
              Showing the first {result.data.rows.length} rows. The totals still cover the
              whole range — narrow the dates or filters to see the rest, or export the CSV.
            </p>
          ) : null}

          <ReportTable data={result.data} />

          {result.data.note ? (
            <p className="sa-report-note">{result.data.note}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
