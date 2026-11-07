#!/usr/bin/env node
/** Read-only preflight: no postgres import, client construction or connection. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, phase3Manifest } from '../tests/helpers/phase3-fixture.mjs';

try {
  let target = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (process.argv.includes('--configured-hostname') && !target) {
    // Read only DATABASE_MIGRATION_URL / DATABASE_URL, never load/export the environment file.
    const text = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    const match = text.match(/^\s*(?:DATABASE_MIGRATION_URL|DATABASE_URL)\s*=\s*(.*?)\s*$/m);
    target = match?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
  }
  const manifest = await phase3Manifest(target);
  if (!manifest.hostname) throw new Error('Missing target');
  console.log(JSON.stringify(manifest, null, 2));
} catch {
  console.error('Cannot generate Phase3 manifest: check target configuration and source files. No database connection was made.');
  process.exitCode = 1;
}
