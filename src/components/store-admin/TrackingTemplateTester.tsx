'use client';

import { useMemo, useState } from 'react';

import { buildTrackingUrl } from '@/lib/store-admin/delivery';

interface Props {
  providers: { name: string; template: string }[];
}

/**
 * Shows the URL a courier's template produces. It uses the same pure builder
 * the order screen uses, so what is previewed is what will be saved.
 */
export function TrackingTemplateTester({ providers }: Props) {
  const usable = providers.filter((provider) => provider.template.trim());
  const [name, setName] = useState(usable[0]?.name ?? '');
  const [number, setNumber] = useState('');

  const template = usable.find((provider) => provider.name === name)?.template ?? '';
  const url = useMemo(
    () => (number.trim() ? buildTrackingUrl(template, number) : null),
    [template, number],
  );

  if (usable.length === 0) {
    return (
      <p className="sa-note">
        Add a courier with a tracking URL template to preview the generated link.
      </p>
    );
  }

  return (
    <div className="sa-edit-form">
      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">Courier</span>
          <select className="sa-input" value={name} onChange={(event) => setName(event.target.value)}>
            {usable.map((provider) => (
              <option key={provider.name} value={provider.name}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span className="sa-label">Test tracking number</span>
          <input
            className="sa-input"
            value={number}
            maxLength={200}
            placeholder="AWB123456"
            onChange={(event) => setNumber(event.target.value)}
          />
        </label>
      </div>
      <p className="sa-note">
        {number.trim() === ''
          ? 'Type a number to preview the link.'
          : url
            ? (
                <>
                  Generated link: <a href={url} target="_blank" rel="noreferrer">{url}</a>
                </>
              )
            : 'This template does not produce a valid HTTPS URL for that number.'}
      </p>
    </div>
  );
}
