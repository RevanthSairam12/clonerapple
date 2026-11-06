#!/usr/bin/env node
/**
 * Read-only audit of option → shared colour relationships.
 *
 * Colour identity on the storefront comes only from `product_variant_colours`,
 * never from an option label or hex. This reports the rows that cannot be sold
 * exactly because that relationship is missing, duplicated or inconsistent, so
 * the owner can correct them in the admin. It never writes, never creates a
 * colour, and never touches stock, price or variant identity.
 *
 * Usage:
 *   node scripts/audit-variant-colours.mjs           # human summary
 *   node scripts/audit-variant-colours.mjs --json    # machine-readable
 *
 * Exit code is 1 when anything needs correction, so it can gate a release.
 */
import fs from 'node:fs';
import postgres from 'postgres';

function argument(name) {
  return process.argv.slice(2).includes(name);
}

function connection() {
  const env = {};
  if (fs.existsSync('.env.local')) {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const url = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error('configuration');
  return { url, ssl: (process.env.DATABASE_SSL || env.DATABASE_SSL) === 'false' ? undefined : 'require' };
}

/** Same normalisation the shared-colour imports use: case and punctuation folded. */
function sharedKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const { url, ssl } = connection();
const sql = postgres(url, {
  max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, ssl, onnotice: () => {},
  connection: { default_transaction_read_only: 'on', search_path: 'public', statement_timeout: 30000, lock_timeout: 3000 },
});

try {
  const report = await sql.begin('isolation level repeatable read read only', async (tx) => {
    const [state] = await tx`show transaction_read_only`;
    if (state.transaction_read_only !== 'on') throw new Error('readonly');

    // Every sellable row, with whatever colour link it has.
    const variants = await tx`
      select p.id as product_id, p.name as product_name, p.sell_by, p.inventory_mode,
             v.id as variant_id, v.option_name, v.option_value, v.option_identity,
             v.device_model_id,
             pvc.colour_id, c.name as colour_name, c.is_active as colour_active
      from product_variants v
      join products p on p.id = v.product_id and p.deleted_at is null
      left join product_variant_colours pvc
        on pvc.variant_id = v.id and pvc.product_id = v.product_id
      left join colours c on c.id = pvc.colour_id
      where v.is_active and v.is_purchasable and v.retired_at is null
      order by p.id, v.sort_order, v.option_value
    `;

    const colours = await tx`select id, name, hex, is_active from colours order by id`;
    const linkCount = await tx`
      select variant_id, count(*)::int as links
      from product_variant_colours group by variant_id having count(*) > 1
    `;

    const unlinked = variants.filter((row) => row.colour_id === null || row.colour_id === undefined);
    const inactive = variants.filter((row) => row.colour_id != null && row.colour_active !== true);
    const orphan = variants.filter((row) => row.colour_id != null && row.colour_active === null);
    // A link whose colour disagrees with the row's own recorded identity is
    // reported for review, never rewritten: only the owner knows the truth.
    const mismatch = variants.filter((row) => {
      if (row.colour_id == null || row.colour_name == null) return false;
      const identity = sharedKey(row.option_identity);
      return Boolean(identity) && sharedKey(row.colour_name) !== identity;
    });

    // Group unlinked rows by product and model, so the report says whether the
    // product is merely missing links or cannot be told apart at all.
    const products = new Map();
    for (const row of variants) {
      if (!products.has(row.product_id)) products.set(row.product_id, {
        productId: row.product_id, productName: row.product_name, sellBy: row.sell_by,
        inventoryMode: row.inventory_mode, variants: 0, unlinked: 0, inactiveLink: 0, mismatch: 0,
        models: new Map(),
      });
      const entry = products.get(row.product_id);
      entry.variants += 1;
      if (row.colour_id == null) entry.unlinked += 1;
      if (row.colour_id != null && row.colour_active !== true) entry.inactiveLink += 1;
      if (mismatch.includes(row)) entry.mismatch += 1;
      const modelKey = row.device_model_id ?? null;
      if (row.colour_id == null) {
        entry.models.set(modelKey, (entry.models.get(modelKey) ?? 0) + 1);
      }
    }

    const needsCorrection = [...products.values()]
      .filter((entry) => entry.unlinked > 0 || entry.inactiveLink > 0 || entry.mismatch > 0)
      .map((entry) => ({
        productId: entry.productId,
        productName: entry.productName,
        sellBy: entry.sellBy,
        inventoryMode: entry.inventoryMode,
        variants: entry.variants,
        unlinked: entry.unlinked,
        inactiveLink: entry.inactiveLink,
        mismatch: entry.mismatch,
        // Model groups with more than one unlinked row cannot be offered at all.
        ambiguousModels: [...entry.models.values()].filter((count) => count > 1).length,
        requiresColourButHasNone: entry.sellBy === 'colour' || entry.sellBy === 'model_colour'
          ? entry.unlinked > 0 : false,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId));

    const duplicateColours = [];
    for (const [field, key] of [['name', 'name'], ['hex', 'hex']]) {
      const groups = new Map();
      for (const colour of colours) {
        const value = field === 'name' ? sharedKey(colour.name) : String(colour.hex).toUpperCase();
        groups.set(value, [...(groups.get(value) ?? []), colour.id]);
      }
      for (const [value, ids] of groups) {
        if (ids.length > 1) duplicateColours.push({ field: key, value, ids });
      }
    }

    return {
      mode: 'read-only',
      counts: {
        products: products.size,
        variants: variants.length,
        colours: colours.length,
        unlinkedVariants: unlinked.length,
        inactiveLinkVariants: inactive.length,
        orphanLinks: orphan.length,
        identityMismatches: mismatch.length,
        duplicateLinks: linkCount.length,
        duplicateColours: duplicateColours.length,
        productsNeedingCorrection: needsCorrection.length,
      },
      productsNeedingCorrection: needsCorrection,
      duplicateColours,
      duplicateLinks: linkCount.map((row) => ({ variantId: row.variant_id, links: row.links })),
      orphanLinks: orphan.length,
    };
  });

  if (argument('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const c = report.counts;
    console.log(`Read-only colour audit — ${c.products} products, ${c.variants} sellable options, ${c.colours} shared colours.`);
    console.log(`Unlinked options: ${c.unlinkedVariants} · inactive links: ${c.inactiveLinkVariants} · identity mismatches: ${c.identityMismatches}`);
    if (report.productsNeedingCorrection.length) {
      console.log('\nNeeds correction in the admin:');
      for (const entry of report.productsNeedingCorrection) {
        const flags = [
          entry.unlinked ? `${entry.unlinked}/${entry.variants} without a colour` : null,
          entry.ambiguousModels ? `${entry.ambiguousModels} model group(s) unsellable` : null,
          entry.inactiveLink ? `${entry.inactiveLink} inactive colour link(s)` : null,
          entry.mismatch ? `${entry.mismatch} colour/identity mismatch(es)` : null,
          entry.requiresColourButHasNone ? `sell_by=${entry.sellBy}` : null,
        ].filter(Boolean);
        console.log(`  ${entry.productId} — ${entry.productName}: ${flags.join('; ')}`);
      }
    } else {
      console.log('\nEvery sellable option has a usable shared colour relationship.');
    }
    if (report.duplicateColours.length) {
      console.log('\nDuplicate shared colour records (not modified):');
      for (const entry of report.duplicateColours) console.log(`  ${entry.field}=${entry.value}: ${entry.ids.join(', ')}`);
    }
  }

  const dirty = report.counts.productsNeedingCorrection > 0
    || report.counts.duplicateColours > 0
    || report.counts.duplicateLinks > 0
    || report.counts.orphanLinks > 0;
  process.exitCode = dirty ? 1 : 0;
} catch {
  console.error('Colour audit refused or failed; no writes attempted. Connection/error details withheld.');
  process.exitCode = 2;
} finally {
  await sql.end({ timeout: 5 });
}
