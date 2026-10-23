'use client';

import { useState } from 'react';
import type { RequestStatus } from '@/lib/account/request-rules';

export function OrderRequestControls({ id, currentStatus, currentNote }: { id: string; currentStatus: RequestStatus; currentNote: string | null }) {
  const [status, setStatus] = useState<RequestStatus>(currentStatus);
  const [adminNote, setAdminNote] = useState(currentNote || '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const response = await fetch(`/api/store-admin/requests/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, adminNote }) });
    const data = await response.json(); setBusy(false);
    setMessage(response.ok ? 'Request updated.' : data.error || 'Could not update request.');
  }
  return <form onSubmit={save} className="sa-card"><h2 className="sa-card-title">Staff response</h2><label className="sa-field"><span className="sa-label">Status</span><select className="sa-input" value={status} onChange={(event) => setStatus(event.target.value as RequestStatus)} disabled={currentStatus === 'RESOLVED' || currentStatus === 'REJECTED'}><option>OPEN</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>REJECTED</option></select></label><label className="sa-field"><span className="sa-label">Admin note</span><textarea className="sa-input" value={adminNote} onChange={(event) => setAdminNote(event.target.value)} maxLength={500} rows={5} /></label><button className="sa-btn sa-btn-primary" disabled={busy || currentStatus === 'RESOLVED' || currentStatus === 'REJECTED'}>Save request</button>{message && <p role="alert" className="sa-notice">{message}</p>}</form>;
}
