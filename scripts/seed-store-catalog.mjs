/**
 * Seed the store catalogue from ../catalog-snapshot.json.
 *
 * The snapshot is produced by scripts/dump-catalog-snapshot.mjs from the
 * project's runtime TypeScript modules, so the seeded prices are exactly what
 * checkout currently charges.
 *
 * Idempotent:
 *   - categories, products, facet defs, brands, units, attributes and options
 *     are inserted with on-conflict updates;
 *   - derived children (facets, specs, images, attribute values) are replaced
 *     for the seeded rows inside one transaction;
 *   - a price_history row is written only when the price is new or changed;
 *   - stock rows are created once and never have their counts overwritten;
 *   - each run appends one catalog.seed row to store_admin_audit.
 *
 * Usage:
 *   node scripts/seed-store-catalog.mjs --dry-run   # counts only, no database
 *   node scripts/seed-store-catalog.mjs
 *
 * Requires DATABASE_URL in .env.local (or the environment). Never prints the
 * connection string or any key.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const SNAPSHOT_PATH = path.resolve(ROOT, '..', 'catalog-snapshot.json');
const DRY_RUN = process.argv.includes('--dry-run');

const UNITS = [
  { id: 'pcs', code: 'pcs', label: 'Pieces', dimension: 'count', base_code: 'pcs', factor: 1 },
  { id: 'g', code: 'g', label: 'Grams', dimension: 'mass', base_code: 'g', factor: 1 },
  { id: 'kg', code: 'kg', label: 'Kilograms', dimension: 'mass', base_code: 'g', factor: 1000 },
  { id: 'mm', code: 'mm', label: 'Millimetres', dimension: 'length', base_code: 'mm', factor: 1 },
  { id: 'cm', code: 'cm', label: 'Centimetres', dimension: 'length', base_code: 'mm', factor: 10 },
  { id: 'in', code: 'in', label: 'Inches', dimension: 'length', base_code: 'mm', factor: 25.4 },
  { id: 'ml', code: 'ml', label: 'Millilitres', dimension: 'volume', base_code: 'ml', factor: 1 },
  { id: 'l', code: 'l', label: 'Litres', dimension: 'volume', base_code: 'ml', factor: 1000 },
];

const ATTRIBUTE_LABELS = {
  model: 'Model',
  material: 'Material',
  brand: 'Brand',
  wattage: 'Wattage',
  connector: 'Connector',
  driver: 'Driver Type',
  type: 'Case Type',
};

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveReferenceData(snapshot) {
  const brands = new Map();
  for (const product of snapshot.products) {
    const name = (product.brand ?? '').trim();
    if (!name) continue;
    const id = slugify(name);
    if (!brands.has(name)) brands.set(name, { id, slug: id, name });
  }

  const attributes = new Map();
  for (const category of snapshot.categories) {
    for (const def of category.facet_defs ?? []) {
      if (!attributes.has(def.facet_key)) {
        attributes.set(def.facet_key, {
          id: slugify(def.facet_key),
          key: def.facet_key,
          label: ATTRIBUTE_LABELS[def.facet_key] ?? def.label,
          data_type: 'enum',
          is_filterable: true,
          is_variant_option: false,
          sort_order: attributes.size,
          options: new Map(),
        });
      }
      const attribute = attributes.get(def.facet_key);
      for (const option of def.options ?? []) {
        if (!attribute.options.has(option)) {
          attribute.options.set(option, attribute.options.size);
        }
      }
    }
  }

  return { brands, attributes };
}

function buildCounts(snapshot, reference) {
  const perCategory = {};
  for (const product of snapshot.products) {
    perCategory[product.category_slug] = (perCategory[product.category_slug] ?? 0) + 1;
  }

  return {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    categories: snapshot.categories.length,
    products: snapshot.products.length,
    perCategory,
    facetDefs: snapshot.categories.reduce(
      (total, category) => total + (category.facet_defs?.length ?? 0),
      0,
    ),
    productFacets: snapshot.products.reduce(
      (total, product) => total + product.facets.length,
      0,
    ),
    productSpecs: snapshot.products.reduce(
      (total, product) => total + product.specs.length,
      0,
    ),
    productImages: snapshot.products.reduce(
      (total, product) => total + product.images.length,
      0,
    ),
    productVariants: snapshot.products.reduce(
      (total, product) => total + product.colors.length,
      0,
    ),
    productAttributeValues: snapshot.products.reduce(
      (total, product) =>
        total +
        new Set(product.facets.map((facet) => facet.facet_key)).size,
      0,
    ),
    brands: reference.brands.size,
    units: UNITS.length,
    attributes: reference.attributes.size,
    attributeOptions: [...reference.attributes.values()].reduce(
      (total, attribute) => total + attribute.options.size,
      0,
    ),
    stockRows: snapshot.products.length,
    priceHistoryRowsOnFreshSeed: snapshot.products.length,
  };
}

async function readSnapshot() {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));
  } catch {
    console.error(
      'Could not read ../catalog-snapshot.json. Run scripts/dump-catalog-snapshot.mjs first.',
    );
    process.exit(1);
  }
}

// Minimal .env.local loader, matching scripts/migrate.mjs.
async function loadEnvLocal() {
  try {
    const env = await readFile(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // DATABASE_URL may come from the real environment instead.
  }
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
    process.exit(1);
  }
}

async function seed(snapshot, reference) {
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    onnotice: () => {},
  });

  const summary = {
    categories: 0,
    products: 0,
    productFacets: 0,
    productSpecs: 0,
    productImages: 0,
    productVariants: 0,
    productAttributeValues: 0,
    brands: 0,
    units: 0,
    attributes: 0,
    attributeOptions: 0,
    stockRows: 0,
    priceHistoryRows: 0,
  };

  try {
    await sql.begin(async (tx) => {
      /* ------------------------------------------------------- reference */

      for (const unit of UNITS) {
        await tx`
          insert into units (id, code, label, dimension, base_code, factor)
          values (${unit.id}, ${unit.code}, ${unit.label}, ${unit.dimension},
                  ${unit.base_code}, ${unit.factor})
          on conflict (id) do update set
            code = excluded.code,
            label = excluded.label,
            dimension = excluded.dimension,
            base_code = excluded.base_code,
            factor = excluded.factor
        `;
        summary.units += 1;
      }

      for (const brand of reference.brands.values()) {
        await tx`
          insert into brands (id, slug, name, is_active, sort_order, updated_by)
          values (${brand.id}, ${brand.slug}, ${brand.name}, true, 0, 'seed')
          on conflict (id) do update set
            slug = excluded.slug,
            name = excluded.name,
            updated_at = now(),
            updated_by = 'seed'
        `;
        summary.brands += 1;
      }

      for (const attribute of reference.attributes.values()) {
        await tx`
          insert into attributes (
            id, key, label, data_type, is_filterable, is_variant_option,
            sort_order, is_active
          ) values (
            ${attribute.id}, ${attribute.key}, ${attribute.label},
            ${attribute.data_type}, ${attribute.is_filterable},
            ${attribute.is_variant_option}, ${attribute.sort_order}, true
          )
          on conflict (id) do update set
            key = excluded.key,
            label = excluded.label,
            data_type = excluded.data_type,
            is_filterable = excluded.is_filterable,
            is_variant_option = excluded.is_variant_option,
            sort_order = excluded.sort_order
        `;
        summary.attributes += 1;

        // Options are derived, so replacing them for this attribute keeps the
        // seed convergent without touching other attributes.
        await tx`delete from attribute_options where attribute_id = ${attribute.id}`;
        for (const [value, sortOrder] of attribute.options) {
          await tx`
            insert into attribute_options (attribute_id, value, sort_order)
            values (${attribute.id}, ${value}, ${sortOrder})
            on conflict (attribute_id, value) do update set
              sort_order = excluded.sort_order
          `;
          summary.attributeOptions += 1;
        }
      }

      /* ------------------------------------------------------- categories */

      for (const category of snapshot.categories) {
        await tx`
          insert into categories (
            id, slug, name, title, subhead, breadcrumb_leaf, count_noun,
            disclaimer, seo_title, seo_description, nav_label, nav_href,
            sort_order, is_active, updated_by
          ) values (
            ${category.id}, ${category.slug}, ${category.name},
            ${category.title}, ${category.subhead}, ${category.breadcrumb_leaf},
            ${category.count_noun}, ${category.disclaimer},
            ${category.seo_title}, ${category.seo_description},
            ${category.nav_label}, ${category.nav_href},
            ${category.sort_order}, true, 'seed'
          )
          on conflict (id) do update set
            slug = excluded.slug,
            name = excluded.name,
            title = excluded.title,
            subhead = excluded.subhead,
            breadcrumb_leaf = excluded.breadcrumb_leaf,
            count_noun = excluded.count_noun,
            disclaimer = excluded.disclaimer,
            seo_title = excluded.seo_title,
            seo_description = excluded.seo_description,
            nav_label = excluded.nav_label,
            nav_href = excluded.nav_href,
            sort_order = excluded.sort_order,
            updated_at = now(),
            updated_by = 'seed'
        `;
        summary.categories += 1;

        await tx`delete from facet_defs where category_id = ${category.id}`;
        for (const def of category.facet_defs ?? []) {
          await tx`
            insert into facet_defs (
              category_id, facet_key, label, options, is_quick_pill, sort_order
            ) values (
              ${category.id}, ${def.facet_key}, ${def.label},
              ${JSON.stringify(def.options)}::jsonb, ${def.is_quick_pill},
              ${def.sort_order}
            )
            on conflict (category_id, facet_key) do update set
              label = excluded.label,
              options = excluded.options,
              is_quick_pill = excluded.is_quick_pill,
              sort_order = excluded.sort_order
          `;
        }
      }

      /* --------------------------------------------------------- products */

      for (const product of snapshot.products) {
        const brand = reference.brands.get(product.brand);
        const brandId = brand ? brand.id : null;

        await tx`
          insert into products (
            id, category_id, slug, name, subtitle, price_paise, currency,
            material, brand, brand_id, description, badge, highlights,
            in_the_box, seo_title, seo_description, in_stock, is_active,
            sort_order, updated_by
          ) values (
            ${product.id}, ${product.category_id}, ${product.slug},
            ${product.name}, ${product.subtitle}, ${product.price_paise},
            ${product.currency}, ${product.material}, ${product.brand},
            ${brandId}, ${product.description}, ${product.badge},
            ${JSON.stringify(product.highlights)}::jsonb,
            ${JSON.stringify(product.in_the_box)}::jsonb,
            ${product.seo_title ?? ''}, ${product.seo_description ?? ''},
            ${product.in_stock}, ${product.is_active}, ${product.sort_order},
            'seed'
          )
          -- price_paise is deliberately not updated here. Once checkout reads
          -- the database, the row is authoritative and a re-seed must never
          -- undo an audited price change. New rows still get the snapshot price.
          on conflict (id) do update set
            category_id = excluded.category_id,
            slug = excluded.slug,
            name = excluded.name,
            subtitle = excluded.subtitle,
            currency = excluded.currency,
            material = excluded.material,
            brand = excluded.brand,
            brand_id = excluded.brand_id,
            description = excluded.description,
            badge = excluded.badge,
            highlights = excluded.highlights,
            in_the_box = excluded.in_the_box,
            seo_title = excluded.seo_title,
            seo_description = excluded.seo_description,
            in_stock = excluded.in_stock,
            sort_order = excluded.sort_order,
            updated_at = now(),
            updated_by = 'seed'
        `;
        summary.products += 1;

        // Derived rows: replace, so a changed snapshot converges.
        await tx`delete from product_facets where product_id = ${product.id}`;
        for (const facet of product.facets) {
          await tx`
            insert into product_facets (
              product_id, facet_key, facet_value, sort_order
            ) values (
              ${product.id}, ${facet.facet_key}, ${facet.facet_value},
              ${facet.sort_order}
            )
            on conflict (product_id, facet_key, facet_value) do update set
              sort_order = excluded.sort_order
          `;
          summary.productFacets += 1;
        }

        await tx`delete from product_specs where product_id = ${product.id}`;
        for (const spec of product.specs) {
          await tx`
            insert into product_specs (product_id, label, value, sort_order)
            values (${product.id}, ${spec.label}, ${spec.value}, ${spec.sort_order})
            on conflict (product_id, label) do update set
              value = excluded.value,
              sort_order = excluded.sort_order
          `;
          summary.productSpecs += 1;
        }

        await tx`delete from product_images where product_id = ${product.id}`;
        for (const image of product.images) {
          const imageId = `${product.id}-${image.role}-${image.sort_order}`;
          await tx`
            insert into product_images (
              id, product_id, url, alt, role, sort_order, is_active
            ) values (
              ${imageId}, ${product.id}, ${image.url}, ${image.alt},
              ${image.role}, ${image.sort_order}, true
            )
            on conflict (id) do update set
              url = excluded.url,
              alt = excluded.alt,
              role = excluded.role,
              sort_order = excluded.sort_order,
              is_active = true,
              deleted_at = null
          `;
          summary.productImages += 1;
        }

        // Variants are display metadata. Deactivate everything for this
        // product, then reactivate the snapshot rows; a removed colour stays
        // in the table as inactive rather than losing its history.
        await tx`
          update product_variants set is_active = false
          where product_id = ${product.id}
        `;
        for (let index = 0; index < product.colors.length; index += 1) {
          const color = product.colors[index];
          const variantId = `${product.id}-c-${index}-${slugify(color.name) || 'colour'}`;
          await tx`
            insert into product_variants (
              id, product_id, option_name, option_value, option_hex,
              is_active, sort_order
            ) values (
              ${variantId}, ${product.id}, 'Colour', ${color.name},
              ${color.hex ?? null}, true, ${index}
            )
            on conflict (id) do update set
              option_name = excluded.option_name,
              option_value = excluded.option_value,
              option_hex = excluded.option_hex,
              is_active = true,
              sort_order = excluded.sort_order
          `;
          summary.productVariants += 1;
        }

        // product_attribute_values holds one value per attribute; the full
        // multi-value facet set stays in product_facets.
        await tx`
          delete from product_attribute_values where product_id = ${product.id}
        `;
        const seenAttributes = new Set();
        for (const facet of product.facets) {
          if (seenAttributes.has(facet.facet_key)) continue;
          if (!reference.attributes.has(facet.facet_key)) continue;
          seenAttributes.add(facet.facet_key);
          await tx`
            insert into product_attribute_values (
              product_id, attribute_id, option_value
            ) values (
              ${product.id}, ${reference.attributes.get(facet.facet_key).id},
              ${facet.facet_value}
            )
            on conflict (product_id, attribute_id) do update set
              option_value = excluded.option_value
          `;
          summary.productAttributeValues += 1;
        }

        // Stock is recorded and displayed, not enforced. Never overwrite
        // counts that an operator may have set later.
        const stockId = product.id;
        await tx`
          insert into stock (
            id, product_id, variant_id, on_hand, reserved,
            low_stock_threshold, track_inventory, updated_by
          ) values (
            ${stockId}, ${product.id}, null, 0, 0, 0, false, 'seed'
          )
          on conflict (id) do update set
            updated_at = now(),
            updated_by = 'seed'
        `;
        summary.stockRows += 1;

        // Append one history row only when the price is new or changed.
        const latest = await tx`
          select new_price_paise
          from price_history
          where product_id = ${product.id}
          order by changed_at desc, id desc
          limit 1
        `;
        const previousPrice = latest[0] ? Number(latest[0].new_price_paise) : null;
        if (previousPrice !== product.price_paise) {
          await tx`
            insert into price_history (
              product_id, variant_id, old_price_paise, new_price_paise,
              currency, reason, source, changed_by
            ) values (
              ${product.id}, null, ${previousPrice}, ${product.price_paise},
              ${product.currency},
              ${previousPrice === null
                ? 'Initial catalogue seed from runtime snapshot'
                : 'Seed price updated from runtime snapshot'},
              'seed', 'seed'
            )
          `;
          summary.priceHistoryRows += 1;
        }
      }

      /* ------------------------------------------------------------- audit */

      await tx`
        insert into store_admin_audit (
          actor_id, actor_email, action, entity, entity_id, before, after,
          route, status, reason
        ) values (
          null, '', 'catalog.seed', 'catalog', 'store_catalog', null,
          ${JSON.stringify(summary)}::jsonb,
          'scripts/seed-store-catalog.mjs', 'ok',
          'Seed from runtime catalog snapshot'
        )
      `;
    });
  } finally {
    await sql.end();
  }

  return summary;
}

async function main() {
  const snapshot = await readSnapshot();
  const reference = deriveReferenceData(snapshot);
  const counts = buildCounts(snapshot, reference);

  if (DRY_RUN) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }

  await loadEnvLocal();
  requireDatabaseUrl();

  try {
    const summary = await seed(snapshot, reference);
    console.log('Seed complete.');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error('Seed failed:', error instanceof Error ? error.message : 'unknown error');
    console.error('Apply migrations 0010-0012 first, then retry.');
    process.exitCode = 1;
  }
}

main();
