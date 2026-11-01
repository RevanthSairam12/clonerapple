'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AdminUiSwitcher({ initialMode }: { initialMode: 'new' | 'old' }) {
  const [mode, setMode] = useState<'new' | 'old'>(initialMode);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const router = useRouter();

  const handleToggle = async (targetMode: 'new' | 'old') => {
    if (saving || mode === targetMode) return;
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: { homepageUiMode: targetMode },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update UI mode.');
      }

      setMode(targetMode);
      setFeedback({
        type: 'success',
        message:
          targetMode === 'new'
            ? '✓ Switched to Modern Gadzio UI! Changes are now live on the homepage.'
            : '✓ Switched to Classic Apple UI! Changes are now live on the homepage.',
      });
      router.refresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error updating UI mode.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '16px',
        padding: '22px 24px',
        marginBottom: '24px',
        border: '1px solid #e5e5ea',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🎛️</span>
            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#1d1d1f' }}>
              Storefront UI Version
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: '6px',
                background: '#e8f3ff',
                color: '#0071e3',
              }}
            >
              1-Click Switch
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6e6e73' }}>
            Switch between the Modern Gadzio Storefront and Classic Showcase Layout with one click.
          </p>
        </div>

        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#0071e3',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 12px',
            borderRadius: '8px',
            background: '#f5f5f7',
          }}
        >
          View Storefront ↗
        </a>
      </div>

      {feedback ? (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
            background: feedback.type === 'success' ? '#eefbf3' : '#fdf2f2',
            color: feedback.type === 'success' ? '#1b7f3b' : '#d70015',
            border: `1px solid ${feedback.type === 'success' ? '#c3ebd1' : '#f8c8c8'}`,
          }}
        >
          {feedback.message}
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '14px',
        }}
      >
        {/* Option 1: Modern Gadzio UI (New) */}
        <button
          type="button"
          onClick={() => handleToggle('new')}
          disabled={saving}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            textAlign: 'left',
            padding: '16px 18px',
            borderRadius: '12px',
            cursor: saving ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
            border: mode === 'new' ? '2px solid #0071e3' : '1px solid #e5e5ea',
            background: mode === 'new' ? '#f5f9ff' : '#fafafa',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              marginBottom: '6px',
            }}
          >
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#1d1d1f' }}>
              ✨ Modern Gadzio UI (New)
            </span>
            {mode === 'new' ? (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: '#0071e3',
                  color: '#ffffff',
                }}
              >
                ● ACTIVE
              </span>
            ) : (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#0071e3',
                }}
              >
                Click to Activate
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#6e6e73', lineHeight: 1.4 }}>
            Includes 3-part Gadzio Hero + Trust Badges Bar (Free Shipping, Returns, Genuine) + 4-Column Category Grid + Explore Grid.
          </p>
        </button>

        {/* Option 2: Classic UI (Old) */}
        <button
          type="button"
          onClick={() => handleToggle('old')}
          disabled={saving}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            textAlign: 'left',
            padding: '16px 18px',
            borderRadius: '12px',
            cursor: saving ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
            border: mode === 'old' ? '2px solid #0071e3' : '1px solid #e5e5ea',
            background: mode === 'old' ? '#f5f9ff' : '#fafafa',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              marginBottom: '6px',
            }}
          >
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#1d1d1f' }}>
              🍎 Classic Showcase UI (Old)
            </span>
            {mode === 'old' ? (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: '#0071e3',
                  color: '#ffffff',
                }}
              >
                ● ACTIVE
              </span>
            ) : (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#0071e3',
                }}
              >
                Click to Activate
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#6e6e73', lineHeight: 1.4 }}>
            Original Apple-style layout with full-width hero carousel, Back to School video stage, promo grid, and services gallery.
          </p>
        </button>
      </div>
    </div>
  );
}

