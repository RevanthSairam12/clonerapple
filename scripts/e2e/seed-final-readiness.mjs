/**
 * Seeds the tagged fixtures the final-readiness browser E2E and load tests use.
 *
 * Every row it writes carries the run tag in its primary key or email so the
 * cleanup script can prove ownership before deleting anything:
 *   - users / store_admins: `*_<TAG>@example.invalid`
 *   - products / variants / colours / models / brands: `*_<TAG>` primary keys
 *
 * Idempotent: re-running resets passwords, stock counts and thresholds to the
 * documented values.
 *
 *   node --env-file=.env.local scripts/e2e/seed-final-readiness.mjs
 */
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const TAG = process.env.E2E_TAG ?? 'fr20261109';

export const fixtures = {
  tag: TAG,
  adminEmail: `test_admin_${TAG}@example.invalid`,
  customerAEmail: `test_cust_a_${TAG}@example.invalid`,
  customerBEmail: `test_cust_b_${TAG}@example.invalid`,
  password: 'TestPassword123!',
  productId: `test_product_${TAG}`,
  brandId: `test_brand_${TAG}`,
  modelId: `test_model_${TAG}`,
  colourBlackId: `test_col_blk_${TAG}`,
  colourBlueId: `test_col_blu_${TAG}`,
  variantBlackId: `test_var_blk_${TAG}`,
  variantBlueId: `test_var_blu_${TAG}`,
  skuBlack: `SKU-BLK-${TAG}`,
  skuBlue: `SKU-BLU-${TAG}`,
  customerAId: `usr_a_${TAG}`,
  customerBId: `usr_b_${TAG}`,
  adminId: `sa_${TAG}`,
  // Opening counts the tests expect: black 12 (threshold 3), blue 6 (threshold 2).
  blackOnHand: 12,
  blackLowStockThreshold: 3,
  blueOnHand: 6,
  blueLowStockThreshold: 2,
  blackPricePaise: 199900,
  bluePricePaise: 219900,
};

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });

