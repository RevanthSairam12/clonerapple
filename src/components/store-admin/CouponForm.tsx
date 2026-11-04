'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import {
  CUSTOMER_GROUP_LABELS,
  CUSTOMER_GROUPS,
} from '@/lib/store-admin/customer-rules';
import { generateCouponCode } from '@/lib/coupons/codes';
import {
  COUPON_CODE_HINT,
  COUPON_DESCRIPTION_LIMIT,
  COUPON_NAME_LIMIT,
} from '@/lib/store-admin/coupon-rules';

/**
 * Create, edit or bulk-generate coupons.
 *
 * The parser on the server is the authority; this form only mirrors its field
 * set so a typo is caught without a round trip. Money is typed in rupees and
 * converted to paise by the server's shared parser. Datetimes are converted
 * from the browser's local `datetime-local` value to an ISO instant, so the
 * stored window is unambiguous and compared on the database clock.
 */

export interface CouponTargetValue {
  productId: string | null;
  categoryId: string | null;
  brandId: string | null;
}

export interface CouponFormValues {
  id: string;
  code: string;
  name: string;
  description: string;
  type: string;
  value: number;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  totalRedemptionLimit: number | null;
  perCustomerLimit: number | null;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  onlyNewCustomers: boolean;
  allowWithSalePrice: boolean;
  allowedCustomerGroups: string[] | null;
  restrictedToEmails: string[] | null;
  showToAllUsers: boolean;
  assignedToEmails: string[];
  assignedCustomerGroups: string[];
  targets: CouponTargetValue[];
}

interface ProductOption {
  id: string;
  name: string;
  categoryName: string;
}

interface NamedOption {
  id: string;
  name: string;
}

interface Props {
  products: ProductOption[];
  categories: NamedOption[];
  brands: NamedOption[];
  coupon?: CouponFormValues;
  readOnly?: boolean;
}

type Mode = 'single' | 'bulk';

