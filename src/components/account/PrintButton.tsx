'use client';

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-sm font-semibold">Print receipt</button>;
}
