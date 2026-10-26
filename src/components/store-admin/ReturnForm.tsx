'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CONDITION_GRADES, type ConditionGrade } from '@/lib/store-admin/return-rules';
import type { ReturnableLine } from '@/lib/store-admin/returns';

interface Props {
  txnid: string;
  lines: ReturnableLine[];
}

const GRADE_LABELS: Record<ConditionGrade, string> = {
  RESELLABLE: 'Resellable',
  OPENED: 'Opened',
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
};

interface LineState {
  quantity: number;
  grade: ConditionGrade;
  restock: boolean;
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Open an RMA for a delivered order. Only the quantities that are still
 * returnable are offered, and nothing reaches stock until the goods are
 * received.
 */
export function ReturnForm({ txnid, lines }: Props) {
  const router = useRouter();
  const open = lines.filter((line) => line.returnable > 0);
  const [state, setState] = useState<Record<number, LineState>>(() =>
    Object.fromEntries(
      open.map((line) => [line.orderItemId, { quantity: 0, grade: 'RESELLABLE' as ConditionGrade, restock: true }]),
    ),
  );
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function patch(orderItemId: number, change: Partial<LineState>) {
    setState((current) => ({
      ...current,
      [orderItemId]: { ...current[orderItemId], ...change },
    }));
  }

  const chosen = open.filter((line) => (state[line.orderItemId]?.quantity ?? 0) > 0);
  const expectedPaise = chosen.reduce(
    (sum, line) => sum + (state[line.orderItemId]?.quantity ?? 0) * line.unitPricePaise,
    0,
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chosen.length === 0) {
      setError('Pick at least one item and a quantity.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/store-admin/returns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txnid,
          reason,
          note,
          lines: chosen.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: state[line.orderItemId].quantity,
            conditionGrade: state[line.orderItemId].grade,
            restock: state[line.orderItemId].restock,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The return could not be opened.');
      }
      setReason('');
      setNote('');
      setState(
        Object.fromEntries(
          open.map((line) => [
            line.orderItemId,
            { quantity: 0, grade: 'RESELLABLE' as ConditionGrade, restock: true },
          ]),
        ),
      );
      setMessage(`Return ${payload.id} opened and waiting for approval.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The return could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  if (open.length === 0) {
    return (
      <section className="sa-detail-section">
        <h2 className="sa-section-title">Returns</h2>
        <p className="sa-empty">
          Every line on this order has already been returned, so there is nothing left to open.
        </p>
      </section>
    );
  }

  return (
    <section className="sa-edit-card">
      <div className="sa-edit-head">
        <div>
          <h2 className="sa-card-title">Start a return</h2>
          <p className="sa-note">
            Choose what is coming back and how it should be treated. Stock only moves when
            the return is marked received.
          </p>
        </div>
        <span className="sa-pill">{open.length} returnable {open.length === 1 ? 'line' : 'lines'}</span>
      </div>

      {message ? <p className="sa-success" role="status">{message}</p> : null}

      <form className="sa-return-form" onSubmit={submit}>
        <div className="sa-table-wrap">
          <table className="sa-table sa-return-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="sa-num">Returnable</th>
                <th className="sa-num">Quantity</th>
                <th>Condition</th>
                <th className="sa-num">Restock</th>
              </tr>
            </thead>
            <tbody>
              {open.map((line) => {
                const lineState = state[line.orderItemId];
                return (
                  <tr key={line.orderItemId}>
                    <td>
                      {line.productName}
                      <span className="sa-row-sub">
                        {formatPaise(line.unitPricePaise)} each · {line.returned > 0 ? `${line.returned} already returned` : 'not returned before'}
                      </span>
                    </td>
                    <td className="sa-num">{line.returnable} of {line.purchased}</td>
                    <td className="sa-num">
                      <input
                        className="sa-input sa-input-inline"
                        type="number"
                        min={0}
                        max={line.returnable}
                        value={lineState.quantity}
                        onChange={(event) =>
                          patch(line.orderItemId, {
                            quantity: Math.max(0, Math.min(line.returnable, Number(event.target.value) || 0)),
                          })
                        }
                        aria-label={`Quantity to return for ${line.productName}`}
                      />
                    </td>
                    <td>
                      <select
                        className="sa-input"
                        value={lineState.grade}
                        onChange={(event) =>
                          patch(line.orderItemId, { grade: event.target.value as ConditionGrade })
                        }
                        aria-label={`Condition for ${line.productName}`}
                      >
                        {CONDITION_GRADES.map((grade) => (
                          <option key={grade} value={grade}>{GRADE_LABELS[grade]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="sa-num">
                      <input
                        type="checkbox"
                        checked={lineState.restock}
                        onChange={(event) => patch(line.orderItemId, { restock: event.target.checked })}
                        aria-label={`Restock ${line.productName} when received`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="sa-field">
          <span className="sa-label">Reason</span>
          <input
            className="sa-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={300}
            required
            placeholder="e.g. Screen cracked on arrival"
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">Internal note <span className="sa-hint">optional</span></span>
          <textarea
            className="sa-input sa-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Anything the next person handling this should know"
          />
        </label>

        <p className="sa-return-total">
          Value of the goods coming back <strong>{formatPaise(expectedPaise)}</strong>
        </p>

        {error ? <p className="sa-error" role="alert">{error}</p> : null}

        <div className="sa-edit-actions">
          <button
            className="sa-btn sa-btn-primary"
            type="submit"
            disabled={busy || chosen.length === 0 || reason.trim().length < 3}
          >
            {busy ? 'Opening…' : 'Open return'}
          </button>
          <span className="sa-note">Returns need approval before the goods are received and refunded.</span>
        </div>
      </form>
    </section>
  );
}
