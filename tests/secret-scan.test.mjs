/**
 * Tests for `scripts/check-secrets.mjs`, `.github/workflows/ci.yml`,
 * `docs/GO_LIVE_CHECKLIST.md`, and `STATUS_MATRIX.md`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('scripts/check-secrets.mjs passes across the repository and never prints secret values', () => {
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-secrets.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `check-secrets failed: ${res.stdout}\n${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.filesWithFindings, 0);
  assert.deepEqual(parsed.findings, []);
});

test('CI workflow, GO_LIVE_CHECKLIST.md, and STATUS_MATRIX.md exist and are complete', () => {
  const ci = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const cmd of [
    'npm run typecheck',
    'npm run check:store-admin-routes',
    'npm run check:account-routes',
    'npm run check:admin-boundary',
    'npm run check:field-help',
    'npm run check:links',
    'npm run check:secrets',
    'npm test',
    'npm run build',
  ]) {
    assert.ok(ci.includes(cmd), `CI workflow must run ${cmd}`);
  }

  const goLive = readFileSync(path.join(root, 'docs', 'GO_LIVE_CHECKLIST.md'), 'utf8');
  assert.match(goLive, /ap-south-1/);
  assert.match(goLive, /bom1/);
  assert.match(goLive, /check-security-db-state\.mjs/);
  assert.match(goLive, /site-address-check/);

  const matrix = readFileSync(path.join(root, 'STATUS_MATRIX.md'), 'utf8');
  assert.match(matrix, /Summary Counts/);
  assert.match(matrix, /\*\*31\*\*\s*\|\s*\*\*29\*\*\s*\|\s*\*\*2\*\*\s*\|\s*\*\*0\*\*/);
});
