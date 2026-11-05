import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/review-product-options.mjs');

function run(env) {
  const base = { ...process.env, ...env };
  delete base.DATABASE_URL;
  delete base.REVIEW_PRODUCT_OPTIONS;
  const child = spawnSync(process.execPath, [script], {
    cwd: path.resolve('.'),
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return `${child.stdout}${child.stderr}`;
}

test('the review refuses to run without an explicit read-only acknowledgement', () => {
  const output = run({});
  assert.match(output, /refused/);
  assert.match(output, /No writes attempted/);
  assert.doesNotMatch(output, /postgres(ql)?:\/\//);
});

test('the review refuses a host that is not localhost or clearly a test target', () => {
  const output = run({
    REVIEW_PRODUCT_OPTIONS: 'read-only',
    DATABASE_URL: 'postgres://user:super-secret-password@db.production.example.com:5432/postgres',
  });
  assert.match(output, /refused/);
  assert.match(output, /not localhost or a test\/staging\/sandbox\/dev host/);
  assert.doesNotMatch(output, /super-secret-password/);
  assert.doesNotMatch(output, /production\.example/);
});
