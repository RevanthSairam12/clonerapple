/** Retired unsafe worker. All payment verification must use the shared lifecycle. */
console.error('This legacy reconciliation worker is disabled: it bypassed payment verification and stock reservations. Schedule the authenticated /api/payu/reconcile route using CRON_SECRET instead; see README.md. No database or PayU request was made.');
process.exitCode = 1;
