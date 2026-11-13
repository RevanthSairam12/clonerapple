'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { FreeGiftsAdminDashboardData, FreeGiftAdminRuleView } from '@/lib/store-admin/free-gifts';
import { toLocalDateTimeInput } from '@/lib/store-admin/sale-admin-rules';

interface Props {
  initialData: FreeGiftsAdminDashboardData;
  canEdit: boolean;
}

interface RuleFormState {
  id: string | null;
  name: string;
  giftProductId: string;
  giftVariantId: string;
  targetRupees: string;
  iconUrl: string;
  badgeText: string;
  unlockMessage: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  showOnProductPage: boolean;
  maxGiftsTotal: string;
  perCustomerLimit: string;
  priority: string;
  couponInteraction: 'allow' | 'disallow';
  minPostCouponRupees: string;
}

function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function paiseToInput(paise: number): string {
  if (!paise) return '';
  const r = paise / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function createEmptyForm(data: FreeGiftsAdminDashboardData): RuleFormState {
  const firstProduct = data.giftProducts[0];
  return {
    id: null,
    name: '',
    giftProductId: firstProduct?.id ?? '',
    giftVariantId: firstProduct?.variants[0]?.id ?? '',
    targetRupees: '1999',
    iconUrl: '',
    badgeText: 'FREE',
    unlockMessage: 'You unlocked a free gift!',
    startsAt: '',
    endsAt: '',
    isActive: true,
    showOnProductPage: false,
    maxGiftsTotal: '',
    perCustomerLimit: '',
    priority: '0',
    couponInteraction: 'allow',
    minPostCouponRupees: '',
  };
}

function formFromRule(rule: FreeGiftAdminRuleView, timeZone: string): RuleFormState {
  return {
    id: rule.id,
    name: rule.name,
    giftProductId: rule.giftProductId,
    giftVariantId: rule.giftVariantId ?? '',
    targetRupees: paiseToInput(rule.targetPaise),
    iconUrl: rule.iconUrl,
    badgeText: rule.badgeText,
    unlockMessage: rule.unlockMessage,
    startsAt: toLocalDateTimeInput(rule.startsAt, timeZone),
    endsAt: toLocalDateTimeInput(rule.endsAt, timeZone),
    isActive: rule.isActive,
    showOnProductPage: rule.showOnProductPage,
    maxGiftsTotal: rule.maxGiftsTotal !== null ? String(rule.maxGiftsTotal) : '',
    perCustomerLimit: rule.perCustomerLimit !== null ? String(rule.perCustomerLimit) : '',
    priority: String(rule.priority),
    couponInteraction: rule.couponInteraction,
    minPostCouponRupees: paiseToInput(rule.minPostCouponPaise),
  };
}

export function FreeGiftsAdminConsole({ initialData, canEdit }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState<RuleFormState>(() => createEmptyForm(initialData));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => data.giftProducts.find((p) => p.id === form.giftProductId) ?? null,
    [data.giftProducts, form.giftProductId],
  );

  const selectedVariant = useMemo(
    () => selectedProduct?.variants.find((v) => v.id === form.giftVariantId) ?? null,
    [selectedProduct, form.giftVariantId],
  );

  const previewTargetPaise = useMemo(() => {
    const n = Number(form.targetRupees);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 199900;
  }, [form.targetRupees]);

  const previewGiftName = useMemo(() => {
    if (!selectedProduct) return 'Your free gift item';
    return selectedVariant ? `${selectedProduct.name} (${selectedVariant.label})` : selectedProduct.name;
  }, [selectedProduct, selectedVariant]);

  const previewGiftRegularPaise = selectedVariant?.pricePaise ?? selectedProduct?.pricePaise ?? 0;

  function update<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSelectProduct(productId: string) {
    const prod = data.giftProducts.find((p) => p.id === productId);
    setForm((prev) => ({
      ...prev,
      giftProductId: productId,
      giftVariantId: prod?.variants[0]?.id ?? '',
    }));
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const payload = {
        name: form.name,
        giftProductId: form.giftProductId,
        giftVariantId: form.giftVariantId || null,
        targetRupees: form.targetRupees,
        iconUrl: form.iconUrl,
        badgeText: form.badgeText,
        unlockMessage: form.unlockMessage,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        isActive: form.isActive,
        showOnProductPage: form.showOnProductPage,
        maxGiftsTotal: form.maxGiftsTotal.trim() ? Number.parseInt(form.maxGiftsTotal, 10) : null,
        perCustomerLimit: form.perCustomerLimit.trim() ? Number.parseInt(form.perCustomerLimit, 10) : null,
        priority: form.priority.trim() ? Number.parseInt(form.priority, 10) : 0,
        couponInteraction: form.couponInteraction,
        minPostCouponRupees: form.minPostCouponRupees.trim() || null,
      };

      const isEditing = Boolean(form.id);
      const url = isEditing
        ? `/api/store-admin/free-gifts/${encodeURIComponent(form.id!)}`
        : '/api/store-admin/free-gifts';

      const res = await fetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save free gift rule.');
      }

      setData(body as FreeGiftsAdminDashboardData);
      setNotice(isEditing ? 'Free gift rule updated.' : 'Free gift rule created.');
      setForm(createEmptyForm(body as FreeGiftsAdminDashboardData));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save free gift rule.');
    } finally {
      setBusy(false);
    }
  }

  async function runQuickAction(
    rule: FreeGiftAdminRuleView,
    action: 'pause' | 'resume' | 'archive' | 'reset_unavailable',
  ) {
    if (!canEdit || busy) return;
    if (action === 'archive' && !window.confirm(`Archive free gift rule "${rule.name}"? Past orders keep their snapshots.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/store-admin/free-gifts/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Action failed.');
      }
      setData(body as FreeGiftsAdminDashboardData);
      if (form.id === rule.id && action === 'archive') {
        setForm(createEmptyForm(body as FreeGiftsAdminDashboardData));
      }
      setNotice(
        action === 'pause'
          ? `Paused "${rule.name}".`
          : action === 'resume'
            ? `Resumed "${rule.name}".`
            : action === 'archive'
              ? `Archived "${rule.name}".`
              : `Cleared unavailable checkout alert count for "${rule.name}".`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem', minWidth: 0 }}>
      {data.summary.rulesWithAlertsCount > 0 ? (
        <div className="sa-notice" role="status" style={{ borderLeft: '4px solid #d97706' }}>
          <strong>Needs attention:</strong> {data.summary.rulesWithAlertsCount} active free gift rule
          {data.summary.rulesWithAlertsCount === 1 ? ' needs' : 's need'} review (unavailable at checkout, low/out-of-stock SKU, untracked stock, or cap reached). Check the warnings on each rule below.
        </div>
      ) : null}

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {notice ? <p className="sa-notice" role="status">{notice}</p> : null}

      {/* Summary metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 175px), 1fr))',
          gap: '0.85rem',
          minWidth: 0,
        }}
      >
        <div className="sa-control-card">
          <div className="sa-label">Live running rules</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {data.summary.runningRulesCount} / {data.summary.activeRulesCount}
          </div>
          <p className="sa-card-note">Highest crossed threshold wins max 1 per order.</p>
        </div>
        <div className="sa-control-card">
          <div className="sa-label">Gifts claimed (paid)</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {data.summary.totalConsumedCount}
          </div>
          <p className="sa-card-note">{data.summary.totalReservedCount} currently reserved in pending checkouts.</p>
        </div>
        <div className="sa-control-card">
          <div className="sa-label">Revenue with free gift</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {formatINR(data.summary.totalRevenuePaise)}
          </div>
          <p className="sa-card-note">Across {data.summary.totalPaidOrdersCount} paid non-canceled orders.</p>
        </div>
        <div className="sa-control-card">
          <div className="sa-label">Retail value gifted</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {formatINR(data.summary.totalRetailGiftValuePaise)}
          </div>
          <p className="sa-card-note">Regular catalog value of ₹0 gifts awarded.</p>
        </div>
        <div className="sa-control-card">
          <div className="sa-label">Out-of-stock attempts</div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, marginTop: '0.2rem', color: data.summary.totalUnavailableAttempts > 0 ? '#b91c1c' : undefined }}>
            {data.summary.totalUnavailableAttempts}
          </div>
          <p className="sa-card-note">Checkouts warned when unlocked gift ran out.</p>
        </div>
      </div>

      {/* Create / Edit Rule + Live Customer Preview */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: '1.25rem',
          alignItems: 'start',
          minWidth: 0,
        }}
      >
        <form onSubmit={handleSaveRule} className="sa-control-card" style={{ display: 'grid', gap: '1rem', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <h2 className="sa-control-title" style={{ marginBottom: '0.15rem' }}>
                {form.id ? `Edit free gift rule: ${form.name || form.id}` : 'Create new free gift rule'}
              </h2>
              <p className="sa-card-note">
                Spend threshold is checked on eligible item subtotal before coupons and shipping.
              </p>
            </div>
            {form.id ? (
              <button
                type="button"
                className="sa-btn sa-btn-quiet"
                onClick={() => setForm(createEmptyForm(data))}
              >
                New rule instead
              </button>
            ) : null}
          </div>

          <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.9rem', minWidth: 0 }}>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Rule name</span>
                <input
                  className="sa-input"
                  type="text"
                  maxLength={80}
                  required
                  placeholder="Orders over ₹1,999 get a Free Glass Protector"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                />
                <span className="sa-card-note">Internal promo title shown in Store Admin and reports (max 80 chars).</span>
              </label>

              <label className="sa-field">
                <span className="sa-label">Minimum qualifying spend (₹)</span>
                <input
                  className="sa-input"
                  type="text"
                  inputMode="decimal"
                  required
                  value={form.targetRupees}
                  onChange={(e) => update('targetRupees', e.target.value)}
                />
                <span className="sa-card-note">Eligible cart item subtotal needed to unlock this gift. If multiple rules match, the highest threshold wins.</span>
              </label>
            </div>

            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Gift product (SKU)</span>
                <select
                  className="sa-input"
                  value={form.giftProductId}
                  onChange={(e) => handleSelectProduct(e.target.value)}
                >
                  {data.giftProducts.length === 0 ? (
                    <option value="">No catalog products found</option>
                  ) : (
                    data.giftProducts.map((p) => {
                      const stockDesc = p.trackInventory
                        ? ` (${p.availableQty ?? 0} in stock)`
                        : ' (unlimited stock)';
                      return (
                        <option key={p.id} value={p.id}>
                          {p.isGiftOnly ? '[Gift-only] ' : ''}{p.name} — {formatINR(p.pricePaise)}{stockDesc}{!p.isActive ? ' [Inactive]' : ''}
                        </option>
                      );
                    })
                  )}
                </select>
                <span className="sa-card-note">
                  Gift-only items (hidden from shop) are listed first. Ensure inventory limits are enabled so gifts cannot oversell.
                </span>
              </label>

              {selectedProduct && selectedProduct.variants.length > 0 ? (
                <label className="sa-field">
                  <span className="sa-label">Specific variant / colour</span>
                  <select
                    className="sa-input"
                    value={form.giftVariantId}
                    onChange={(e) => update('giftVariantId', e.target.value)}
                  >
                    <option value="">Select variant…</option>
                    {selectedProduct.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} ({v.sku}){v.trackInventory ? ` — ${v.availableQty ?? 0} avail.` : ''}{!v.isActive ? ' [Inactive]' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="sa-card-note">Exact variant SKU reserved in stock when claimed.</span>
                </label>
              ) : null}
            </div>

            {selectedProduct && !selectedProduct.trackInventory && !(selectedVariant?.trackInventory) ? (
              <p className="sa-notice" role="status">
                Warning: Stock tracking is off on this gift item. Turn on &ldquo;Limit my stock&rdquo; on the product or set a Maximum total gifts cap below.
              </p>
            ) : null}

            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Badge label</span>
                <input
                  className="sa-input"
                  type="text"
                  maxLength={24}
                  value={form.badgeText}
                  onChange={(e) => update('badgeText', e.target.value)}
                />
                <span className="sa-card-note">Short pill shown on the ₹0 cart row, e.g. FREE or FREE GIFT.</span>
              </label>

              <label className="sa-field">
                <span className="sa-label">Priority tie-breaker</span>
                <input
                  className="sa-input"
                  type="number"
                  min={-9999}
                  max={9999}
                  value={form.priority}
                  onChange={(e) => update('priority', e.target.value)}
                />
                <span className="sa-card-note">Used only if two active rules have the exact same spend threshold; higher number wins.</span>
              </label>
            </div>

            <label className="sa-field">
              <span className="sa-label">Cart unlock message</span>
              <input
                className="sa-input"
                type="text"
                maxLength={160}
                value={form.unlockMessage}
                onChange={(e) => update('unlockMessage', e.target.value)}
              />
              <span className="sa-card-note">Shown in the cart and bag drawer once the shopper qualifies (max 160 chars).</span>
            </label>

            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Starts at ({data.timeZone}, optional)</span>
                <input
                  className="sa-input"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => update('startsAt', e.target.value)}
                />
                <span className="sa-card-note">Leave blank to start right away when active.</span>
              </label>

              <label className="sa-field">
                <span className="sa-label">Ends at ({data.timeZone}, optional)</span>
                <input
                  className="sa-input"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => update('endsAt', e.target.value)}
                />
                <span className="sa-card-note">Leave blank for no automatic end date.</span>
              </label>
            </div>

            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Maximum total gifts (optional)</span>
                <input
                  className="sa-input"
                  type="number"
                  min={1}
                  max={1000000}
                  placeholder="Unlimited"
                  value={form.maxGiftsTotal}
                  onChange={(e) => update('maxGiftsTotal', e.target.value)}
                />
                <span className="sa-card-note">Stop giving this promo gift once reserved + paid claims hit this limit.</span>
              </label>

              <label className="sa-field">
                <span className="sa-label">Per-customer limit (optional)</span>
                <input
                  className="sa-input"
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="Unlimited"
                  value={form.perCustomerLimit}
                  onChange={(e) => update('perCustomerLimit', e.target.value)}
                />
                <span className="sa-card-note">Maximum times the same signed-in customer or email can claim this rule.</span>
              </label>
            </div>

            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">When a discount coupon is applied</span>
                <select
                  className="sa-input"
                  value={form.couponInteraction}
                  onChange={(e) => update('couponInteraction', e.target.value as 'allow' | 'disallow')}
                >
                  <option value="allow">Allow together with discount coupons</option>
                  <option value="disallow">Do not allow with another coupon</option>
                </select>
                <span className="sa-card-note">
                  Choose whether shoppers can combine this spend gift with a promo code (or Spin &amp; Win discount).
                </span>
              </label>

              {form.couponInteraction === 'allow' ? (
                <label className="sa-field">
                  <span className="sa-label">Minimum spend after coupon (₹, optional)</span>
                  <input
                    className="sa-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="No post-coupon floor"
                    value={form.minPostCouponRupees}
                    onChange={(e) => update('minPostCouponRupees', e.target.value)}
                  />
                  <span className="sa-card-note">Optional floor on payable item subtotal after coupon discount before gift remains eligible.</span>
                </label>
              ) : (
                <div className="sa-field" />
              )}
            </div>

            <label className="sa-field">
              <span className="sa-label">Custom gift icon URL (optional)</span>
              <input
                className="sa-input"
                type="text"
                maxLength={500}
                placeholder="/images/gift-badge.png or https://..."
                value={form.iconUrl}
                onChange={(e) => update('iconUrl', e.target.value)}
              />
              <span className="sa-card-note">Optional small badge/image override. Defaults to the gift item&apos;s catalog photo.</span>
            </label>

            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-checkbox">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => update('isActive', e.target.checked)}
                  />
                  <span>Enable this rule</span>
                </span>
                <span className="sa-card-note">Only enabled rules inside their date window show on storefront and attach at checkout.</span>
              </label>

              <label className="sa-field">
                <span className="sa-checkbox">
                  <input
                    type="checkbox"
                    checked={form.showOnProductPage}
                    onChange={(e) => update('showOnProductPage', e.target.checked)}
                  />
                  <span>Highlight promo on product pages</span>
                </span>
                <span className="sa-card-note">Shows a concise promotional strip below the price on accessory product pages.</span>
              </label>
            </div>
          </fieldset>

          {canEdit ? (
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="submit" className="sa-btn sa-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save rule changes' : 'Create free gift rule'}
              </button>
            </div>
          ) : null}
        </form>

        {/* Live Storefront Preview */}
        <div className="sa-control-card" style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <h2 className="sa-control-title" style={{ marginBottom: '0.15rem' }}>
              Customer cart preview
            </h2>
            <p className="sa-card-note">
              Exact visual style shown in bag drawer, cart page, and checkout.
            </p>
          </div>

          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              padding: '0.85rem',
              background: '#f8fafc',
              display: 'grid',
              gap: '0.45rem',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              Before threshold (Nudge)
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>
              Add ₹400 more to unlock a FREE {previewGiftName}!
            </div>
            <div style={{ height: '7px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
              <div style={{ width: '75%', height: '100%', background: '#111827', borderRadius: '999px' }} />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Target: {formatINR(previewTargetPaise)}
            </div>
          </div>

          <div
            style={{
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '0.85rem',
              background: '#f0fdf4',
              display: 'grid',
              gap: '0.5rem',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#166534' }}>
              Unlocked cart line (Auto-added)
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#14532d' }}>
              {form.unlockMessage || 'You unlocked a free gift!'}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                background: '#ffffff',
                border: '1px solid #dcfce7',
                borderRadius: '8px',
                padding: '0.6rem 0.75rem',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {previewGiftName}{' '}
                  <span className="sa-badge sa-badge-ok">{form.badgeText || 'FREE'}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                  Qty 1 · Added automatically (no remove button)
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#15803d', fontSize: '0.92rem' }}>FREE (₹0)</div>
                {previewGiftRegularPaise > 0 ? (
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', textDecoration: 'line-through' }}>
                    {formatINR(previewGiftRegularPaise)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="sa-control-card" style={{ padding: '0.85rem', background: '#fafafa' }}>
            <div className="sa-label" style={{ marginBottom: '0.35rem' }}>Safeguards enforced automatically</div>
            <ul style={{ margin: '0 0 0 1.15rem', display: 'grid', gap: '0.3rem', fontSize: '0.85rem' }}>
              <li>Maximum 1 spend-threshold gift per order (highest crossed tier wins).</li>
              <li>Stock is locked at PayU checkout initiation and released if unpaid, canceled, or superseded.</li>
              <li>Out-of-stock or capped gifts warn the customer to continue without gift instead of silently switching SKUs.</li>
              <li>Free gifts are excluded from unit/revenue sales totals and never show in public browsing.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Rules list */}
      <div className="sa-control-card" style={{ display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <h2 className="sa-control-title" style={{ marginBottom: '0.15rem' }}>
              Configured free gift rules ({data.rules.length})
            </h2>
            <p className="sa-card-note">
              Ordered from highest threshold to lowest. Highest qualifying active rule applies per cart.
            </p>
          </div>
          <a href="/api/store-admin/free-gifts/export" className="sa-btn sa-btn-quiet">
            Export CSV
          </a>
        </div>

        {data.rules.length === 0 ? (
          <p className="sa-empty">No free gift rules configured yet. Create your first spend-threshold rule above.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            {data.rules.map((rule) => (
              <div
                key={rule.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '10px',
                  padding: '0.95rem',
                  background: rule.isActive ? '#ffffff' : '#f9fafb',
                  display: 'grid',
                  gap: '0.55rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                    <strong>{rule.name}</strong>
                    <span className={`sa-badge ${rule.runningNow ? 'sa-badge-ok' : 'sa-badge-muted'}`}>
                      {rule.runningNow ? 'Live now' : rule.isActive ? 'Scheduled / Cap blocked' : 'Paused'}
                    </span>
                    <span className="sa-badge sa-badge-muted">Spend ≥ {formatINR(rule.targetPaise)}</span>
                    <span className="sa-badge sa-badge-muted">Priority {rule.priority}</span>
                    {rule.gift?.isGiftOnly ? <span className="sa-badge sa-badge-ok">Gift-only SKU</span> : null}
                  </div>
                  {canEdit ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                      <button
                        type="button"
                        className="sa-btn sa-btn-small"
                        onClick={() => setForm(formFromRule(rule, data.timeZone))}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        onClick={() => runQuickAction(rule, rule.isActive ? 'pause' : 'resume')}
                      >
                        {rule.isActive ? 'Pause' : 'Resume'}
                      </button>
                      {rule.unavailableCheckoutCount > 0 ? (
                        <button
                          type="button"
                          className="sa-btn sa-btn-small sa-btn-quiet"
                          onClick={() => runQuickAction(rule, 'reset_unavailable')}
                        >
                          Clear alert ({rule.unavailableCheckoutCount})
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        onClick={() => runQuickAction(rule, 'archive')}
                      >
                        Archive
                      </button>
                    </div>
                  ) : null}
                </div>

                <div style={{ fontSize: '0.88rem', color: '#374151', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <span>
                    <strong>Gift:</strong> {rule.gift?.productName ?? rule.giftProductId}
                    {rule.gift?.variantLabel ? ` (${rule.gift.variantLabel})` : ''}
                  </span>
                  <span>
                    <strong>Badge:</strong> {rule.badgeText}
                  </span>
                  <span>
                    <strong>Claimed:</strong> {rule.claimedCount}
                    {rule.maxGiftsTotal !== null ? ` / ${rule.maxGiftsTotal}` : ' (no cap)'}
                  </span>
                  <span>
                    <strong>Coupons:</strong>{' '}
                    {rule.couponInteraction === 'disallow'
                      ? 'Not stackable'
                      : rule.minPostCouponPaise > 0
                        ? `Stackable (min post-coupon ${formatINR(rule.minPostCouponPaise)})`
                        : 'Stackable'}
                  </span>
                </div>

                {rule.unavailableCheckoutCount > 0 ? (
                  <div className="sa-notice" role="status">
                    {rule.unavailableCheckoutCount} checkout attempt{rule.unavailableCheckoutCount === 1 ? '' : 's'} hit unavailable / out-of-stock gift warning. Restock SKU or pause rule.
                  </div>
                ) : null}

                {rule.warnings.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.3rem' }}>
                    {rule.warnings.map((w) => (
                      <div key={w.key} style={{ fontSize: '0.83rem', color: '#b45309' }}>
                        Warning: {w.message}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reports & recent ledger */}
      <div className="sa-control-card" style={{ display: 'grid', gap: '1.1rem' }}>
        <div>
          <h2 className="sa-control-title" style={{ marginBottom: '0.2rem' }}>Free gift performance &amp; ledger</h2>
          <p className="sa-card-note">
            Attribution counts paid, non-canceled orders with consumed gifts. Customer emails remain masked.
          </p>
        </div>

        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th className="sa-num">Reserved</th>
                <th className="sa-num">Consumed</th>
                <th className="sa-num">Released</th>
                <th className="sa-num">Paid orders</th>
                <th className="sa-num">Order revenue</th>
                <th className="sa-num">Gift value given</th>
                <th className="sa-num">Out-of-stock hits</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.byRule.map((r) => (
                <tr key={r.ruleId}>
                  <td>{r.ruleName}</td>
                  <td className="sa-num">{r.reservedCount}</td>
                  <td className="sa-num">{r.consumedCount}</td>
                  <td className="sa-num">{r.releasedCount}</td>
                  <td className="sa-num">{r.paidOrdersCount}</td>
                  <td className="sa-num">{formatINR(r.revenuePaise)}</td>
                  <td className="sa-num">{formatINR(r.retailGiftValuePaise)}</td>
                  <td className="sa-num">{r.unavailableCheckoutCount}</td>
                </tr>
              ))}
              {data.reports.byRule.length === 0 ? (
                <tr>
                  <td colSpan={8} className="sa-empty">No rules recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {data.reports.recentRedemptions.length > 0 ? (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Rule</th>
                  <th>Gift SKU</th>
                  <th>Customer</th>
                  <th>State</th>
                  <th>Reason / Note</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.recentRedemptions.map((row) => (
                  <tr key={row.id}>
                    <td className="sa-mono">
                      <a href={`/store-admin/orders/${encodeURIComponent(row.txnid)}`}>
                        {row.orderNumber ? `#${row.orderNumber}` : row.txnid}
                      </a>
                    </td>
                    <td>{row.ruleName}</td>
                    <td>{row.giftProductName}</td>
                    <td>{row.customerMasked}</td>
                    <td>
                      <span
                        className={`sa-badge ${
                          row.state === 'CONSUMED'
                            ? 'sa-badge-ok'
                            : row.state === 'RELEASED'
                              ? 'sa-badge-muted'
                              : 'sa-badge-warn'
                        }`}
                      >
                        {row.state}
                      </span>
                    </td>
                    <td>{row.releaseReason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

