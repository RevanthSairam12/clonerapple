import Link from 'next/link';

import { OverviewChart } from '@/components/store-admin/OverviewChart';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatPaise } from '@/lib/store-admin/amount';
import {
  getSalesAnalytics,
  getTransactionsAnalytics,
  getUsersAnalytics,
  parseRange,
  rangeLabel,
  RANGE_KEYS,
  type Change,
  type RangeKey,
  type SalesAnalytics,
  type TransactionsAnalytics,
  type UsersAnalytics,
} from '@/lib/store-admin/analytics';

export const dynamic = 'force-dynamic';

type TabKey = 'sales' | 'users' | 'transactions';

const TABS: Array<{ key: TabKey; label: string; note: string }> = [
  { key: 'sales', label: 'Sales', note: 'Revenue, orders and products' },
  { key: 'users', label: 'Users', note: 'Customers, signups and sessions' },
  { key: 'transactions', label: 'Transactions', note: 'Payment outcomes by status' },
];

const RANGE_SHORT: Record<RangeKey, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '12m': '12 months',
};

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Paid',
  FAILED: 'Failed',
  PENDING: 'Pending',
  CREATED: 'Created',
  CANCELLED: 'Cancelled',
};

type Tone = 'blue' | 'violet' | 'green' | 'amber' | 'rose';

const TILE_PATHS: Record<string, React.ReactNode> = {
  orders: (
    <>
      <path d="M5 7h14l-1 13H6L5 7Z" />
      <path d="M9 7V5.5a3 3 0 0 1 6 0V7" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="m3 13 5-3h8l5 3M8 16h8" />
    </>
  ),
  register: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h4M7 16h10" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h17" />
      <path d="M8 16v-5M12 16V8M16 16v-3M20 16V6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5.5a3.2 3.2 0 0 1 0 6M17.5 14.4A6 6 0 0 1 21 20" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M7 15h4" />
    </>
  ),
  rotate: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

function TileIcon({ name, size = 19 }: { name: keyof typeof TILE_PATHS; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {TILE_PATHS[name]}
    </svg>
  );
}

function parseTab(value: unknown): TabKey {
  return value === 'users' || value === 'transactions' ? value : 'sales';
}

function overviewHref(tab: TabKey, range: RangeKey): string {
  const params = new URLSearchParams();
  if (tab !== 'sales') params.set('tab', tab);
  if (range !== '30d') params.set('range', range);
  const suffix = params.toString();
  return suffix ? `/store-admin?${suffix}` : '/store-admin';
}

