'use client';

export function PrintButton() {
  return (
    <button className="sa-btn sa-btn-primary" type="button" onClick={() => window.print()}>
      Print receipt
    </button>
  );
}
