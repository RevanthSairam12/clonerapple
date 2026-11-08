'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

const FIELDS = ['name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'] as const;

const LABELS: Record<(typeof FIELDS)[number], string> = {
  name: 'Full name',
  phone: 'Phone',
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  state: 'State',
  pincode: 'PIN code',
};

export function AddressesManager({ initial }: { initial: AddressView[] }) {
  const router = useRouter();
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
    // The dashboard's address card and the default-address line re-read.
    router.refresh();
  };

  async function remove(id: string) {
    if (!window.confirm('Remove this address?')) return;
    const response = await fetch(`/api/account/addresses/${id}`, { method: 'DELETE' });
    if (response.ok) {
      setAddresses((current) => current.filter((address) => address.id !== id));
      router.refresh();
    }
  }

  async function makeDefault(id: string) {
    const response = await fetch(`/api/account/addresses/${id}/default`, { method: 'POST' });
    if (response.ok) {
      setAddresses((current) => current.map((address) => ({ ...address, isDefault: address.id === id })));
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Addresses</h2>
          <p className="mt-1 text-sm text-[#6e6e73]">Save up to 5 delivery addresses.</p>
        </div>
        <span className="text-sm text-[#6e6e73]">{addresses.length}/5</span>
      </div>
      {message && <p role="alert" className="rounded-2xl bg-[#f0fdf4] p-3 text-sm text-[#166534]">{message}</p>}
      {addresses.length === 0 ? (
        <div className="rounded-3xl border border-[#e5e5ea] bg-white p-8 text-center shadow-sm">
          <h3 className="font-semibold">No saved addresses yet</h3>
          <p className="mt-2 text-sm text-[#6e6e73]">Add one below and it will appear on your dashboard.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {addresses.map((address) => (
            <article key={address.id} className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{address.name}</h3>
                  <p className="mt-1 text-sm text-[#6e6e73]">
                    {address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />
                    {address.city}, {address.state} {address.pincode}
                  </p>
                  <p className="mt-2 text-sm text-[#6e6e73]">{address.phone.slice(0, 2)}******{address.phone.slice(-2)}</p>
                </div>
                {address.isDefault && <span className="rounded-full bg-[#e8f3ff] px-3 py-1 text-xs font-semibold text-[#0066cc]">Default</span>}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <button type="button" onClick={() => { setEditing(address.id); setDraft(address); }} className="font-semibold text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">Edit</button>
                <button type="button" onClick={() => remove(address.id)} className="font-semibold text-[#b42318] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">Delete</button>
                {!address.isDefault && <button type="button" onClick={() => makeDefault(address.id)} className="font-semibold text-[#6e6e73] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">Make default</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      <form onSubmit={save} className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">{editing ? 'Edit address' : 'Add address'}</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field} className={field === 'line1' || field === 'line2' ? 'sm:col-span-2' : ''}>
              <span className="mb-1 block text-xs font-semibold uppercase text-[#6e6e73]">{LABELS[field]}</span>
              <input
                required={field !== 'line2'}
                value={draft[field]}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                className="w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
              />
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          <button disabled={busy} className="rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">Save address</button>
          {editing && (
            <button type="button" onClick={() => { setEditing(null); setDraft(emptyAddress); }} className="rounded-full border border-[#d2d2d7] px-5 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]">Cancel</button>
          )}
        </div>
      </form>
    </div>
  );
}