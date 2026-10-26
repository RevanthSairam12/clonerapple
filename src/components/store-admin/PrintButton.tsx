'use client';

export function PrintButton({ label = 'Print receipt' }: { label?: string }) {
  return (
    <button className="sa-btn sa-btn-primary" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
