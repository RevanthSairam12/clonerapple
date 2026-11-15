'use client';

const PRINT_ISOLATION_STYLE_ID = 'gadzio-print-document-only';
const PRINT_ISOLATION_CSS = `
@media print {
  @page { margin: 12mm; }
  html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
  body *:not([data-order-document="true"]):not([data-order-document="true"] *):not(:has([data-order-document="true"])) {
    display: none !important;
  }
  body :has([data-order-document="true"]) {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    width: 100% !important;
    min-height: 0 !important;
    background: #ffffff !important;
    border: none !important;
    box-shadow: none !important;
  }
  [data-order-document="true"] {
    box-shadow: none !important;
    border: none !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
  }
}
`;

export function PrintButton({ label = 'Download invoice' }: { label?: string }) {
  function handleDownload() {
    let style = document.getElementById(PRINT_ISOLATION_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = PRINT_ISOLATION_STYLE_ID;
      style.textContent = PRINT_ISOLATION_CSS;
      document.head.appendChild(style);
    }
    const cleanup = () => {
      style?.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="rounded-full border border-[#d2d2d7] px-4 py-2 text-sm font-semibold"
    >
      {label}
    </button>
  );
}
