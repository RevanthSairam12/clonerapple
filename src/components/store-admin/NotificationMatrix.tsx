'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { NotificationToggle } from '@/lib/store-admin/notification-settings';

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'inapp', label: 'In-app' },
] as const;

const AUDIENCES = [
  { value: 'admin', label: 'Store staff' },
  { value: 'customer', label: 'Customer' },
] as const;

const TOPICS = [
  { value: 'order_placed', label: 'Order placed' },
  { value: 'payment_received', label: 'Payment received' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refund_requested', label: 'Refund requested' },
  { value: 'refund_completed', label: 'Refund completed' },
  { value: 'back_in_stock', label: 'Back in stock' },
  { value: 'password_reset', label: 'Password reset' },
  { value: 'staff_invite', label: 'Staff credentials' },
  { value: 'low_stock', label: 'Low stock' },
] as const;

interface Props {
  toggles: NotificationToggle[];
  canEdit: boolean;
}

/**
 * Channel × audience × topic toggles. Only in-app staff notifications start
 * enabled; every other cell is switched on deliberately.
 */
export function NotificationMatrix({ toggles, canEdit }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(toggles.map((toggle) => [toggle.id, toggle]));

  async function toggle(id: string, isActive: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch('/api/store-admin/settings/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, isActive }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The toggle could not be saved.');
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The toggle could not be saved.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {AUDIENCES.map((audience) => (
        <section className="sa-detail-card" key={audience.value}>
          <div className="sa-detail-head">
            <h2>{audience.label}</h2>
          </div>
          <div className="sa-table-wrap">
            <table className="sa-table sa-matrix">
              <thead>
                <tr>
                  <th>Topic</th>
                  {CHANNELS.map((channel) => (
                    <th key={channel.value}>{channel.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TOPICS.map((topic) => (
                  <tr key={topic.value}>
                    <td>{topic.label}</td>
                    {CHANNELS.map((channel) => {
                      const id = `${channel.value}:${audience.value}:${topic.value}`;
                      const toggleRow = byId.get(id);
                      const checked = toggleRow?.isActive ?? false;
                      return (
                        <td key={channel.value}>
                          <input
                            type="checkbox"
                            aria-label={`${topic.label} by ${channel.label} to ${audience.label}`}
                            checked={checked}
                            disabled={!canEdit || !toggleRow || busyId === id}
                            onChange={(event) => void toggle(id, event.target.checked)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
