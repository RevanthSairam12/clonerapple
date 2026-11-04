// Executes only the explicitly approved Phase 3 temporary-schema test batch.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { phase3Manifest } from '../tests/helpers/phase3-fixture.mjs';
const config = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  config[match[1]] = value;
}
try {
  const url = process.env.DATABASE_URL || config.DATABASE_URL;
  const target = new URL(url);
  if (target.hostname !== 'aws-0-ap-northeast-1.pooler.supabase.com' || target.pathname !== '/postgres' || target.port === '6543') throw new Error('Target mismatch; no connection attempted');
  const manifest = await phase3Manifest(url);
  const approved = JSON.parse(fs.readFileSync('.tmp-phase3-fixed-manifest.json', 'utf8'));
  if (manifest.approvalSha256 !== approved.approvalSha256) throw new Error('Manifest changed; no connection attempted');
  const fd = fs.openSync('.tmp-phase3-fixed-retry.log', 'w');
  const result = spawnSync(process.execPath, ['--test', 'tests/phase3-metadata-integration.test.mjs'], {
    env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: config.DATABASE_SSL || 'true', RUN_PHASE3_DB_TESTS: '1', PHASE3_APPROVED_MANIFEST: manifest.approvalSha256 },
    stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  console.log('Phase 3 exit:', result.status, 'Evidence: .tmp-phase3-fixed-retry.log');
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
