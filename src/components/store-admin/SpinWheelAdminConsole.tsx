'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { SpinWheelSvg } from '@/components/spin-wheel/SpinWheelSvg';
import {
  computeTargetWheelRotation,
  contrastTextForHex,
  sanitizeHexColor,
  WHEEL_SEGMENT_PALETTE,
} from '@/lib/spin-wheel/colors';
import type {
  SpinAdminDashboardData,
  SpinTestResult,
} from '@/lib/store-admin/spin-wheel';
import type {
  SpinCouponScope,
  SpinCouponType,
  SpinSegmentType,
} from '@/lib/spin-wheel/rules';

interface SegmentDraft {
  id: string;
  label: string;
  colorHex: string;
  segmentType: SpinSegmentType;
  weight: string;
  dailyCap: string;
  totalCap: string;
  dailyAwarded: number;
  totalAwarded: number;
  isActive: boolean;
  couponType: SpinCouponType;
  couponValueInput: string;
  couponMaxDiscountRupees: string;
  couponMinOrderRupees: string;
  couponScope: SpinCouponScope;
  couponTargetIds: string[];
  couponValidDays: string;
  couponAllowWithSalePrice: boolean;
}

interface SettingsDraft {
  enabled: boolean;
  title: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  spinsPerCustomerPerDay: string;
  maxSpinsPerIpPerDay: string;
  minAccountAgeMinutes: string;
  showOnHomePage: boolean;
  termsText: string;
}

interface Props {
  initialData: SpinAdminDashboardData;
  initialStartsAtLocal: string;
  initialEndsAtLocal: string;
  canEdit: boolean;
}

function formatINRFromPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function paiseToRupeeString(paise: number | null): string {
  if (paise === null || paise === 0) return '';
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

function toSegmentDrafts(data: SpinAdminDashboardData): SegmentDraft[] {
  return data.segments.map((seg) => ({
    id: seg.id,
    label: seg.label,
    colorHex: sanitizeHexColor(seg.colorHex, '#ffe100'),
    segmentType: seg.segmentType,
    weight: String(seg.weight),
    dailyCap: seg.dailyCap !== null ? String(seg.dailyCap) : '',
    totalCap: seg.totalCap !== null ? String(seg.totalCap) : '',
    dailyAwarded: seg.dailyAwarded,
    totalAwarded: seg.totalAwarded,
    isActive: seg.isActive,
    couponType: seg.couponType ?? 'PERCENT',
    couponValueInput:
      seg.couponType === 'FIXED'
        ? paiseToRupeeString(seg.couponValue)
        : seg.couponType === 'FREE_SHIPPING'
          ? '0'
          : String(seg.couponValue || 10),
    couponMaxDiscountRupees: paiseToRupeeString(seg.couponMaxDiscountPaise),
    couponMinOrderRupees: paiseToRupeeString(seg.couponMinOrderPaise),
    couponScope: seg.couponScope,
    couponTargetIds: [...seg.couponTargetIds],
    couponValidDays: String(seg.couponValidDays || 7),
    couponAllowWithSalePrice: seg.couponAllowWithSalePrice,
  }));
}

function toSettingsDraft(
  data: SpinAdminDashboardData,
  startsAtLocal: string,
  endsAtLocal: string,
): SettingsDraft {
  return {
    enabled: data.settings.enabled,
    title: data.settings.title,
    subtitle: data.settings.subtitle,
    startsAt: startsAtLocal,
    endsAt: endsAtLocal,
    spinsPerCustomerPerDay: String(data.settings.spinsPerCustomerPerDay || 1),
    maxSpinsPerIpPerDay: String(data.settings.maxSpinsPerIpPerDay || 1),
    minAccountAgeMinutes: String(data.settings.minAccountAgeMinutes ?? 0),
    showOnHomePage: data.settings.showOnHomePage,
    termsText: data.settings.termsText,
  };
}

export function SpinWheelAdminConsole({
  initialData,
  initialStartsAtLocal,
  initialEndsAtLocal,
  canEdit,
}: Props) {
  const router = useRouter();
  const [data, setData] = useState<SpinAdminDashboardData>(initialData);
  const [settings, setSettings] = useState<SettingsDraft>(() =>
    toSettingsDraft(initialData, initialStartsAtLocal, initialEndsAtLocal),
  );
  const [segments, setSegments] = useState<SegmentDraft[]>(() => toSegmentDrafts(initialData));
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [spinning, setSpinning] = useState(false);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [testOutcome, setTestOutcome] = useState<SpinTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const liveOdds = useMemo(() => {
    const activeTotal = segments.reduce((sum, seg) => {
      if (!seg.isActive) return sum;
      const w = Number.parseInt(seg.weight, 10);
      return sum + (Number.isFinite(w) && w > 0 ? w : 0);
    }, 0);

    const map: Record<string, number> = {};
    for (const seg of segments) {
      if (!seg.isActive || activeTotal <= 0) {
        map[seg.id] = 0;
        continue;
      }
      const w = Number.parseInt(seg.weight, 10);
      map[seg.id] = Number.isFinite(w) && w > 0 ? Math.round((w / activeTotal) * 1000) / 10 : 0;
    }
    return map;
  }, [segments]);

  const previewSlices = useMemo(
    () =>
      segments
        .filter((s) => s.isActive)
        .map((s) => ({
          id: s.id,
          label: s.label || 'Slice',
          colorHex: sanitizeHexColor(s.colorHex, '#ffe100'),
          textColorHex: contrastTextForHex(sanitizeHexColor(s.colorHex, '#ffe100')),
        })),
    [segments],
  );

  function updateSettings<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function updateSegment<K extends keyof SegmentDraft>(index: number, key: K, value: SegmentDraft[K]) {
    setSegments((prev) => prev.map((seg, i) => (i === index ? { ...seg, [key]: value } : seg)));
    setDirty(true);
  }

  function toggleTarget(index: number, targetId: string) {
    setSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== index) return seg;
        const exists = seg.couponTargetIds.includes(targetId);
        return {
          ...seg,
          couponTargetIds: exists
            ? seg.couponTargetIds.filter((id) => id !== targetId)
            : [...seg.couponTargetIds, targetId],
        };
      }),
    );
    setDirty(true);
  }

  function addSegment() {
    if (segments.length >= 12) return;
    const nextColor = WHEEL_SEGMENT_PALETTE[segments.length % WHEEL_SEGMENT_PALETTE.length];
    const id = `seg_new_${Date.now().toString(36)}_${segments.length + 1}`;
    setSegments((prev) => [
      ...prev,
      {
        id,
        label: 'New prize',
        colorHex: nextColor,
        segmentType: 'COUPON',
        weight: '10',
        dailyCap: '',
        totalCap: '',
        dailyAwarded: 0,
        totalAwarded: 0,
        isActive: true,
        couponType: 'PERCENT',
        couponValueInput: '10',
        couponMaxDiscountRupees: '',
        couponMinOrderRupees: '',
        couponScope: 'ORDER',
        couponTargetIds: [],
        couponValidDays: '7',
        couponAllowWithSalePrice: false,
      },
    ]);
    setDirty(true);
  }

  function moveSegment(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= segments.length) return;
    setSegments((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, item);
      return copy;
    });
    setDirty(true);
  }

  function removeSegment(index: number) {
    if (segments.length <= 2) return;
    setSegments((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function saveAll(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const payload = {
        settings: {
          enabled: settings.enabled,
          title: settings.title,
          subtitle: settings.subtitle,
          startsAt: settings.startsAt || null,
          endsAt: settings.endsAt || null,
          spinsPerCustomerPerDay: Number.parseInt(settings.spinsPerCustomerPerDay, 10) || 1,
          maxSpinsPerIpPerDay: Number.parseInt(settings.maxSpinsPerIpPerDay, 10) || 1,
          minAccountAgeMinutes: Number.parseInt(settings.minAccountAgeMinutes, 10) || 0,
          showOnHomePage: settings.showOnHomePage,
          termsText: settings.termsText,
        },
        segments: segments.map((seg, sortOrder) => ({
          id: seg.id,
          label: seg.label,
          colorHex: seg.colorHex,
          segmentType: seg.segmentType,
          weight: Number.parseInt(seg.weight, 10),
          dailyCap: seg.dailyCap.trim() ? Number.parseInt(seg.dailyCap, 10) : null,
          totalCap: seg.totalCap.trim() ? Number.parseInt(seg.totalCap, 10) : null,
          isActive: seg.isActive,
          sortOrder,
          couponType: seg.segmentType === 'COUPON' ? seg.couponType : null,
          couponValueInput: seg.segmentType === 'COUPON' ? seg.couponValueInput : '0',
          couponMaxDiscountRupees:
            seg.segmentType === 'COUPON' && seg.couponType === 'PERCENT' && seg.couponMaxDiscountRupees.trim()
              ? seg.couponMaxDiscountRupees.trim()
              : null,
          couponMinOrderRupees:
            seg.segmentType === 'COUPON' && seg.couponMinOrderRupees.trim()
              ? seg.couponMinOrderRupees.trim()
              : null,
          couponScope: seg.couponScope,
          couponTargetIds: seg.couponScope === 'ORDER' ? [] : seg.couponTargetIds,
          couponValidDays: Number.parseInt(seg.couponValidDays, 10) || 7,
          couponAllowWithSalePrice: seg.couponAllowWithSalePrice,
        })),
      };

      const res = await fetch('/api/store-admin/spin-wheel', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save spin wheel.');
      }

      const nextData = body as SpinAdminDashboardData;
      setData(nextData);
      setSegments(toSegmentDrafts(nextData));
      setSettings((prev) => ({
        ...prev,
        enabled: nextData.settings.enabled,
        title: nextData.settings.title,
        subtitle: nextData.settings.subtitle,
        spinsPerCustomerPerDay: String(nextData.settings.spinsPerCustomerPerDay || 1),
        maxSpinsPerIpPerDay: String(nextData.settings.maxSpinsPerIpPerDay || 1),
        minAccountAgeMinutes: String(nextData.settings.minAccountAgeMinutes ?? 0),
        showOnHomePage: nextData.settings.showOnHomePage,
        termsText: nextData.settings.termsText,
      }));
      setDirty(false);
      setNotice('Spin wheel configuration saved.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save spin wheel.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSpin() {
    if (spinning) return;
    setTestError(null);
    setTestOutcome(null);

    try {
      const res = await fetch('/api/store-admin/spin-wheel/test-spin', {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.result) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Test spin failed.');
      }

      const result = body.result as SpinTestResult;
      const savedSlices = data.segments.filter((s) => s.isActive);
      const targetIndex = savedSlices.findIndex((s) => s.id === result.segmentId);
      const slicesForRotation = previewSlices.length >= 2 ? previewSlices : savedSlices;
      const fallbackIdx = slicesForRotation.findIndex((s) => s.id === result.segmentId);
      const indexToUse = fallbackIdx >= 0 ? fallbackIdx : Math.max(0, targetIndex);

      setSpinning(true);
      setRotationDeg((prev) =>
        computeTargetWheelRotation(prev, indexToUse, Math.max(2, slicesForRotation.length), 5),
      );
      window.setTimeout(() => {
        setSpinning(false);
        setTestOutcome(result);
      }, 4250);
    } catch (caught) {
      setTestError(caught instanceof Error ? caught.message : 'Test spin failed.');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      {/* Top status bar */}
      <div
        className="sa-control-card"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
          <span className={data.settings.enabled ? 'sa-status sa-status-on' : 'sa-status sa-status-off'}>
            {data.settings.enabled ? 'Wheel enabled' : 'Wheel off'}
          </span>
          <span className="sa-status-chip">Store timezone: {data.timeZone}</span>
          <span className="sa-status-chip">Today ({data.timeZone}): {data.todayStoreDay}</span>
          {dirty ? <span className="sa-status-chip" data-tone="warn">Unsaved changes</span> : null}
        </div>
        <div className="sa-inline-actions">
          <a className="sa-btn sa-btn-quiet" href="/api/store-admin/spin-wheel/export">
            Download CSV report
          </a>
          {canEdit ? (
            <button
              type="button"
              className="sa-btn sa-btn-primary"
              disabled={saving}
              onClick={saveAll}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <p className="sa-lock-note">
          You have view-only access. You can inspect rules, run a test spin preview, and download reports.
        </p>
      ) : null}

      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="sa-notice" role="status">
          {notice}
        </p>
      ) : null}

      {data.warnings.length > 0 ? (
        <div className="sa-control-card" role="status" style={{ borderLeft: '4px solid #d97706' }}>
          <h2 className="sa-control-title">Checks &amp; warnings</h2>
          <ul style={{ margin: '0.5rem 0 0 1.25rem', display: 'grid', gap: '0.35rem' }}>
            {data.warnings.map((w) => (
              <li key={w.key}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={saveAll} style={{ display: 'grid', gap: '1.25rem' }}>
        {/* Settings + Live Preview / Test Spin */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.25rem',
            alignItems: 'start',
          }}
        >
          {/* Settings card */}
          <div className="sa-control-card">
            <h2 className="sa-control-title">Wheel settings &amp; guardrails</h2>
            <fieldset disabled={!canEdit || saving} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.9rem' }}>
              <label className="sa-field">
                <span className="sa-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => updateSettings('enabled', e.target.checked)}
                  />
                  <span>Enable Spin and Win on the storefront</span>
                </span>
                <span className="sa-card-note">
                  Turn this on only after reviewing prize weights, terms text, and caps. Requires at least one active prize segment and non-empty terms.
                </span>
              </label>

              <label className="sa-field">
                <span className="sa-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.showOnHomePage}
                    onChange={(e) => updateSettings('showOnHomePage', e.target.checked)}
                  />
                  <span>Show compact promotional callout on the home page</span>
                </span>
                <span className="sa-card-note">
                  When on and the wheel is active, signed-in or browsing shoppers see a sleek callout linking to the dedicated Spin and Win page.
                </span>
              </label>

              <label className="sa-field">
                <span className="sa-label">Heading title</span>
                <input
                  className="sa-input"
                  type="text"
                  maxLength={80}
                  value={settings.title}
                  onChange={(e) => updateSettings('title', e.target.value)}
                />
                <span className="sa-card-note">Shown above the wheel on the customer Spin and Win page.</span>
              </label>

              <label className="sa-field">
                <span className="sa-label">Subtitle</span>
                <input
                  className="sa-input"
                  type="text"
                  maxLength={180}
                  value={settings.subtitle}
                  onChange={(e) => updateSettings('subtitle', e.target.value)}
                />
                <span className="sa-card-note">Short plain-word summary shown under the heading.</span>
              </label>

              <div className="sa-control-grid">
                <label className="sa-field">
                  <span className="sa-label">Start date &amp; time ({data.timeZone})</span>
                  <input
                    className="sa-input"
                    type="datetime-local"
                    value={settings.startsAt}
                    onChange={(e) => updateSettings('startsAt', e.target.value)}
                  />
                  <span className="sa-card-note">Optional. Leave blank to start immediately once enabled.</span>
                </label>

                <label className="sa-field">
                  <span className="sa-label">End date &amp; time ({data.timeZone})</span>
                  <input
                    className="sa-input"
                    type="datetime-local"
                    value={settings.endsAt}
                    onChange={(e) => updateSettings('endsAt', e.target.value)}
                  />
                  <span className="sa-card-note">Optional. Leave blank to stay open until turned off.</span>
                </label>
              </div>

              <div className="sa-control-grid">
                <label className="sa-field">
                  <span className="sa-label">Max spins per IP address per day</span>
                  <input
                    className="sa-input"
                    type="number"
                    min={1}
                    max={100}
                    value={settings.maxSpinsPerIpPerDay}
                    onChange={(e) => updateSettings('maxSpinsPerIpPerDay', e.target.value)}
                  />
                  <span className="sa-card-note">
                    Prevents repeat spinning from multiple accounts on the same network in one store day (default 1).
                  </span>
                </label>

                <label className="sa-field">
                  <span className="sa-label">Minimum account age (minutes)</span>
                  <input
                    className="sa-input"
                    type="number"
                    min={0}
                    max={525600}
                    value={settings.minAccountAgeMinutes}
                    onChange={(e) => updateSettings('minAccountAgeMinutes', e.target.value)}
                  />
                  <span className="sa-card-note">
                    Set to 0 to let newly signed-up customers spin right away, or increase (for example 15) to slow down brand-new spam accounts.
                  </span>
                </label>
              </div>

              <label className="sa-field">
                <span className="sa-label">Terms &amp; conditions (shown before spinning)</span>
                <textarea
                  className="sa-input"
                  rows={4}
                  maxLength={4000}
                  value={settings.termsText}
                  onChange={(e) => updateSettings('termsText', e.target.value)}
                />
                <span className="sa-card-note">
                  Required before enabling the wheel. Customers must read and accept these terms before spinning.
                </span>
              </label>
            </fieldset>
          </div>

          {/* Live Wheel Preview + Test Spin + Help */}
          <div style={{ display: 'grid', gap: '1.25rem' }}>
            <div className="sa-control-card" style={{ textAlign: 'center' }}>
              <h2 className="sa-control-title">Wheel preview &amp; test spin</h2>
              <p className="sa-card-note" style={{ marginBottom: '0.9rem' }}>
                Preview updates live as you edit segments. Test spin draws using your last saved weights without creating a spin record or coupon.
              </p>

              <SpinWheelSvg
                segments={previewSlices}
                rotationDeg={rotationDeg}
                spinning={spinning}
                size={310}
                ariaLabel="Store admin wheel preview"
              />

              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="sa-btn sa-btn-primary"
                  disabled={spinning}
                  onClick={handleTestSpin}
                >
                  {spinning ? 'Spinning preview...' : 'Test spin'}
                </button>
              </div>

              {dirty ? (
                <p className="sa-card-note" style={{ marginTop: '0.6rem' }}>
                  You have unsaved changes. Save changes first if you want Test spin to use your updated weights.
                </p>
              ) : null}

              {testError ? (
                <p className="sa-error" role="alert" style={{ marginTop: '0.75rem' }}>
                  {testError}
                </p>
              ) : null}

              {testOutcome ? (
                <div
                  className="sa-notice"
                  role="status"
                  style={{ marginTop: '0.85rem', textAlign: 'left' }}
                >
                  <strong>Test result: {testOutcome.label}</strong>
                  <div className="sa-card-note" style={{ marginTop: '0.25rem' }}>
                    {testOutcome.summary} — preview only, no coupon created and no spin recorded.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="sa-control-card">
              <h2 className="sa-control-title">How the wheel works</h2>
              <ul style={{ margin: '0.5rem 0 0 1.2rem', display: 'grid', gap: '0.45rem', fontSize: '0.92rem' }}>
                <li>
                  <strong>Daily reset at midnight:</strong> Each signed-in customer gets one spin per calendar day in the store timezone ({data.timeZone}), measured by the database clock.
                </li>
                <li>
                  <strong>Server-side random draw:</strong> The server chooses the outcome using cryptographic randomness weighted by each active segment&apos;s Weight.
                </li>
                <li>
                  <strong>Automatic cap fallback:</strong> If a segment hits its daily or total win cap, it is skipped cleanly and remaining active segments keep their relative odds.
                </li>
                <li>
                  <strong>Personal single-use coupons:</strong> Winning a prize generates a unique coupon code tied strictly to that winner&apos;s account and hidden from other shoppers.
                </li>
                <li>
                  <strong>Safe future edits:</strong> Changing or removing segments never alters or invalidates coupons already won by customers.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Segments Editor */}
        <div className="sa-control-card">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div>
              <h2 className="sa-control-title" style={{ marginBottom: '0.2rem' }}>
                Wheel segments ({segments.length} of 12)
              </h2>
              <p className="sa-card-note">
                Configure 2 to 12 slices. Include at least one active Coupon prize segment and ideally a Try again slice with realistic weights.
              </p>
            </div>
            {canEdit ? (
              <button
                type="button"
                className="sa-btn sa-btn-quiet"
                disabled={segments.length >= 12 || saving}
                onClick={addSegment}
              >
                + Add segment
              </button>
            ) : null}
          </div>

          <fieldset disabled={!canEdit || saving} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1rem' }}>
            {segments.map((seg, idx) => {
              const safeColor = sanitizeHexColor(seg.colorHex, '#ffe100');
              const contrastFg = contrastTextForHex(safeColor);
              const odds = liveOdds[seg.id] ?? 0;

              return (
                <div
                  key={seg.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    padding: '1rem',
                    background: seg.isActive ? '#ffffff' : '#f9fafb',
                    display: 'grid',
                    gap: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                      <strong>Slice {idx + 1}: {seg.label || 'Untitled'}</strong>
                      <span
                        className="sa-status-chip"
                        style={{ backgroundColor: safeColor, color: contrastFg, borderColor: '#d1d5db' }}
                      >
                        {contrastFg === '#ffffff' ? 'Light text' : 'Dark text'} preview
                      </span>
                      <span className="sa-status-chip">
                        Calculated odds: {odds.toFixed(1)}%
                      </span>
                      <span className="sa-card-note">
                        Awarded today: {seg.dailyAwarded}{seg.dailyCap ? ` / ${seg.dailyCap}` : ''} · All time: {seg.totalAwarded}{seg.totalCap ? ` / ${seg.totalCap}` : ''}
                      </span>
                    </div>

                    {canEdit ? (
                      <div className="sa-inline-actions">
                        <label className="sa-checkbox" style={{ marginRight: '0.5rem' }}>
                          <input
                            type="checkbox"
                            checked={seg.isActive}
                            onChange={(e) => updateSegment(idx, 'isActive', e.target.checked)}
                          />
                          <span>Active</span>
                        </label>
                        <button
                          type="button"
                          className="sa-btn sa-btn-quiet"
                          disabled={idx === 0}
                          onClick={() => moveSegment(idx, -1)}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          className="sa-btn sa-btn-quiet"
                          disabled={idx === segments.length - 1}
                          onClick={() => moveSegment(idx, 1)}
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          className="sa-btn sa-btn-quiet"
                          disabled={segments.length <= 2}
                          onClick={() => removeSegment(idx)}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="sa-control-grid">
                    <label className="sa-field">
                      <span className="sa-label">Slice label</span>
                      <input
                        className="sa-input"
                        type="text"
                        maxLength={40}
                        value={seg.label}
                        onChange={(e) => updateSegment(idx, 'label', e.target.value)}
                      />
                      <span className="sa-card-note">Short label printed on the wheel wedge (max 40 characters).</span>
                    </label>

                    <div className="sa-field">
                      <span className="sa-label">Background colour</span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          type="color"
                          aria-label={`Slice ${idx + 1} colour picker`}
                          value={safeColor.length === 7 ? safeColor : '#ffe100'}
                          onChange={(e) => updateSegment(idx, 'colorHex', e.target.value)}
                          style={{ width: '44px', height: '38px', padding: '2px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff' }}
                        />
                        <input
                          className="sa-input"
                          type="text"
                          value={seg.colorHex}
                          onChange={(e) => updateSegment(idx, 'colorHex', e.target.value)}
                        />
                      </div>
                      <span className="sa-card-note">Text contrast (black or white) adjusts automatically.</span>
                    </div>

                    <label className="sa-field">
                      <span className="sa-label">Segment outcome</span>
                      <select
                        className="sa-input"
                        value={seg.segmentType}
                        onChange={(e) => updateSegment(idx, 'segmentType', e.target.value as SpinSegmentType)}
                      >
                        <option value="COUPON">Coupon prize</option>
                        <option value="NO_PRIZE">No prize / Try again</option>
                      </select>
                      <span className="sa-card-note">Choose whether landing here awards a personal coupon or a friendly message.</span>
                    </label>

                    <label className="sa-field">
                      <span className="sa-label">Relative weight</span>
                      <input
                        className="sa-input"
                        type="number"
                        min={1}
                        max={10000}
                        value={seg.weight}
                        onChange={(e) => updateSegment(idx, 'weight', e.target.value)}
                      />
                      <span className="sa-card-note">Higher numbers land more often. Does not have to add up to 100.</span>
                    </label>

                    <label className="sa-field">
                      <span className="sa-label">Daily win cap (optional)</span>
                      <input
                        className="sa-input"
                        type="number"
                        min={1}
                        max={1000000}
                        placeholder="Unlimited"
                        value={seg.dailyCap}
                        onChange={(e) => updateSegment(idx, 'dailyCap', e.target.value)}
                      />
                      <span className="sa-card-note">Max wins per store day before this slice stops paying out today.</span>
                    </label>

                    <label className="sa-field">
                      <span className="sa-label">Total win cap (optional)</span>
                      <input
                        className="sa-input"
                        type="number"
                        min={1}
                        max={10000000}
                        placeholder="Unlimited"
                        value={seg.totalCap}
                        onChange={(e) => updateSegment(idx, 'totalCap', e.target.value)}
                      />
                      <span className="sa-card-note">Lifetime maximum wins for this slice. Blank means unlimited.</span>
                    </label>
                  </div>

                  {seg.segmentType === 'COUPON' ? (
                    <div
                      style={{
                        borderTop: '1px dashed #e5e7eb',
                        paddingTop: '0.85rem',
                        display: 'grid',
                        gap: '0.85rem',
                      }}
                    >
                      <div className="sa-control-grid">
                        <label className="sa-field">
                          <span className="sa-label">Discount type</span>
                          <select
                            className="sa-input"
                            value={seg.couponType}
                            onChange={(e) => updateSegment(idx, 'couponType', e.target.value as SpinCouponType)}
                          >
                            <option value="PERCENT">Percentage off (%)</option>
                            <option value="FIXED">Fixed amount off (₹)</option>
                            <option value="FREE_SHIPPING">Free shipping</option>
                          </select>
                          <span className="sa-card-note">Applied to the winner&apos;s personal single-use coupon.</span>
                        </label>

                        {seg.couponType !== 'FREE_SHIPPING' ? (
                          <label className="sa-field">
                            <span className="sa-label">
                              {seg.couponType === 'PERCENT' ? 'Discount percentage (1-100)' : 'Discount amount (₹)'}
                            </span>
                            <input
                              className="sa-input"
                              type="text"
                              inputMode="decimal"
                              value={seg.couponValueInput}
                              onChange={(e) => updateSegment(idx, 'couponValueInput', e.target.value)}
                            />
                            <span className="sa-card-note">
                              {seg.couponType === 'PERCENT'
                                ? 'Whole percentage, for example 10 for 10% off.'
                                : 'Rupee amount off the order subtotal, for example 150.'}
                            </span>
                          </label>
                        ) : null}

                        {seg.couponType === 'PERCENT' ? (
                          <label className="sa-field">
                            <span className="sa-label">Maximum discount cap (₹, optional)</span>
                            <input
                              className="sa-input"
                              type="text"
                              inputMode="decimal"
                              placeholder="No cap"
                              value={seg.couponMaxDiscountRupees}
                              onChange={(e) => updateSegment(idx, 'couponMaxDiscountRupees', e.target.value)}
                            />
                            <span className="sa-card-note">Caps large percentage discounts on big carts (recommended).</span>
                          </label>
                        ) : null}

                        <label className="sa-field">
                          <span className="sa-label">Minimum order subtotal (₹, optional)</span>
                          <input
                            className="sa-input"
                            type="text"
                            inputMode="decimal"
                            placeholder="None"
                            value={seg.couponMinOrderRupees}
                            onChange={(e) => updateSegment(idx, 'couponMinOrderRupees', e.target.value)}
                          />
                          <span className="sa-card-note">Cart must reach this subtotal before the prize coupon applies.</span>
                        </label>

                        <label className="sa-field">
                          <span className="sa-label">Coupon valid for (days)</span>
                          <input
                            className="sa-input"
                            type="number"
                            min={1}
                            max={365}
                            value={seg.couponValidDays}
                            onChange={(e) => updateSegment(idx, 'couponValidDays', e.target.value)}
                          />
                          <span className="sa-card-note">Expires this many days after the customer wins it.</span>
                        </label>

                        <label className="sa-field">
                          <span className="sa-label">Applies to</span>
                          <select
                            className="sa-input"
                            value={seg.couponScope}
                            onChange={(e) => updateSegment(idx, 'couponScope', e.target.value as SpinCouponScope)}
                          >
                            <option value="ORDER">Entire order</option>
                            <option value="PRODUCTS">Specific products</option>
                            <option value="CATEGORIES">Specific categories</option>
                          </select>
                          <span className="sa-card-note">Limit this prize coupon to selected items or let it apply storewide.</span>
                        </label>
                      </div>

                      <label className="sa-field">
                        <span className="sa-checkbox">
                          <input
                            type="checkbox"
                            checked={seg.couponAllowWithSalePrice}
                            onChange={(e) => updateSegment(idx, 'couponAllowWithSalePrice', e.target.checked)}
                          />
                          <span>Allow on items that already have a sale price</span>
                        </span>
                        <span className="sa-card-note">
                          Leave unchecked to avoid double-discounting items during a store sale.
                        </span>
                      </label>

                      {seg.couponScope === 'PRODUCTS' ? (
                        <div className="sa-field">
                          <span className="sa-label">Eligible products ({seg.couponTargetIds.length} selected)</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', maxHeight: '150px', overflowY: 'auto', padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                            {data.products.map((p) => (
                              <label key={p.id} className="sa-checkbox">
                                <input
                                  type="checkbox"
                                  checked={seg.couponTargetIds.includes(p.id)}
                                  onChange={() => toggleTarget(idx, p.id)}
                                />
                                <span>{p.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {seg.couponScope === 'CATEGORIES' ? (
                        <div className="sa-field">
                          <span className="sa-label">Eligible categories ({seg.couponTargetIds.length} selected)</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', maxHeight: '150px', overflowY: 'auto', padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                            {data.categories.map((c) => (
                              <label key={c.id} className="sa-checkbox">
                                <input
                                  type="checkbox"
                                  checked={seg.couponTargetIds.includes(c.id)}
                                  onChange={() => toggleTarget(idx, c.id)}
                                />
                                <span>{c.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          {canEdit ? (
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button type="submit" className="sa-btn sa-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          ) : null}
        </div>
      </form>

      {/* Reports section */}
      <div className="sa-control-card" style={{ display: 'grid', gap: '1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
          <div>
            <h2 className="sa-control-title" style={{ marginBottom: '0.2rem' }}>Spin &amp; coupon reports</h2>
            <p className="sa-card-note">
              Live figures from recorded customer spins and coupon redemptions. Customer addresses and full emails stay masked.
            </p>
          </div>
          <a className="sa-btn sa-btn-quiet" href="/api/store-admin/spin-wheel/export">
            Download CSV
          </a>
        </div>

        <dl className="sa-meta">
          <div>
            <dt>Coupons won</dt>
            <dd>{data.reports.coupons.won}</dd>
          </div>
          <div>
            <dt>Redeemed</dt>
            <dd>{data.reports.coupons.redeemed}</dd>
          </div>
          <div>
            <dt>Expired</dt>
            <dd>{data.reports.coupons.expired}</dd>
          </div>
          <div>
            <dt>Active unused</dt>
            <dd>{data.reports.coupons.activeUnused}</dd>
          </div>
          <div>
            <dt>Orders using won coupons</dt>
            <dd>{data.reports.coupons.ordersCount}</dd>
          </div>
          <div>
            <dt>Order revenue</dt>
            <dd>{formatINRFromPaise(data.reports.coupons.revenuePaise)}</dd>
          </div>
          <div>
            <dt>Discount given</dt>
            <dd>{formatINRFromPaise(data.reports.coupons.totalDiscountPaise)}</dd>
          </div>
        </dl>

        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Type</th>
                  <th>Odds</th>
                  <th>Today / Daily cap</th>
                  <th>Total / Total cap</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.winsBySegment.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{row.segmentType === 'COUPON' ? 'Coupon' : 'No prize'}</td>
                    <td>{row.oddsPercent.toFixed(1)}%</td>
                    <td>{row.dailyAwarded}{row.dailyCap ? ` / ${row.dailyCap}` : ''}</td>
                    <td>{row.totalAwarded}{row.totalCap ? ` / ${row.totalCap}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Store day</th>
                  <th>Spins</th>
                  <th>Wins</th>
                  <th>No prize</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.spinsPerDay.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="sa-muted">No spins recorded yet.</td>
                  </tr>
                ) : (
                  data.reports.spinsPerDay.map((row) => (
                    <tr key={row.storeDay}>
                      <td>{row.storeDay}</td>
                      <td>{row.spins}</td>
                      <td>{row.wins}</td>
                      <td>{row.noPrize}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Time ({data.timeZone})</th>
                <th>Customer</th>
                <th>Outcome</th>
                <th>Type</th>
                <th>Coupon</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.recentSpins.length === 0 ? (
                <tr>
                  <td colSpan={6} className="sa-muted">No customer spins recorded yet.</td>
                </tr>
              ) : (
                data.reports.recentSpins.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAtWall}</td>
                    <td>{row.customerMasked}</td>
                    <td>{row.segmentLabel}</td>
                    <td>{row.segmentType === 'COUPON' ? 'Coupon prize' : 'No prize'}</td>
                    <td>{row.couponCode ? <code>{row.couponCode}</code> : '—'}</td>
                    <td>{row.couponStatus ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

