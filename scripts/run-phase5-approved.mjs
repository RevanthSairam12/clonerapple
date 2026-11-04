/** Executes only a separately approved, source-bound Phase5 SQL manifest. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { phase5Manifest } from '../tests/helpers/phase5-fixture.mjs';
try {
  const approved = JSON.parse(fs.readFileSync('.tmp-phase5-run-manifest.json', 'utf8'));
  const text = fs.readFileSync('.env.local', 'utf8');
  const value = name => text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, 'm'))?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
  const target = process.env.DATABASE_URL || value('DATABASE_URL');
  const current = await phase5Manifest(target);
  if (current.approvalSha256 !== approved.approvalSha256) {
    const changed = Object.keys(current.sourceSha256).filter(file => current.sourceSha256[file] !== approved.sourceSha256[file]);
    console.error('Manifest changed; no database connection made. Changed source files:', changed.join(', '));
    process.exitCode = 1;
  } else {
    const result = spawnSync(process.execPath, ['--test', 'tests/phase5-coupon-integration.test.mjs'], {
      env: { ...process.env, DATABASE_URL: target, DATABASE_SSL: process.env.DATABASE_SSL || value('DATABASE_SSL') || '', RUN_PHASE5_DB_TESTS: '1', PHASE5_APPROVED_MANIFEST: approved.approvalSha256 },
      encoding: 'utf8',
    });
    fs.writeFileSync('.tmp-phase5-sql-tests.txt', (result.stdout || '') + (result.stderr || ''));
    console.log('Phase5 SQL test exit:', result.status);
    process.exitCode = result.status ?? 1;
  }
} catch {
  console.error('Phase5 approved runner refused or failed; configuration details withheld.');
  process.exitCode = 1;
}
