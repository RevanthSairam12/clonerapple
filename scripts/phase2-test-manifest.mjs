#!/usr/bin/env node
/** No database client import or connection. Prints hostname and write counts only. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, phase2Manifest } from '../tests/helpers/phase2-fixture.mjs';

try {
  let target = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (process.argv.includes('--configured-hostname') && !target) {
    // Inspect only this one configured value. Do not load/export any env keys.
    const text = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    const match = text.match(/^\s*(?:DATABASE_MIGRATION_URL|DATABASE_URL)\s*=\s*(.*?)\s*$/m);
    target = match?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
  }
  const manifest = await phase2Manifest(target);
  if (!manifest.hostname) throw new Error('Supply an explicit database target, or --configured-hostname for a read-only configuration inspection');
  console.log(JSON.stringify(manifest, null, 2));
} catch {
  // Never surface URL parse errors, env text, connection strings or credentials.
  console.error('Cannot generate Phase2 manifest: check target configuration and local migration/test files. No database connection was made.');
  process.exitCode = 1;
}
