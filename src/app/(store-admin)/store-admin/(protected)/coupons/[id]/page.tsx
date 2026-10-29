import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CouponActions } from '@/components/store-admin/CouponActions';
import { CouponForm, type CouponFormValues } from '@/components/store-admin/CouponForm';
import { formatPaise } from '@/lib/store-admin/amount';
import { listBrands, listCategoryOptions } from '@/lib/store-admin/catalog';
import {
  couponScopeLabel,
  couponValueLabel,
} from '@/lib/store-admin/coupon-rules';
import { getCoupon, listCouponProductOptions } from '@/lib/store-admin/coupons';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const TONE: Record<string, string | undefined> = {
  active: undefined,
  scheduled: 'warn',
  paused: 'warn',
  expired: 'danger',
  'used-up': 'danger',
  archived: 'danger',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function stateLabel(state: string): string {
  if (state === 'CONSUMED') return 'Used';
  if (state === 'RESERVED') return 'Held at checkout';
  if (state === 'RELEASED') return 'Released';
  return state;
}

/**
 * One coupon: rules, computed totals, every redemption and the edit form.
 *
 * Archived coupons render read-only; the record and its usage stay forever.
 */
export default async function StoreAdminCouponPage({ params }: Props) {
  const { id } = await params;
  const [result, products, categories, brands] = await Promise.all([
    getCoupon(id),
    listCouponProductOptions(),
    listCategoryOptions(),
    listBrands(),
  ]);

  if (!result.ok) {
    if (result.reason === 'not-found') notFound();
    return (
      <div>
        <Link className="sa-back" href="/store-admin/coupons">← Coupons</Link>
        <p className="sa-notice">Coupons could not be read. Check the database connection.</p>
      </div>
    );
  }

  const { coupon, targets, usage, totals } = result.data;
  const remaining =
    coupon.totalRedemptionLimit === null
      ? null
      : Math.max(0, coupon.totalRedemptionLimit - totals.used);

  const formValues: CouponFormValues = {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    description: coupon.description,
    type: coupon.type,
    value: coupon.value,
    scope: coupon.scope,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    totalRedemptionLimit: coupon.totalRedemptionLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    minOrderPaise: coupon.minOrderPaise,
    maxDiscountPaise: coupon.maxDiscountPaise,
    onlyNewCustomers: coupon.onlyNewCustomers,
    allowWithSalePrice: coupon.allowWithSalePrice,
    allowedCustomerGroups: coupon.allowedCustomerGroups,
    restrictedToEmails: coupon.restrictedToEmails,
    targets,
  };

  return (
    <div>
      <Link className="sa-back" href="/store-admin/coupons">← Coupons</Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">{coupon.code}</h1>
          <p className="sa-page-sub">
            {coupon.name || 'No internal name'} · {couponValueLabel(coupon.type, coupon.value)}
            {' · '}
            {couponScopeLabel(coupon.scope)}
          </p>
        </div>
        <CouponActions couponId={coupon.id} status={coupon.status} />
      </div>

      <div className="sa-inline-actions">
        <span className="sa-status-chip" data-tone={TONE[coupon.badge.tone]}>
          {coupon.badge.label}
        </span>
        <span className="sa-hint">
          Starts {formatDate(coupon.startsAt)} · Ends {formatDate(coupon.endsAt)}
        </span>
      </div>

      <div className="sa-stat-row">
        <div className="sa-stat">
          <span className="sa-stat-label">Used</span>
          <strong className="sa-stat-value">
            {totals.used}
            {coupon.totalRedemptionLimit === null ? '' : ` / ${coupon.totalRedemptionLimit}`}
          </strong>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Remaining</span>
          <strong className="sa-stat-value">{remaining === null ? 'Unlimited' : remaining}</strong>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Discount given</span>
          <strong className="sa-stat-value">{formatPaise(totals.totalDiscountPaise)}</strong>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Order revenue</span>
          <strong className="sa-stat-value">{formatPaise(totals.revenuePaise)}</strong>
        </div>
      </div>

      <p className="sa-hint">
        Used counts held and paid redemptions. Discount and revenue count paid ones only. Order
        revenue is already net of the discount. Released uses are shown below but do not count
        against a limit.
      </p>

      {coupon.status !== 'archived' ? (
        <CouponForm
          coupon={formValues}
          products={products.ok ? products.data : []}
          categories={
            categories.ok
              ? categories.data.map((category) => ({ id: category.id, name: category.name }))
              : []
          }
          brands={
            brands.ok
              ? brands.data
                  .filter((brand) => brand.deletedAt === null)
                  .map((brand) => ({ id: brand.id, name: brand.name }))
              : []
          }
        />
      ) : (
        <section className="sa-detail-card">
          <div className="sa-detail-head">
            <h2>Archived</h2>
          </div>
          <p className="sa-note">
            This coupon can no longer be edited or used. Duplicate it to start a new code with
            the same rules.
          </p>
        </section>
      )}

      {targets.length > 0 ? (
        <section className="sa-detail-card">
          <div className="sa-detail-head">
            <h2>Applies to</h2>
          </div>
          <ul className="sa-plain-list">
            {targets.map((target) => (
              <li key={`${target.productId ?? target.categoryId ?? target.brandId}`}>
                {target.label || target.productId || target.categoryId || target.brandId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Usage</h2>
          <span className="sa-hint">
            {totals.reserved} held · {totals.consumed} paid · {totals.released} released
          </span>
        </div>

        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th className="sa-num">Discount</th>
                <th className="sa-num">Order total</th>
                <th>State</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {usage.length === 0 ? (
                <tr>
                  <td className="sa-empty" colSpan={6}>
                    No one has used this code yet.
                  </td>
                </tr>
              ) : (
                usage.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Link
                        className="sa-product-link"
                        href={`/store-admin/orders/${encodeURIComponent(entry.txnid)}`}
                      >
                        {entry.orderNumber}
                      </Link>
                    </td>
                    <td>{entry.customer}</td>
                    <td className="sa-num">{formatPaise(entry.discountPaise)}</td>
                    <td className="sa-num">{formatPaise(entry.orderTotalPaise)}</td>
                    <td>
                      {stateLabel(entry.state)}
                      {entry.state === 'RELEASED' && entry.releaseReason ? (
                        <div className="sa-hint">{entry.releaseReason}</div>
                      ) : null}
                    </td>
                    <td>{formatDate(entry.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