async function seed() {
  const f = fixtures;
  const passwordHash = await bcrypt.hash(f.password, 12);

  await sql`
    insert into store_admins (id, email, password_hash, name, role, is_active, must_change_password, totp_enabled)
    values (${f.adminId}, ${f.adminEmail}, ${passwordHash}, 'Test Store Owner', 'store_owner', true, false, false)
    on conflict (id) do update set
      email = excluded.email,
      password_hash = excluded.password_hash,
      role = excluded.role,
      is_active = true,
      must_change_password = false,
      totp_enabled = false,
      removed_at = null
  `;

  await sql`
    insert into users (id, email, password_hash, first_name, last_name, customer_group, last_login_at)
    values
      (${f.customerAId}, ${f.customerAEmail}, ${passwordHash}, 'Asha', 'Sharma', 'retail', now()),
      (${f.customerBId}, ${f.customerBEmail}, ${passwordHash}, 'Rohan', 'Verma', 'retail', now())
    on conflict (id) do update set
      email = excluded.email,
      password_hash = excluded.password_hash,
      is_blocked = false
  `;

  // Shared reference data: reuse a colour/brand/model by name when the store
  // already has one, so the fixture never fights the unique-name constraints.
  async function ensureColour(id, name, hex) {
    const existing = await sql`select id from colours where name = ${name} limit 1`;
    if (existing.length > 0) return existing[0].id;
    await sql`insert into colours (id, name, hex, is_active) values (${id}, ${name}, ${hex}, true)`;
    return id;
  }

  async function ensureBrand(id, name) {
    const existing = await sql`select id from device_brands where name = ${name} limit 1`;
    if (existing.length > 0) return existing[0].id;
    await sql`insert into device_brands (id, name, is_active) values (${id}, ${name}, true)`;
    return id;
  }

  async function ensureModel(id, brandId, name) {
    const existing = await sql`select id from device_models where name = ${name} order by id limit 1`;
    if (existing.length > 0) return existing[0].id;
    await sql`insert into device_models (id, brand_id, name, is_active) values (${id}, ${brandId}, ${name}, true)`;
    return id;
  }

  const blackColourId = await ensureColour(f.colourBlackId, 'Midnight Black', '#1D1D1F');
  const blueColourId = await ensureColour(f.colourBlueId, 'Storm Blue', '#4A6B82');
  const brandId = await ensureBrand(f.brandId, `Test Brand ${TAG}`);
  const modelId = await ensureModel(f.modelId, brandId, 'iPhone 16 Pro');

  await sql`
    insert into products (
      id, category_id, slug, name, subtitle, price_paise, inventory_mode, is_active, in_stock,
      brand, short_description
    ) values (
      ${f.productId}, 'mobile-cases', ${f.productId},
      'Gadzio MagPulse Armor Case', 'Military-grade drop defense with MagSafe',
      ${f.blackPricePaise}, 'variant', true, true,
      'Gadzio', 'Staging fixture created by scripts/e2e/seed-final-readiness.mjs.'
    )
    on conflict (id) do update set
      category_id = excluded.category_id,
      inventory_mode = 'variant',
      is_active = true,
      in_stock = true,
      deleted_at = null
  `;

  await sql`
    insert into product_device_models (product_id, device_model_id)
    values (${f.productId}, ${modelId})
    on conflict (product_id, device_model_id) do nothing
  `;

  await sql`
    insert into product_variants (
      id, product_id, sku, option_name, option_value, option_hex, is_purchasable, is_active,
      device_model_id, combination_key, price_paise_override
    ) values
      (${f.variantBlackId}, ${f.productId}, ${f.skuBlack}, 'Colour', 'Midnight Black', '#1D1D1F', true, true, ${modelId}, ${f.variantBlackId}, ${f.blackPricePaise}),
      (${f.variantBlueId}, ${f.productId}, ${f.skuBlue}, 'Colour', 'Storm Blue', '#4A6B82', true, true, ${modelId}, ${f.variantBlueId}, ${f.bluePricePaise})
    on conflict (id) do update set
      is_purchasable = true,
      is_active = true,
      retired_at = null,
      device_model_id = excluded.device_model_id,
      price_paise_override = excluded.price_paise_override
  `;

  await sql`
    insert into product_variant_colours (variant_id, product_id, colour_id)
    values
      (${f.variantBlackId}, ${f.productId}, ${blackColourId}),
      (${f.variantBlueId}, ${f.productId}, ${blueColourId})
    on conflict (variant_id) do update set colour_id = excluded.colour_id
  `;

  await sql`
    insert into product_images (id, product_id, url, alt, role, sort_order, is_active)
    values
      (${`img_pri_${TAG}`}, ${f.productId}, '/sites/cases-protection/images/iphone17-silicone-black.jpg', 'Gadzio MagPulse Armor Case - Primary', 'primary', 0, true),
      (${`img_gal_${TAG}`}, ${f.productId}, '/sites/cases-protection/images/iphone17pro-clear-magsafe.jpg', 'Gadzio MagPulse Armor Case - Side Angle', 'gallery', 1, true)
    on conflict (id) do update set url = excluded.url, alt = excluded.alt
  `;

  await sql`
    insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold)
    values
      (${`stk_blk_${TAG}`}, ${f.productId}, ${f.variantBlackId}, ${f.blackOnHand}, 0, true, ${f.blackLowStockThreshold}),
      (${`stk_blu_${TAG}`}, ${f.productId}, ${f.variantBlueId}, ${f.blueOnHand}, 0, true, ${f.blueLowStockThreshold})
    on conflict (id) do update set
      on_hand = excluded.on_hand,
      reserved = 0,
      track_inventory = true,
      low_stock_threshold = excluded.low_stock_threshold
  `;

  console.log(`Seeded fixtures for tag ${TAG}.`);
}

seed()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error('Seed failed:', error.message);
    await sql.end();
    process.exit(1);
  });
