'use client';

import { useState } from 'react';

export interface AddressView {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

const emptyAddress = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

export function AddressesManager({ initial }: { initial: AddressView[] }) {
  const [addresses, setAddresses] = useState(initial);
  const [draft, setDraft] = useState(emptyAddress);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage(null);
    const response = await fetch(editing ? `/api/account/addresses/${editing}` : '/api/account/addresses', {
      method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error || 'Could not save address.'); return; }
    setAddresses((current) => editing ? current.map((address) => address.id === editing ? data.address : address) : [data.address, ...current]);
    setDraft(emptyAddress); setEditing(null); setMessage('Address saved.');
  };

  async function remove(id: string) {
    if (!window.confirm('Remove this address?')) return;
    const response = await fetch(`/api/account/addresses/${id}`, { method: 'DELETE' });
    if (response.ok) setAddresses((current) => current.filter((address) => address.id !== id));
  }

  async function makeDefault(id: string) {
    const response = await fetch(`/api/account/addresses/${id}/default`, { method: 'POST' });
    if (response.ok) setAddresses((current) => current.map((address) => ({ ...address, isDefault: address.id === id })));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold">Addresses</h2><p className="mt-1 text-sm text-[#6e6e73]">Save up to 5 delivery addresses.</p></div><span className="text-sm text-[#6e6e73]">{addresses.length}/5</span></div>
      {message && <p role="alert" className="rounded-2xl bg-[#f0fdf4] p-3 text-sm text-[#166534]">{message}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {addresses.map((address) => <article key={address.id} className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{address.name}</h3><p className="mt-1 text-sm text-[#6e6e73]">{address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />{address.city}, {address.state} {address.pincode}</p><p className="mt-2 text-sm text-[#6e6e73]">{address.phone.slice(0, 2)}******{address.phone.slice(-2)}</p></div>{address.isDefault && <span className="rounded-full bg-[#e8f3ff] px-3 py-1 text-xs font-semibold text-[#0066cc]">Default</span>}</div><div className="mt-4 flex flex-wrap gap-3 text-sm"><button type="button" onClick={() => { setEditing(address.id); setDraft(address); }} className="font-semibold text-[#0071e3]">Edit</button><button type="button" onClick={() => remove(address.id)} className="font-semibold text-[#b42318]">Delete</button>{!address.isDefault && <button type="button" onClick={() => makeDefault(address.id)} className="font-semibold text-[#6e6e73]">Make default</button>}</div></article>)}
      </div>
      <form onSubmit={save} className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm"><h3 className="text-lg font-semibold">{editing ? 'Edit address' : 'Add address'}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{(['name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'] as const).map((field) => <label key={field} className={field === 'line1' || field === 'line2' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs font-semibold uppercase text-[#6e6e73]">{field}</span><input required={field !== 'line2'} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} className="w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]" /></label>)}</div><div className="mt-5 flex gap-3"><button disabled={busy} className="rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save address</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft(emptyAddress); }} className="rounded-full border border-[#d2d2d7] px-5 py-2.5 text-sm font-semibold">Cancel</button>}</div></form>
    </div>
  );
}
