import test from 'node:test';
import assert from 'node:assert/strict';
import { completedSummary, registrationStatus } from '../scripts/db-test-evidence.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('evidence requires all completion metrics, not just a passing marker', () => {
  assert.equal(completedSummary('✔ original (3ms)\n'), false);
  assert.equal(completedSummary('ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\n'), true);
  assert.equal(completedSummary('# tests 1\r\n# pass 1\r\n# fail 0\r\n# skipped 0\r\n'), true);
  assert.equal(completedSummary('ℹ tests 1\nℹ pass 1\nℹ fail 0\n'), false);
});

test('evidence matches complete original names and does not suppress failures or skips', () => {
  assert.equal(registrationStatus(['✔ original longer name (1ms)'], 'original'), null);
  assert.equal(registrationStatus(['  ✔ original (1ms)'], 'original'), 'passed');
  assert.equal(registrationStatus(['✔ original (1ms)', '✖ original (2ms)'], 'original'), 'failed');
  assert.equal(registrationStatus(['﹣ original (1ms) # skipped'], 'original'), 'skipped');
  assert.equal(registrationStatus([], 'original'), null);
});

test('latest failed, skipped and interrupted attempts supersede older passes in the reconciler', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-evidence-unit-'));
  const script = fileURLToPath(new URL('../scripts/summarize-original-db-tests.mjs', import.meta.url));
  const footer = '\nℹ tests 80\nℹ pass 80\nℹ fail 0\nℹ skipped 0\n';
  try {
    fs.mkdirSync(path.join(root, 'tests'));
    for (const directory of ['old', 'latest']) fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, '.tmp-phase4-tests-final.txt'), Array.from({ length: 80 }, (_, i) => `﹣ original ${i} (1ms) # skipped`).join('\n'));
    for (const file of ['.tmp-phase2-approved-rerun.log', '.tmp-phase3-fixed-retry.log']) fs.writeFileSync(path.join(root, file), '');
    fs.writeFileSync(path.join(root, 'tests/example.test.mjs'), "test('original 0', () => {});");
    fs.writeFileSync(path.join(root, 'old.log'), Array.from({ length: 80 }, (_, i) => `✔ original ${i} (1ms)`).join('\n') + footer);
    fs.writeFileSync(path.join(root, 'old/results.json'), JSON.stringify([{ file: 'example', log: 'old.log', complete: true }]));
    const cases = [
      { text: '✖ original 0 (1ms)' + footer, complete: true, status: 'failed' },
      { text: '﹣ original 0 (1ms) # skipped' + footer, complete: true, status: 'skipped' },
      { text: '✔ original 0 (1ms)', complete: false, status: 'not_run' },
      { text: '', complete: false, status: 'not_run' },
    ];
    for (const entry of cases) {
      fs.writeFileSync(path.join(root, 'latest.log'), entry.text);
      fs.writeFileSync(path.join(root, 'latest/results.json'), JSON.stringify([{ file: 'example', log: 'latest.log', complete: entry.complete }]));
      const run = spawnSync(process.execPath, ['--max-old-space-size=96', script, 'old', 'latest'], { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 1);
      const result = JSON.parse(run.stdout);
      assert.equal(result.registrations[0].status, entry.status);
      // This file owned all original names in the old log; missing names in its
      // newest completed attempt are not permitted to retain stale passes.
      assert.equal(result.registrations[0].evidence, 'latest.log');
    }
  } finally {
    fs.rmSync(root, { recursive: true }); // Only the directory created by this test.
  }
});