function rupees(paise: number | null): string {
  return paise === null ? '' : (paise / 100).toFixed(2);
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function initialValue(coupon: CouponFormValues | undefined): string {
  if (!coupon) return '';
  if (coupon.type === 'PERCENT') return String(coupon.value);
  if (coupon.type === 'FIXED') return rupees(coupon.value);
  return '';
}

function targetIds(coupon: CouponFormValues | undefined, key: keyof CouponTargetValue): string[] {
  if (!coupon) return [];
  return coupon.targets
    .map((target) => target[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function CouponForm({ products, categories, brands, coupon, readOnly = false }: Props) {
  const router = useRouter();
  const editing = Boolean(coupon);

  const [mode, setMode] = useState<Mode>('single');
  const [code, setCode] = useState(coupon?.code ?? '');
  const [name, setName] = useState(coupon?.name ?? '');
  const [description, setDescription] = useState(coupon?.description ?? '');
  const [type, setType] = useState(coupon?.type ?? 'PERCENT');
  const [value, setValue] = useState(initialValue(coupon));
  const [scope, setScope] = useState(coupon?.scope ?? 'ORDER');
  const [startsAt, setStartsAt] = useState(toLocalInput(coupon?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(coupon?.endsAt ?? null));
  const [totalLimit, setTotalLimit] = useState(
    coupon?.totalRedemptionLimit === null || coupon?.totalRedemptionLimit === undefined
      ? ''
      : String(coupon.totalRedemptionLimit),
  );
  const [perCustomerLimit, setPerCustomerLimit] = useState(
    coupon?.perCustomerLimit === null || coupon?.perCustomerLimit === undefined
      ? ''
      : String(coupon.perCustomerLimit),
  );
  const [minOrder, setMinOrder] = useState(rupees(coupon?.minOrderPaise ?? 0));
  const [maxDiscount, setMaxDiscount] = useState(rupees(coupon?.maxDiscountPaise ?? null));
  const [onlyNewCustomers, setOnlyNewCustomers] = useState(coupon?.onlyNewCustomers ?? false);
  const [allowWithSalePrice, setAllowWithSalePrice] = useState(
    coupon?.allowWithSalePrice ?? false,
  );
  const [groups, setGroups] = useState<string[]>(coupon?.allowedCustomerGroups ?? []);
  const [emails, setEmails] = useState((coupon?.restrictedToEmails ?? []).join('\n'));
  const [showToAllUsers, setShowToAllUsers] = useState(coupon?.showToAllUsers ?? false);
  const [assignedToEmails, setAssignedToEmails] = useState((coupon?.assignedToEmails ?? []).join('\n'));
  const [assignedCustomerGroups, setAssignedCustomerGroups] = useState<string[]>(
    coupon?.assignedCustomerGroups ?? [],
  );

  const [productIds, setProductIds] = useState<string[]>(targetIds(coupon, 'productId'));
  const [categoryIds, setCategoryIds] = useState<string[]>(targetIds(coupon, 'categoryId'));
  const [brandIds, setBrandIds] = useState<string[]>(targetIds(coupon, 'brandId'));

  const [bulkCount, setBulkCount] = useState('10');
  const [bulkPrefix, setBulkPrefix] = useState('GZ');
  const [bulkLength, setBulkLength] = useState('8');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string[] | null>(null);

  const valueLabel = useMemo(() => {
    if (type === 'PERCENT') return 'Percent off';
    if (type === 'FIXED') return 'Rupees off';
    return 'Free shipping';
  }, [type]);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  }

  function toggleGroup(group: string) {
    setGroups((current) => toggle(current, group));
  }

  function payload(): Record<string, unknown> {
    return {
      code,
      name,
      description,
      type,
      value,
      scope,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      totalRedemptionLimit: totalLimit,
      perCustomerLimit,
      minOrderRupees: minOrder,
      maxDiscountRupees: maxDiscount,
      onlyNewCustomers,
      allowWithSalePrice,
      showToAllUsers,
      assignedToEmails: assignedToEmails
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
      assignedCustomerGroups,
      allowedCustomerGroups: groups,
      restrictedToEmails: emails
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
      productIds,
      categoryIds,
      brandIds,
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || readOnly) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const isBulk = !editing && mode === 'bulk';
      const response = await fetch(
        isBulk
          ? '/api/store-admin/coupons/bulk'
          : editing
            ? `/api/store-admin/coupons/${encodeURIComponent(coupon!.id)}`
            : '/api/store-admin/coupons',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isBulk
              ? {
                  ...payload(),
                  count: bulkCount,
                  prefix: bulkPrefix,
                  length: bulkLength,
                }
              : payload(),
          ),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { coupon?: { id: string }; codes?: string[]; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error || 'The coupon could not be saved.');
        return;
      }

      if (isBulk) {
        setGenerated(body?.codes ?? []);
        return;
      }

      if (editing) {
        setMessage('Saved.');
        router.refresh();
      } else if (body?.coupon?.id) {
        router.push(`/store-admin/coupons/${encodeURIComponent(body.coupon.id)}`);
        router.refresh();
      }
    } catch {
      setError('The coupon could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function downloadCodes(codes: string[]) {
    const rows = ['Code', ...codes].join('\r\n');
    const blob = new Blob([`﻿${rows}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gadzio-coupon-codes.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  if (generated) {
    return (
      <div className="sa-control-card">
        <h2 className="sa-control-title">{generated.length} single-use codes generated</h2>
        <p className="sa-card-note">
          Each code works once in total and once per customer. They are active as soon as they
          leave this screen.
        </p>
        <textarea className="sa-input" readOnly rows={Math.min(16, generated.length + 1)} value={generated.join('\n')} />
        <div className="sa-inline-actions">
          <button
            className="sa-btn sa-btn-primary"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(generated.join('\n'));
            }}
          >
            Copy all
          </button>
          <button
            className="sa-btn sa-btn-quiet"
            type="button"
            onClick={() => downloadCodes(generated)}
          >
            Download CSV
          </button>
          <a className="sa-btn sa-btn-quiet" href="/store-admin/coupons">
            Back to coupons
          </a>
        </div>
      </div>
    );
  }

  return (
    <form className="sa-control-card" onSubmit={submit}>
      <h2 className="sa-control-title">
        {readOnly ? 'Coupon rules (read-only)' : editing ? 'Edit coupon' : mode === 'bulk' ? 'Generate a batch' : 'New coupon'}
      </h2>
      {readOnly ? <p className="sa-lock-note">A viewer cannot change coupons.</p> : null}
      <fieldset
        disabled={readOnly || busy}
        aria-label={readOnly ? 'Saved coupon settings' : 'Coupon settings'}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >

      {!editing ? (
        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-mode">Create</label>
          <select
            id="coupon-mode"
            className="sa-input"
            value={mode}
            onChange={(event) => setMode(event.target.value === 'bulk' ? 'bulk' : 'single')}
          >
            <option value="single">One code</option>
            <option value="bulk">A batch of single-use codes</option>
          </select>
          <p className="sa-hint">
            {mode === 'bulk'
              ? 'Every code in the batch is capped at one use overall and one per customer.'
              : 'The code takes effect immediately unless a start date is set.'}
          </p>
        </div>
      ) : null}

      {mode === 'single' || editing ? (
        <div className="sa-control-grid">
          <div className="sa-field">
            <label className="sa-label" htmlFor="coupon-code">Code</label>
            <div className="sa-inline-actions">
              <input
                id="coupon-code"
                className="sa-input"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                maxLength={32}
                required
                placeholder="WELCOME10"
              />
              <button
                className="sa-btn sa-btn-quiet sa-btn-small"
                type="button"
                onClick={() => setCode(generateCouponCode('GZ', 8))}
              >
                Generate
              </button>
            </div>
            <p className="sa-hint">{COUPON_CODE_HINT}</p>
          </div>

          <div className="sa-field">
            <label className="sa-label" htmlFor="coupon-name">Name</label>
            <input
              id="coupon-name"
              className="sa-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={COUPON_NAME_LIMIT}
              placeholder="Welcome discount"
            />
            <p className="sa-hint">Internal label; customers see the code.</p>
          </div>
        </div>
      ) : (
        <div className="sa-control-grid">
          <div className="sa-field">
            <label className="sa-label" htmlFor="bulk-prefix">Code prefix</label>
            <input
              id="bulk-prefix"
              className="sa-input"
              value={bulkPrefix}
              onChange={(event) => setBulkPrefix(event.target.value.toUpperCase())}
              maxLength={12}
            />
            <p className="sa-hint">Codes read like {bulkPrefix || 'GZ'}-K7M2P9QX.</p>
          </div>
          <div className="sa-field">
            <label className="sa-label" htmlFor="bulk-count">How many</label>
            <input
              id="bulk-count"
              className="sa-input"
              inputMode="numeric"
              value={bulkCount}
              onChange={(event) => setBulkCount(event.target.value)}
              required
            />
            <p className="sa-hint">Between 1 and 500.</p>
          </div>
          <div className="sa-field">
            <label className="sa-label" htmlFor="bulk-length">Characters after the prefix</label>
            <input
              id="bulk-length"
              className="sa-input"
              inputMode="numeric"
              value={bulkLength}
              onChange={(event) => setBulkLength(event.target.value)}
            />
            <p className="sa-hint">6 to 16. Longer is harder to guess.</p>
          </div>
        </div>
      )}

      <div className="sa-control-grid">
        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-type">Discount type</label>
          <select
            id="coupon-type"
            className="sa-input"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setValue('');
            }}
          >
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed rupees off</option>
            <option value="FREE_SHIPPING">Free shipping</option>
          </select>
        </div>

        {type !== 'FREE_SHIPPING' ? (
          <div className="sa-field">
            <label className="sa-label" htmlFor="coupon-value">{valueLabel}</label>
            <input
              id="coupon-value"
              className="sa-input"
              inputMode={type === 'PERCENT' ? 'numeric' : 'decimal'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
              placeholder={type === 'PERCENT' ? '10' : '250.00'}
            />
            <p className="sa-hint">
              {type === 'PERCENT'
                ? 'A whole number from 1 to 100.'
                : 'Rupees and paise, at most two decimals.'}
            </p>
          </div>
        ) : null}

        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-scope">Applies to</label>
          <select
            id="coupon-scope"
            className="sa-input"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="ORDER">The whole order</option>
            <option value="PRODUCTS">Selected products</option>
            <option value="CATEGORIES">Selected categories</option>
            <option value="BRANDS">Selected brands</option>
          </select>
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-min-order">Minimum order ₹</label>
          <input
            id="coupon-min-order"
            className="sa-input"
            inputMode="decimal"
            value={minOrder}
            onChange={(event) => setMinOrder(event.target.value)}
            placeholder="0.00"
          />
          <p className="sa-hint">Checked against the cart after sale prices, before discount.</p>
        </div>

        {type === 'PERCENT' ? (
          <div className="sa-field">
            <label className="sa-label" htmlFor="coupon-max-discount">Maximum discount ₹</label>
            <input
              id="coupon-max-discount"
              className="sa-input"
              inputMode="decimal"
              value={maxDiscount}
              onChange={(event) => setMaxDiscount(event.target.value)}
              placeholder="Leave blank for no cap"
            />
          </div>
        ) : null}

        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-total-limit">Total uses</label>
          <input
            id="coupon-total-limit"
            className="sa-input"
            inputMode="numeric"
            value={totalLimit}
            onChange={(event) => setTotalLimit(event.target.value)}
            placeholder="Unlimited"
          />
          <p className="sa-hint">Leave blank for no overall limit.</p>
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-per-customer">Uses per customer</label>
          <input
            id="coupon-per-customer"
            className="sa-input"
            inputMode="numeric"
            value={perCustomerLimit}
            onChange={(event) => setPerCustomerLimit(event.target.value)}
            placeholder="Unlimited"
          />
          <p className="sa-hint">Guests are counted by the normalized email on the order.</p>
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-starts">Starts</label>
          <input
            id="coupon-starts"
            className="sa-input"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <p className="sa-hint">Blank means active immediately.</p>
        </div>

        <div className="sa-field">
          <label className="sa-label" htmlFor="coupon-ends">Ends</label>
          <input
            id="coupon-ends"
            className="sa-input"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          <p className="sa-hint">Blank means it never expires.</p>
        </div>
      </div>

      <fieldset className="sa-field sa-edit-fieldset" aria-describedby="coupon-visibility-help">
        <legend className="sa-label">Customer discovery</legend>
        <label className="sa-hint" htmlFor="coupon-show-to-all">
          <input
            id="coupon-show-to-all"
            type="checkbox"
            aria-describedby="coupon-visibility-help"
            checked={showToAllUsers}
            onChange={(event) => setShowToAllUsers(event.target.checked)}
          />{' '}
          Show to all users
        </label>
        <p className="sa-hint" id="coupon-visibility-help">
          Visibility controls discovery, not redemption. A hidden coupon can still be redeemed
          by anyone with its code unless customer restrictions apply. Assignments make the
          coupon discoverable; they do not override redemption restrictions. Hidden means not
          public: assigned eligible customers may still see it.
        </p>
        <p className="sa-hint">
          Off by default for new coupons and generated codes. When enabled, all eligible
          signed-in customers can discover the coupon, subject to its status, dates and limits.
        </p>
        <div className="sa-control-grid">
          <div className="sa-field">
            <label className="sa-label" htmlFor="coupon-assigned-emails">
              Assign discovery to email addresses
            </label>
            <textarea
              id="coupon-assigned-emails"
              className="sa-input"
              rows={3}
              value={assignedToEmails}
              onChange={(event) => setAssignedToEmails(event.target.value)}
              aria-describedby="coupon-assigned-emails-help"
              placeholder="customer@example.com"
            />
            <p className="sa-hint" id="coupon-assigned-emails-help">
              One per line, or separated by commas. Eligible customers with these account
              emails can discover the coupon even when it is hidden. Leave blank for no email
              assignments.
            </p>
          </div>
          <fieldset className="sa-field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="sa-label">Assign discovery to customer groups</legend>
            {CUSTOMER_GROUPS.map((group) => (
              <label className="sa-hint" key={group}>
                <input
                  type="checkbox"
                  checked={assignedCustomerGroups.includes(group)}
                  onChange={() => setAssignedCustomerGroups((current) => toggle(current, group))}
                  aria-label={`Assign discovery to ${CUSTOMER_GROUP_LABELS[group]}`}
                />{' '}
                {CUSTOMER_GROUP_LABELS[group]}
              </label>
            ))}
            <p className="sa-hint">
              Eligible members of any selected group can discover the coupon. No group selected
              means no group assignments, not public visibility.
            </p>
          </fieldset>
        </div>
      </fieldset>

      <div className="sa-control-grid">
        <div className="sa-field sa-field-wide">
          <label className="sa-label" htmlFor="coupon-description">Description</label>
          <textarea
            id="coupon-description"
            className="sa-input"
            rows={2}
            maxLength={COUPON_DESCRIPTION_LIMIT}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Shown to staff only."
          />
        </div>

        <div className="sa-field sa-field-wide">
          <label className="sa-label">Rules</label>
          <label className="sa-hint">
            <input
              type="checkbox"
              checked={onlyNewCustomers}
              onChange={(event) => setOnlyNewCustomers(event.target.checked)}
            />{' '}
            First order only — the customer must have no earlier paid order.
          </label>
          <label className="sa-hint">
            <input
              type="checkbox"
              checked={allowWithSalePrice}
              onChange={(event) => setAllowWithSalePrice(event.target.checked)}
            />{' '}
            Works on items already on sale.
          </label>
        </div>

        <div className="sa-field sa-field-wide">
          <span className="sa-label">Redemption restrictions — customer groups</span>
          {CUSTOMER_GROUPS.map((group) => (
            <label className="sa-hint" key={group}>
              <input
                type="checkbox"
                checked={groups.includes(group)}
                onChange={() => toggleGroup(group)}
              />{' '}
              {CUSTOMER_GROUP_LABELS[group]}
            </label>
          ))}
          <p className="sa-hint">
            No group ticked means no group restriction. If email restrictions are also set,
            customers must satisfy both. Discovery assignments do not change these rules.
          </p>
        </div>

        {mode === 'single' || editing ? (
          <div className="sa-field sa-field-wide">
            <label className="sa-label" htmlFor="coupon-emails">
              Restrict to these email addresses
            </label>
            <textarea
              id="coupon-emails"
              className="sa-input"
              rows={3}
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="customer@example.com"
            />
            <p className="sa-hint">
              One per line. Leave blank to let anyone use the code. Guests are matched by the
              email on the order.
            </p>
          </div>
        ) : null}
      </div>

      {scope === 'PRODUCTS' ? (
        <div className="sa-field">
          <label className="sa-label">Products ({productIds.length} selected)</label>
          <select
            className="sa-input"
            value=""
            onChange={(event) => {
              if (event.target.value) setProductIds((current) => toggle(current, event.target.value));
            }}
          >
            <option value="">Add a product…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.categoryName}
              </option>
            ))}
          </select>
          <ul className="sa-plain-list">
            {productIds.map((id) => {
              const product = products.find((entry) => entry.id === id);
              return (
                <li key={id}>
                  {product?.name ?? id}{' '}
                  <button
                    className="sa-btn sa-btn-quiet sa-btn-small"
                    type="button"
                    onClick={() => setProductIds((current) => toggle(current, id))}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {scope === 'CATEGORIES' ? (
        <div className="sa-field">
          <label className="sa-label">Categories ({categoryIds.length} selected)</label>
          {categories.map((category) => (
            <label className="sa-hint" key={category.id}>
              <input
                type="checkbox"
                checked={categoryIds.includes(category.id)}
                onChange={() => setCategoryIds((current) => toggle(current, category.id))}
              />{' '}
              {category.name}
            </label>
          ))}
        </div>
      ) : null}

      {scope === 'BRANDS' ? (
        <div className="sa-field">
          <label className="sa-label">Brands ({brandIds.length} selected)</label>
          {brands.map((brand) => (
            <label className="sa-hint" key={brand.id}>
              <input
                type="checkbox"
                checked={brandIds.includes(brand.id)}
                onChange={() => setBrandIds((current) => toggle(current, brand.id))}
              />{' '}
              {brand.name}
            </label>
          ))}
        </div>
      ) : null}

      </fieldset>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-hint" role="status">{message}</p> : null}

      <div className="sa-inline-actions">
        {!readOnly ? <button className="sa-btn sa-btn-primary" type="submit" disabled={busy}>
          {busy
            ? 'Saving…'
            : editing
              ? 'Save changes'
              : mode === 'bulk'
                ? 'Generate codes'
                : 'Create coupon'}
        </button> : null}
        <a className="sa-btn sa-btn-quiet" href="/store-admin/coupons">
          {readOnly ? 'Back to coupons' : 'Cancel'}
        </a>
      </div>
    </form>
  );
}
