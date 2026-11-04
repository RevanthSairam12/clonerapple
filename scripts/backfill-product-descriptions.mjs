#!/usr/bin/env node
/**
 * Dry-run by default. Apply schemas 0054 and 0056 separately, then obtain human approval
 * of the actual host, source counts and digest before explicitly invoking:
 * node scripts/backfill-product-descriptions.mjs --apply --approved-host HOST \
 *   --approved-digest SHA256 --staff-actor STORE_OWNER_ID
 * No migration execution, static marketing lookup or automatic approval.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { convertLegacyProductDescription } = await jiti.import(path.join(root, 'src/lib/catalog/product-description.ts'));

/** Pure planning boundary, exported so offline tests never connect to a DB. */
export function planDescriptionBackfill(rows, identity) {
  const counts = { total: rows.length, preservedStructured: 0, deleted: 0, noLegacyContent: 0,
    invalidLegacy: 0, candidates: 0, withDescription: 0, withHighlights: 0, withInTheBox: 0 };
  const updates = [];
  const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
  for (const row of sorted) {
    if (row.deleted_at != null) { counts.deleted++; continue; }
    // [] is an intentional edit, never a missing value. Preserve malformed but
    // non-null structured content too; it needs staff review, not replacement.
    if (row.description_sections != null) { counts.preservedStructured++; continue; }
    try {
      if (row.description != null && typeof row.description !== 'string') throw new Error('legacy');
      if (row.highlights != null && (!Array.isArray(row.highlights) || row.highlights.some(item =>
        !item || typeof item.title !== 'string' || typeof item.desc !== 'string'))) throw new Error('legacy');
      if (row.in_the_box != null && (!Array.isArray(row.in_the_box) || row.in_the_box.some(item => typeof item !== 'string'))) throw new Error('legacy');
      const result = convertLegacyProductDescription({ shortDescription: row.short_description ?? null,
        description: row.description, highlights: row.highlights ?? [], inTheBox: row.in_the_box ?? [] });
      if (!result.sections.length) { counts.noLegacyContent++; continue; }
      counts.candidates++;
      if (row.description) counts.withDescription++;
      if (row.highlights?.length) counts.withHighlights++;
      if (row.in_the_box?.length) counts.withInTheBox++;
      updates.push({ id: row.id, sections: result.sections });
    } catch { counts.invalidLegacy++; }
  }
  const digest = createHash('sha256').update(JSON.stringify({ version: 1, identity, rows: sorted, updates })).digest('hex');
  return { counts, updates, digest };
}

export function parseDescriptionBackfillArgs(args) {
  const parsed = { apply: false, approvedHost: '', approvedDigest: '', staffActor: '' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error('arguments');
    seen.add(arg);
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--dry-run') { /* default */ }
    else {
      const key = { '--approved-host': 'approvedHost', '--approved-digest': 'approvedDigest', '--staff-actor': 'staffActor' }[arg];
      if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
      parsed[key] = args[++i];
    }
  }
  if (seen.has('--apply') && seen.has('--dry-run')) throw new Error('arguments');
  if (!parsed.apply && (parsed.approvedHost || parsed.approvedDigest || parsed.staffActor)) throw new Error('arguments');
  if (parsed.apply && (!parsed.approvedHost || !/^[a-f0-9]{64}$/.test(parsed.approvedDigest) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(parsed.staffActor))) throw new Error('approval');
  return parsed;
}

/** Caller owns approval checks and transaction; shared writer supplies revisions and strict audit. */
export async function applyDescriptionBackfillUsing(tx, updates, staffActor) {
  const { writeProductContentUsing } = await jiti.import(path.join(root, 'src/lib/store-admin/product-content.ts'));
  for (const update of updates) {
    const changed = await writeProductContentUsing(tx, update.id,
      { descriptionSections: update.sections }, staffActor, { source: 'backfill' });
    if (!changed.changed) throw new Error('drift');
  }
}

async function snapshot(tx) {
  // A missing schema fails without DDL or fallback writes.
  return [...await tx`select id,description,highlights,in_the_box,short_description,
    description_sections,deleted_at,updated_at from products order by id`];
}

function report(plan, host, mode) {
  return { mode, host, digest: plan.digest, counts: plan.counts,
    source: 'Database products.description, products.highlights and products.in_the_box only. No static bundles, legacy product_specs or managed attributes are copied. No short description is generated.',
    note: 'Source counts overlap. Products lacking DB legacy content remain unchanged even if their storefront has static marketing. Non-null sections and existing short descriptions are always preserved. Dry-run does not authorise apply; obtain explicit approval of host, counts and digest after separate schema 0054 and 0056 installation.' };
}

async function main() {
  const args = parseDescriptionBackfillArgs(process.argv.slice(2));
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) {
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
    }
  } catch { /* environment configuration also supported */ }
  if (!process.env.DATABASE_URL) throw new Error('configuration');
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('configuration');
  if (args.apply && args.approvedHost !== url.host) throw new Error('approval');
  const identity = JSON.stringify({ host: url.host, database: url.pathname, role: url.username });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    connection: { default_transaction_read_only: args.apply ? 'off' : 'on', search_path: 'public', statement_timeout: 30000, lock_timeout: 5000 },
    onnotice: () => {} });
  try {
    if (!args.apply) {
      const plan = await sql.begin('isolation level repeatable read read only', async tx => {
        const [state] = await tx`show transaction_read_only`;
        if (state.transaction_read_only !== 'on') throw new Error('readonly');
        return planDescriptionBackfill(await snapshot(tx), identity);
      });
      console.log(JSON.stringify(report(plan, url.host, 'dry-run'), null, 2));
      return;
    }
    const plan = await sql.begin('isolation level read committed read write', async tx => {
      await tx`lock table products in share row exclusive mode`;
      const [actor] = await tx`select id from store_admins where id=${args.staffActor} and is_active and role='store_owner' for share`;
      if (!actor) throw new Error('actor');
      const fresh = planDescriptionBackfill(await snapshot(tx), identity);
      if (fresh.digest !== args.approvedDigest || fresh.counts.invalidLegacy > 0) throw new Error('approval');
      await applyDescriptionBackfillUsing(tx, fresh.updates, args.staffActor);
      if (fresh.updates.length) {
        const { writeAudit } = await jiti.import(path.join(root, 'src/lib/store-admin/audit.ts'));
        if (!await writeAudit({ actorId: args.staffActor, action: 'catalog.description.historical-backfill',
          entity: 'catalog', entityId: fresh.digest, after: { digest: fresh.digest, counts: fresh.counts },
          route: 'script:backfill-product-descriptions' }, tx)) throw new Error('audit');
      }
      return fresh;
    });
    console.log(JSON.stringify(report(plan, url.host, 'applied'), null, 2));
  } finally { await sql.end({ timeout: 5 }); }
}

// Importing the planner in tests never reads environment files or opens a client.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch {
    console.error('Description backfill refused or failed. No partial changes committed. Verify schema, configuration, owner and fresh host/counts/digest approval.');
    process.exitCode = 1;
  }
}
