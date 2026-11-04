#!/usr/bin/env node
/** Pure preflight: explicit process env only, no dotenv/client/connection. */
import { pathToFileURL } from 'node:url';
import { phase4Manifest } from '../tests/helpers/phase4-fixture.mjs';

export async function printPhase4Manifest(target, output = console.log) {
  const manifest = await phase4Manifest(target);
  output(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await printPhase4Manifest(process.env.DATABASE_URL); }
  catch {
    console.error('Cannot generate Phase4 manifest: supply an explicit session target and valid source files. No database connection was made; target details withheld.');
    process.exitCode = 1;
  }
}
