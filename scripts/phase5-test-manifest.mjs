/** Pure preflight: no SQL connection and no environment export. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, phase5Manifest } from '../tests/helpers/phase5-fixture.mjs';
try {
  let target = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!target && process.argv.includes('--configured-hostname')) {
    const text = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    target = text.match(/^\s*(?:DATABASE_MIGRATION_URL|DATABASE_URL)\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
  }
  console.log(JSON.stringify(await phase5Manifest(target), null, 2));
} catch {
  console.error('Phase5 manifest generation failed. No database connection was made; configuration details withheld.');
  process.exitCode = 1;
}
