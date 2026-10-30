import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/check-notifications.mjs', import.meta.url), 'utf8');
const report = source.slice(source.indexOf('const failed = rows.filter'));

function exitStatus(rows, args = []) {
  let status;
  vm.runInNewContext(report, {
    rows,
    args,
    console: { log() {} },
    process: { exit(code) { status = code; } },
  });
  return status;
}

test('notification readiness failure makes the default command fail', () => {
  assert.equal(exitStatus([{ ok: true }, { ok: false }]), 1);
  assert.equal(exitStatus([{ ok: true }]), 0);
});

test('informational mode preserves findings but exits successfully', () => {
  assert.equal(exitStatus([{ ok: false }], ['--informational']), 0);
});
