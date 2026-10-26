'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ReviewRow } from '@/lib/store-admin/reviews';

interface Props {
  reviews: ReviewRow[];
  canEdit: boolean;
}

type EditorMode = 'reject' | 'reply';

const STATUS_CLASS: Record<ReviewRow['status'], string> = {
  pending: 'sa-status sa-status-warn',
  published: 'sa-status sa-status-on',
  rejected: 'sa-status sa-status-danger',
};

function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, rating));
  return (
    <span className="sa-rating" aria-label={`${filled} out of 5 stars`} title={`${filled} / 5`}>
      <span aria-hidden="true">{'★'.repeat(filled)}</span>
      <span className="sa-rating-empty" aria-hidden="true">
        {'★'.repeat(5 - filled)}
      </span>
    </span>
  );
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * The moderation table. Publish/reject change status; reply publishes the
 * store's public answer. Rejecting always needs a reason, so the editor opens
 * with a mandatory text box instead of a bare confirm.
 */
export function ReviewBoard({ reviews, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; mode: EditorMode } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openEditor(review: ReviewRow, mode: EditorMode) {
    setError(null);
    setNotice(null);
    if (editing?.id === review.id && editing.mode === mode) {
      setEditing(null);
      return;
    }
    setEditing({ id: review.id, mode });
    setDraft(mode === 'reply' ? review.storeReply : '');
  }

  async function send(
    review: ReviewRow,
    action: 'publish' | 'reject' | 'reply',
    extra: Record<string, string> = {},
  ) {
    setBusy(`${review.id}:${action}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/reviews/${encodeURIComponent(review.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not update the review.');
      }
      setNotice(
        action === 'publish'
          ? 'Review published.'
          : action === 'reject'
            ? 'Review rejected.'
            : 'Reply saved.',
      );
      setEditing(null);
      setDraft('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the review.');
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) {
    return <p className="sa-empty">No reviews match this filter.</p>;
  }

  return (
    <>
      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="sa-notice sa-success" role="status">
          {notice}
        </p>
      ) : null}

      <div className="sa-table-wrap">
        <table className="sa-table sa-review-table">
          <thead>
            <tr>
              <th>Review</th>
              <th>Product</th>
              <th>Customer</th>
              <th>Rating</th>
              <th>Status</th>
              <th>Posted</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => {
              const open = editing?.id === review.id ? editing.mode : null;
              return (
                <Fragment key={review.id}>
                  <tr>
                    <td>
                      <strong>{review.title || 'No title'}</strong>
                      <div className="sa-row-sub sa-review-body">{review.body || 'No text.'}</div>
                      {review.storeReply ? (
                        <div className="sa-review-reply">
                          <span>Store reply</span>
                          {review.storeReply}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="sa-product-link">{review.productName}</span>
                      <div className="sa-row-sub sa-mono">{review.productSlug}</div>
                    </td>
                    <td>
                      {review.customerName}
                      <div className="sa-row-sub sa-mono">{review.customerEmail}</div>
                      {review.verifiedPurchase ? (
                        <span className="sa-pill sa-pill-verified">Verified purchase</span>
                      ) : null}
                    </td>
                    <td>
                      <Stars rating={review.rating} />
                    </td>
                    <td>
                      <span className={STATUS_CLASS[review.status]}>{review.status}</span>
                      {review.status === 'rejected' && review.rejectionReason ? (
                        <div className="sa-row-sub">{review.rejectionReason}</div>
                      ) : null}
                    </td>
                    <td className="sa-date">{shortDate(review.createdAt)}</td>
                    <td>
                      {canEdit ? (
                        <div className="sa-inline-actions sa-review-actions">
                          {review.status !== 'published' ? (
                            <button
                              type="button"
                              className="sa-btn sa-btn-small sa-btn-primary"
                              disabled={busy !== null}
                              onClick={() => send(review, 'publish')}
                            >
                              {busy === `${review.id}:publish` ? 'Publishing…' : 'Publish'}
                            </button>
                          ) : null}
                          {review.status !== 'rejected' ? (
                            <button
                              type="button"
                              className="sa-btn sa-btn-small sa-btn-danger"
                              disabled={busy !== null}
                              onClick={() => openEditor(review, 'reject')}
                            >
                              Reject
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="sa-btn sa-btn-small"
                            disabled={busy !== null}
                            onClick={() => openEditor(review, 'reply')}
                          >
                            {review.storeReply ? 'Edit reply' : 'Reply'}
                          </button>
                        </div>
                      ) : (
                        <span className="sa-lock-note">Read only</span>
                      )}
                    </td>
                  </tr>

                  {open ? (
                    <tr className="sa-review-edit-row">
                      <td colSpan={7}>
                        {open === 'reject' ? (
                          <div className="sa-review-editor">
                            <label className="sa-field sa-field-wide">
                              <span className="sa-label">
                                Rejection reason <span className="sa-hint">kept internal</span>
                              </span>
                              <textarea
                                className="sa-input"
                                rows={2}
                                maxLength={300}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                placeholder="Off-topic or abusive content"
                              />
                            </label>
                            <div className="sa-inline-actions">
                              <button
                                type="button"
                                className="sa-btn sa-btn-small sa-btn-danger"
                                disabled={busy !== null || !draft.trim()}
                                onClick={() => send(review, 'reject', { reason: draft.trim() })}
                              >
                                {busy === `${review.id}:reject` ? 'Rejecting…' : 'Confirm rejection'}
                              </button>
                              <button
                                type="button"
                                className="sa-btn sa-btn-small"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="sa-review-editor">
                            <label className="sa-field sa-field-wide">
                              <span className="sa-label">
                                Store reply <span className="sa-hint">shown publicly</span>
                              </span>
                              <textarea
                                className="sa-input"
                                rows={3}
                                maxLength={2000}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                placeholder="Thanks for the detailed feedback…"
                              />
                            </label>
                            <div className="sa-inline-actions">
                              <button
                                type="button"
                                className="sa-btn sa-btn-small sa-btn-primary"
                                disabled={busy !== null || !draft.trim()}
                                onClick={() => send(review, 'reply', { reply: draft.trim() })}
                              >
                                {busy === `${review.id}:reply` ? 'Saving…' : 'Save reply'}
                              </button>
                              <button
                                type="button"
                                className="sa-btn sa-btn-small"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
