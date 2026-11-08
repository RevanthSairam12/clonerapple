'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageBody } from './MessageBody';
import type { CustomerMessageView } from '@/lib/account/messages';

export function MessagesManager({ initialMessages }: { initialMessages: CustomerMessageView[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<CustomerMessageView[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const unreadCount = messages.filter((m) => !m.isRead).length;

  async function handleMarkRead(id: string) {
    const msg = messages.find((m) => m.id === id);
    if (!msg || msg.isRead) return;

    try {
      await fetch(`/api/account/messages/${encodeURIComponent(id)}/read`, {
        method: 'POST',
      });
      setMessages((current) =>
        current.map((m) => (m.id === id ? { ...m, isRead: true } : m)),
      );
      router.refresh();
    } catch {
      // Ignore
    }
  }

  function toggleOpen(id: string) {
    if (openId === id) {
      setOpenId(null);
    } else {
      setOpenId(id);
      void handleMarkRead(id);
    }
  }

  async function handleMarkAllRead() {
    if (unreadCount === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/messages/read-all', { method: 'POST' });
      if (res.ok) {
        setMessages((current) => current.map((m) => ({ ...m, isRead: true })));
        router.refresh();
      }
    } catch {
      // Ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Message Centre</h2>
          <p className="mt-1 text-sm text-[#6e6e73]">
            Order updates and important account notifications.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={handleMarkAllRead}
            className="text-sm font-semibold text-[#1d1d1f] hover:underline disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            Mark all as read ({unreadCount})
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="rounded-3xl border border-[#e5e5ea] bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#6e6e73]">You have no messages yet.</p>
          <Link
            href="/account/orders"
            className="mt-4 inline-flex rounded-full bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            View orders
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-[#e5e5ea] rounded-3xl border border-[#e5e5ea] bg-white shadow-sm overflow-hidden">
          {messages.map((msg) => {
            const isOpen = openId === msg.id;
            return (
              <article
                key={msg.id}
                className={`transition-colors ${
                  !msg.isRead ? 'bg-[#fbfbfd]' : 'bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleOpen(msg.id)}
                  className="flex w-full items-start justify-between gap-4 p-5 text-left focus:outline-none focus:bg-[#f5f5f7]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        !msg.isRead ? 'bg-[#1d1d1f]' : 'bg-transparent'
                      }`}
                      aria-label={!msg.isRead ? 'Unread message' : undefined}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm sm:text-base ${
                          !msg.isRead
                            ? 'font-bold text-[#1d1d1f]'
                            : 'font-medium text-[#1d1d1f]'
                        }`}
                      >
                        {msg.subject}
                      </p>
                      <p className="mt-1 text-xs text-[#6e6e73]">
                        {msg.createdDateDisplay}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-[#6e6e73] shrink-0 font-semibold">
                    {isOpen ? 'Close' : 'Read'}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-[#f5f5f7] bg-[#f9f9fb] px-5 py-4 pl-10 text-sm">
                    <MessageBody body={msg.body} />

                    {msg.orderTxnid && (
                      <div className="mt-4 pt-3 border-t border-[#e5e5ea]">
                        <Link
                          href={`/account/orders/${encodeURIComponent(msg.orderTxnid)}`}
                          className="text-xs font-semibold text-[#1d1d1f] hover:underline"
                        >
                          View order {msg.orderTxnid} →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
