'use client';

import { useState } from 'react';

type Action = 'verify-mail' | 'test-email' | 'test-sms';

interface Outcome {
  ok: boolean;
  message: string;
}

/**
 * Owner-only tools that prove mail and SMS work. Each button calls the
 * server, which reads the saved settings and the environment; nothing secret
 * is ever sent to or shown in this component.
 */
export function MailChecksPanel() {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<Action | null>(null);
  const [results, setResults] = useState<Partial<Record<Action, Outcome>>>({});

  async function run(action: Action, to?: string) {
    setBusy(action);
    setResults((current) => ({ ...current, [action]: undefined }));
    try {
      const response = await fetch('/api/store-admin/mail-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, to }),
      });
      const data = await response.json().catch(() => ({}));
      const message =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'string'
            ? data.error
            : 'The check could not run.';
      setResults((current) => ({
        ...current,
        [action]: { ok: response.ok && data.ok === true, message },
      }));
    } catch {
      setResults((current) => ({
        ...current,
        [action]: { ok: false, message: 'The check could not run. Nothing was sent.' },
      }));
    } finally {
      setBusy(null);
    }
  }

  function show(action: Action) {
    const outcome = results[action];
    if (!outcome) return null;
    return (
      <p
        className={outcome.ok ? 'sa-success' : 'sa-error'}
        role={outcome.ok ? 'status' : 'alert'}
      >
        {outcome.message}
      </p>
    );
  }

  return (
    <section className="sa-detail-card">
      <div className="sa-detail-head">
        <h2>Check that it works</h2>
      </div>
      <p className="sa-note">
        These use the saved settings above, so save first. Owners only; a few checks per hour.
        A check works even while sending is switched off.
      </p>

      <div className="sa-control-card">
        <p className="sa-control-title">Email connection</p>
        <p className="sa-hint">Connects to the mail server and logs in. Sends nothing.</p>
        <button
          type="button"
          className="sa-btn sa-btn-small"
          onClick={() => run('verify-mail')}
          disabled={busy !== null}
        >
          {busy === 'verify-mail' ? 'Checking…' : 'Check connection'}
        </button>
        {show('verify-mail')}
      </div>

      <div className="sa-control-card">
        <p className="sa-control-title">Test email</p>
        <p className="sa-hint">Sends one email labelled “[TEST]” to the address you type.</p>
        <div className="sa-search-row">
          <input
            className="sa-input"
            type="email"
            aria-label="Send the test email to"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="off"
          />
          <button
            type="button"
            className="sa-btn sa-btn-primary sa-btn-small"
            onClick={() => run('test-email', email)}
            disabled={busy !== null || email.trim() === ''}
          >
            {busy === 'test-email' ? 'Sending…' : 'Send test email'}
          </button>
        </div>
        {show('test-email')}
      </div>

      <div className="sa-control-card">
        <p className="sa-control-title">Test SMS</p>
        <p className="sa-hint">
          Sends one text through the chosen gateway. Include the country code, for example
          +919876543210. MSG91 in India also needs a DLT template id.
        </p>
        <div className="sa-search-row">
          <input
            className="sa-input"
            type="tel"
            aria-label="Send the test SMS to"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+91…"
            autoComplete="off"
          />
          <button
            type="button"
            className="sa-btn sa-btn-primary sa-btn-small"
            onClick={() => run('test-sms', phone)}
            disabled={busy !== null || phone.trim() === ''}
          >
            {busy === 'test-sms' ? 'Sending…' : 'Send test SMS'}
          </button>
        </div>
        {show('test-sms')}
      </div>
    </section>
  );
}