function pctLabel(change: Change): string {
  if (change.pct === null) return 'New';
  const rounded = Math.abs(change.pct) < 0.05 ? 0 : change.pct;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function pctTone(change: Change): 'up' | 'down' | 'flat' {
  if (change.pct === null || Math.abs(change.pct) < 0.05) return 'flat';
  return change.pct > 0 ? 'up' : 'down';
}

function StatCard({
  label,
  value,
  meta,
  icon,
  tone,
  change,
  href,
}: {
  label: string;
  value: string;
  meta: string;
  icon: keyof typeof TILE_PATHS;
  tone: Tone;
  change?: Change;
  href?: string;
}) {
  const body = (
    <>
      <div className="sa-stat-top">
        <span className="sa-stat-label">{label}</span>
        <span className="sa-stat-icon" data-tone={tone}>
          <TileIcon name={icon} />
        </span>
      </div>
      <p className="sa-stat-value">{value}</p>
      <span className="sa-stat-meta">
        {change ? (
          <span className="sa-stat-delta" data-tone={pctTone(change)}>
            {pctLabel(change)}
          </span>
        ) : null}
        {meta}
      </span>
    </>
  );

  if (!href) return <div className="sa-stat">{body}</div>;
  return (
    <Link className="sa-stat" href={href}>
      {body}
    </Link>
  );
}

function Breakdown({
  items,
}: {
  items: Array<{ label: string; value: number; display: string; tone?: string }>;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="sa-funnel">
      {items.map((item) => (
        <div className="sa-funnel-row" key={item.label}>
          <span className="sa-funnel-label" title={item.label}>
            {item.label}
          </span>
          <span className="sa-funnel-track">
            <span
              className="sa-funnel-fill"
              data-tone={item.tone}
              style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 3 : 0)}%` }}
            />
          </span>
          <span className="sa-funnel-value">{item.display}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="sa-panel">
      <div className="sa-panel-head">
        <div>
          <h2 className="sa-panel-title">{title}</h2>
          {subtitle ? <p className="sa-panel-sub">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="sa-panel-body">{children}</div>
    </section>
  );
}

function SalesTab({ data, range }: { data: SalesAnalytics; range: RangeKey }) {
  const channelItems = data.channels.map((channel, index) => ({
    label: channel.channel === 'pos' ? 'Point of sale' : 'Online store',
    value: channel.revenuePaise,
    display: formatPaise(channel.revenuePaise),
    tone: index === 0 ? undefined : 'violet',
  }));

  return (
    <>
      <div className="sa-stat-grid">
        <StatCard
          label="Revenue"
          value={formatPaise(data.revenue.current)}
          meta={`vs ${formatPaise(data.revenue.previous)} previous`}
          icon="chart"
          tone="blue"
          change={data.revenue}
        />
        <StatCard
          label="Captured orders"
          value={data.orders.current.toLocaleString('en-IN')}
          meta={`${data.refundedOrders} refunded`}
          icon="orders"
          tone="violet"
          change={data.orders}
          href="/store-admin/orders"
        />
        <StatCard
          label="Average order value"
          value={formatPaise(data.aov.current)}
          meta={`vs ${formatPaise(data.aov.previous)} previous`}
          icon="card"
          tone="green"
          change={data.aov}
        />
        <StatCard
          label="Units sold"
          value={data.units.toLocaleString('en-IN')}
          meta={`${data.productCount} product${data.productCount === 1 ? '' : 's'}`}
          icon="box"
          tone="amber"
        />
      </div>

      <div className="sa-dash-grid">
        <Panel
          title="Revenue over time"
          subtitle={`Paid orders, ${rangeLabel(range).toLowerCase()}.`}
          action={
            <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/orders">
              View orders
            </Link>
          }
        >
          <OverviewChart
            points={data.series.map((point) => ({ label: point.label, value: point.revenuePaise }))}
            ariaLabel={`Revenue by ${range === '12m' ? 'month' : 'day'} for ${rangeLabel(range)}`}
          />
        </Panel>

        <Panel
          title="Sales by category"
          subtitle="Share of paid revenue in this period."
        >
          {data.categories.length > 0 ? (
            <Breakdown
              items={data.categories.map((category, index) => ({
                label: category.name,
                value: category.revenuePaise,
                display: formatPaise(category.revenuePaise),
                tone: ['', 'violet', 'green', 'amber', ''][index % 5] || undefined,
              }))}
            />
          ) : (
            <p className="sa-empty">No paid order lines in this period.</p>
          )}
        </Panel>
      </div>

      <div className="sa-dash-grid">
        <Panel title="Top products" subtitle="Ranked by paid revenue in this period.">
          {data.topProducts.length > 0 ? (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="sa-num">Units</th>
                    <th className="sa-num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((product, index) => (
                    <tr key={product.productId || product.name}>
                      <td>
                        <Link
                          className="sa-product-link"
                          href={`/store-admin/products/${encodeURIComponent(product.productId)}`}
                        >
                          {product.name}
                        </Link>
                        <span className="sa-row-sub">Rank #{index + 1}</span>
                      </td>
                      <td className="sa-num">{product.units}</td>
                      <td className="sa-num">
                        <span className="sa-price">{formatPaise(product.revenuePaise)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sa-empty">No product revenue in this period.</p>
          )}
        </Panel>

        <Panel title="Channel mix" subtitle="Where the paid revenue came from.">
          {channelItems.length > 0 ? (
            <>
              <Breakdown items={channelItems} />
              <p className="sa-panel-foot">
                {data.channels.reduce((sum, channel) => sum + channel.orders, 0)} paid orders across{' '}
                {data.channels.length} channel{data.channels.length === 1 ? '' : 's'}.
              </p>
            </>
          ) : (
            <p className="sa-empty">No paid orders in this period.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function UsersTab({ data, range }: { data: UsersAnalytics; range: RangeKey }) {
  const repeatRate = data.buyers > 0 ? (data.repeatBuyers / data.buyers) * 100 : 0;
  const mixTotal = data.registeredOrders + data.guestOrders;

  return (
    <>
      <div className="sa-stat-grid">
        <StatCard
          label="New customers"
          value={data.newUsers.current.toLocaleString('en-IN')}
          meta={`vs ${data.newUsers.previous} previous`}
          icon="users"
          tone="blue"
          change={data.newUsers}
          href="/store-admin/customers"
        />
        <StatCard
          label="Active buyers"
          value={data.buyers.toLocaleString('en-IN')}
          meta={`${data.repeatBuyers} bought more than once`}
          icon="orders"
          tone="violet"
          href="/store-admin/customers"
        />
        <StatCard
          label="Repeat rate"
          value={`${repeatRate.toFixed(1)}%`}
          meta="Buyers with two or more paid orders"
          icon="rotate"
          tone="green"
        />
        <StatCard
          label="Signed-in sessions"
          value={data.sessions.current.toLocaleString('en-IN')}
          meta={`vs ${data.sessions.previous} previous`}
          icon="register"
          tone="amber"
          change={data.sessions}
        />
      </div>

      <div className="sa-dash-grid">
        <Panel
          title="New customers"
          subtitle={`Account signups, ${rangeLabel(range).toLowerCase()}.`}
          action={
            <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/customers">
              View customers
            </Link>
          }
        >
          <OverviewChart
            points={data.series.map((point) => ({ label: point.label, value: point.signups }))}
            ariaLabel={`New customer signups by ${range === '12m' ? 'month' : 'day'}`}
            unit="count"
          />
        </Panel>

        <Panel title="Checkout mix" subtitle="Registered accounts versus guest checkout.">
          {mixTotal > 0 ? (
            <>
              <Breakdown
                items={[
                  {
                    label: 'Registered',
                    value: data.registeredOrders,
                    display: `${data.registeredOrders}`,
                    tone: 'green',
                  },
                  {
                    label: 'Guest',
                    value: data.guestOrders,
                    display: `${data.guestOrders}`,
                    tone: 'amber',
                  },
                ]}
              />
              <p className="sa-panel-foot">
                {data.registeredBuyers} signed-in buyer
                {data.registeredBuyers === 1 ? '' : 's'} in this period.
              </p>
            </>
          ) : (
            <p className="sa-empty">No paid orders in this period.</p>
          )}
        </Panel>
      </div>

      <Panel title="Top customers" subtitle="Ranked by paid revenue in this period.">
        {data.topCustomers.length > 0 ? (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="sa-num">Orders</th>
                  <th className="sa-num">Revenue</th>
                  <th>Last order</th>
                </tr>
              </thead>
              <tbody>
                {data.topCustomers.map((customer) => (
                  <tr key={`${customer.emailMasked}-${customer.name}`}>
                    <td>
                      {customer.name}
                      <span className="sa-row-sub">{customer.emailMasked}</span>
                    </td>
                    <td className="sa-num">{customer.orders}</td>
                    <td className="sa-num">
                      <span className="sa-price">{formatPaise(customer.revenuePaise)}</span>
                    </td>
                    <td className="sa-date">
                      {customer.lastOrderAt
                        ? new Date(customer.lastOrderAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sa-empty">No customer revenue in this period.</p>
        )}
      </Panel>
    </>
  );
}

function TransactionsTab({
  data,
  range,
}: {
  data: TransactionsAnalytics;
  range: RangeKey;
}) {
  const methodItems = data.methods.map((method, index) => ({
    label: method.method.replace(/_/g, ' '),
    value: method.amountPaise,
    display: formatPaise(method.amountPaise),
    tone: ['', 'violet', 'green', 'amber', 'rose'][index % 5] || undefined,
  }));

  return (
    <>
      <div className="sa-stat-grid">
        <StatCard
          label="Captured payments"
          value={data.captured.current.toLocaleString('en-IN')}
          meta={`vs ${data.captured.previous} previous`}
          icon="card"
          tone="green"
          change={data.captured}
          href="/store-admin/orders"
        />
        <StatCard
          label="Failed payments"
          value={data.failed.toLocaleString('en-IN')}
          meta="Provider declined or errored"
          icon="alert"
          tone="rose"
        />
        <StatCard
          label="Pending"
          value={data.pending.toLocaleString('en-IN')}
          meta="Created or awaiting confirmation"
          icon="inbox"
          tone="amber"
        />
        <StatCard
          label="Refunded orders"
          value={data.refundedOrders.toLocaleString('en-IN')}
          meta="Full refunds in this period"
          icon="rotate"
          tone="violet"
        />
      </div>

      <div className="sa-dash-grid">
        <Panel
          title="Payment outcomes"
          subtitle={`Every order created in ${rangeLabel(range).toLowerCase()}, by status.`}
        >
          {data.statuses.length > 0 ? (
            <div className="sa-table-wrap">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="sa-num">Count</th>
                    <th className="sa-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.statuses.map((bucket) => (
                    <tr key={bucket.status}>
                      <td>
                        <span
                          className={
                            bucket.status === 'PAID'
                              ? 'sa-status sa-status-on'
                              : bucket.status === 'FAILED' || bucket.status === 'CANCELLED'
                                ? 'sa-status sa-status-danger'
                                : 'sa-status'
                          }
                        >
                          {STATUS_LABELS[bucket.status] ?? bucket.status}
                        </span>
                      </td>
                      <td className="sa-num">{bucket.count}</td>
                      <td className="sa-num">
                        <span className="sa-price">{formatPaise(bucket.amountPaise)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sa-empty">No transactions in this period.</p>
          )}
        </Panel>

        <Panel title="Payment methods" subtitle="Captured revenue by method.">
          {methodItems.length > 0 ? (
            <Breakdown items={methodItems} />
          ) : (
            <p className="sa-empty">No captured payments in this period.</p>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent transactions"
        subtitle="The newest orders in the selected period, any status."
        action={
          <div className="sa-page-actions">
            <Link
              className="sa-btn sa-btn-quiet sa-btn-small"
              href={`/api/store-admin/transactions/export?range=${range}`}
            >
              Export CSV
            </Link>
            <Link className="sa-btn sa-btn-quiet sa-btn-small" href="/store-admin/orders">
              All orders
            </Link>
          </div>
        }
      >
        {data.recent.length > 0 ? (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Customer</th>
                  <th>Channel</th>
                  <th className="sa-num">Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((transaction) => (
                  <tr key={transaction.txnid}>
                    <td>
                      <Link
                        className="sa-product-link sa-mono"
                        href={`/store-admin/orders/${encodeURIComponent(transaction.txnid)}`}
                      >
                        {transaction.txnid}
                      </Link>
                    </td>
                    <td>
                      {transaction.customerNameMasked}
                      <span className="sa-row-sub">{transaction.customerEmailMasked}</span>
                    </td>
                    <td>{transaction.channel === 'pos' ? 'POS' : 'Web'}</td>
                    <td className="sa-num">
                      <span className="sa-price">{formatPaise(transaction.amountPaise)}</span>
                    </td>
                    <td>
                      <span
                        className={
                          transaction.status === 'PAID'
                            ? 'sa-status sa-status-on'
                            : transaction.status === 'FAILED'
                              ? 'sa-status sa-status-danger'
                              : 'sa-status'
                        }
                      >
                        {STATUS_LABELS[transaction.status] ?? transaction.status}
                      </span>
                    </td>
                    <td className="sa-date">
                      {transaction.createdAt
                        ? new Date(transaction.createdAt).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sa-empty">No transactions in this period.</p>
        )}
      </Panel>
    </>
  );
}

export default async function StoreAdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string }>;
}) {
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const range = parseRange(params.range);

  const session = await getStoreSession();
  const sales = tab === 'sales' ? await getSalesAnalytics(range) : null;
  const users = tab === 'users' ? await getUsersAnalytics(range) : null;
  const transactions =
    tab === 'transactions' ? await getTransactionsAnalytics(range) : null;

  const firstName = (session?.name || '').trim().split(/\s+/)[0] || 'there';
  const roleLabel = session?.role === 'store_owner'
    ? 'Owner'
    : session?.role === 'store_admin'
      ? 'Admin'
      : 'Viewer';

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <div>
      <section className="sa-hero">
        <div className="sa-hero-copy">
          <p className="sa-hero-eyebrow">
            <span className="sa-status-chip">Live data</span>
            {today}
          </p>
          <h1 className="sa-hero-title">Welcome back, {firstName}.</h1>
          <p className="sa-hero-sub">
            {roleLabel} view of sales, customers and payments. Every figure below uses the
            same paid-order rules as the order lists.
          </p>
        </div>
        <div className="sa-hero-actions">
          <Link className="sa-btn sa-btn-primary" href="/store-admin/orders">
            Review orders
            <TileIcon name="arrow" size={16} />
          </Link>
          <Link className="sa-btn sa-btn-ghost" href="/store-admin/pos">
            Open point of sale
          </Link>
        </div>
      </section>

      <div className="sa-overview-bar">
        <nav className="sa-tabs" aria-label="Overview dashboards">
          {TABS.map((entry) => (
            <Link
              key={entry.key}
              className={`sa-tab${tab === entry.key ? ' is-active' : ''}`}
              href={overviewHref(entry.key, range)}
              aria-current={tab === entry.key ? 'page' : undefined}
              title={entry.note}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <div className="sa-range" aria-label="Dashboard period">
          <span className="sa-range-label">Period</span>
          {RANGE_KEYS.map((key) => (
            <Link
              key={key}
              className={`sa-range-option${range === key ? ' is-active' : ''}`}
              href={overviewHref(tab, key)}
              aria-current={range === key ? 'page' : undefined}
            >
              {RANGE_SHORT[key]}
            </Link>
          ))}
        </div>
      </div>

      <p className="sa-overview-note">
        Comparing {rangeLabel(range).toLowerCase()} with the equal-length period before it.
      </p>

      {sales && !sales.ok ? (
        <p className="sa-notice">Sales analytics are unavailable. Check the database connection.</p>
      ) : null}
      {sales && sales.ok ? <SalesTab data={sales.data} range={range} /> : null}

      {users && !users.ok ? (
        <p className="sa-notice">Customer analytics are unavailable. Check the database connection.</p>
      ) : null}
      {users && users.ok ? <UsersTab data={users.data} range={range} /> : null}

      {transactions && !transactions.ok ? (
        <p className="sa-notice">
          Transaction analytics are unavailable. Check the database connection.
        </p>
      ) : null}
      {transactions && transactions.ok ? (
        <TransactionsTab data={transactions.data} range={range} />
      ) : null}

      <p className="sa-readonly-foot">
        Price editing is disabled until every payment path reads prices from the database.
      </p>
    </div>
  );
}
