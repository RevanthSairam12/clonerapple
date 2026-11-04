#!/usr/bin/env node
/**
 * Dry run by default. Use only disposable orders on a test-mode server:
 * node --env-file=.env.local scripts/simulate-payu-callback.mjs \
 *   --base-url http://localhost:3000 --txnid TEST_ORDER --amount 500.00 \
 *   --scenario duplicate --send
 *
 * The server still independently verifies with PayU. A synthetic success is
 * NOT proof of capture and will remain PROCESSING unless PayU confirms it.
 * The injected verifier is for in-process tests, never an HTTP bypass.
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const { values } = parseArgs({ options: {
  'base-url': { type: 'string' }, txnid: { type: 'string' }, amount: { type: 'string' },
  scenario: { type: 'string', default: 'success' }, send: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
const scenarios = ['success', 'failure', 'cancel', 'pending', 'duplicate', 'out-of-order', 'wrong-amount', 'wrong-txnid'];
if (values.help) {
  console.log('Usage: node --env-file=.env.local scripts/simulate-payu-callback.mjs --base-url URL --txnid DISPOSABLE_ORDER --amount RUPEES --scenario NAME [--send]');
  console.log(`Scenarios: ${scenarios.join(', ')}. Dry run by default; never logs secrets, payloads or signed return links.`);
  process.exit(0);
}

async function main() {
  if (process.env.PAYU_ENV === 'live') throw new Error('Refusing to simulate with PAYU_ENV=live.');
  if (!scenarios.includes(values.scenario)) throw new Error('Unknown scenario; use --help.');
  if (!values.txnid || !/^[A-Za-z0-9_-]{1,100}$/.test(values.txnid)) throw new Error('Supply a disposable --txnid.');
  if (!values.amount || !/^\d+\.\d{2}$/.test(values.amount) || Number(values.amount) <= 0) throw new Error('Supply a positive --amount with two decimals.');
  const base = new URL(values['base-url'] || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('--base-url must be a plain HTTP(S) origin.');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Remote targets require HTTPS.');
  const key = process.env.PAYU_KEY?.trim();
  const salt = process.env.PAYU_SALT?.trim();
  if (!key || !salt) throw new Error('PAYU_KEY and PAYU_SALT must be configured (values are never printed).');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
  const { computeReverseHash } = await jiti.import(path.join(root, 'src/lib/payu/hash.ts'));
  const steps = values.scenario === 'duplicate' ? ['success', 'success']
    : values.scenario === 'out-of-order' ? ['success', 'failure', 'success'] : [values.scenario];
  console.log(`${values.send ? 'SENDING' : 'DRY RUN'}: ${steps.length} callback(s) to ${base.hostname}. Use disposable test orders only.`);
  for (const [index, step] of steps.entries()) {
    const data = {
      key, txnid: values.txnid, amount: values.amount,
      status: step === 'failure' || step === 'cancel' ? 'failure' : step === 'pending' ? 'pending' : 'success',
      unmappedstatus: step === 'cancel' ? 'userCancelled' : step === 'pending' ? 'pending' : step === 'failure' ? 'failed' : 'captured',
      firstname: 'Simulator', email: 'simulator@example.test', productinfo: '',
    };
    if (step === 'wrong-amount') data.amount = (Number(data.amount) + 1).toFixed(2);
    if (step === 'wrong-txnid') data.txnid = `SIM_UNKNOWN_${Date.now()}`;
    data.hash = computeReverseHash({ ...data, salt });
    const route = index > 0 && values.scenario === 'duplicate' ? 'webhook'
      : step === 'failure' ? 'failure' : step === 'cancel' ? 'cancel' : 'success';
    console.log(`Step ${index + 1}: ${step} -> /api/payu/${route}`);
    if (!values.send) continue;
    const response = await fetch(new URL(`/api/payu/${route}`, base), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data), redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    // Never log Location: it may contain a signed return token.
    console.log(`HTTP ${response.status}; redirect present: ${response.headers.has('location')}`);
    await response.body?.cancel();
    if (!response.ok && response.status !== 303) throw new Error(`Callback returned HTTP ${response.status}.`);
  }
  console.log('Finished. Inspect the order payment timeline; synthetic callbacks do not replace PayU verification.');
}
main().catch(() => {
  // Do not surface raw fetch/URL errors: they can contain sensitive inputs.
  console.error('Simulation failed. Check arguments (--help), test-mode environment, and server availability. No payload or secret was logged.');
  process.exitCode = 1;
});
