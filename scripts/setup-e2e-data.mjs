/**
 * Setup isolated staging test data for Task 1 E2E Verification.
 * All records carry explicit test tags for 100% deterministic cleanup.
 */
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const TAG = 'e2e_test_20261108';
export const TEST_ADMIN_EMAIL = `test_admin_${TAG}@example.invalid`;
export const TEST_CUST_A_EMAIL = `test_cust_a_${TAG}@example.invalid`;
export const TEST_CUST_B_EMAIL = `test_cust_b_${TAG}@example.invalid`;
export const TEST_PASSWORD = 'TestPassword123!';

export const TEST_PRODUCT_ID = `test_product_${TAG}`;
export const TEST_VAR_BLACK_ID = `test_var_blk_${TAG}`;
export const TEST_VAR_BLUE_ID = `test_var_blu_${TAG}`;
export const TEST_MODEL_ID = `test_model_${TAG}`;
export const TEST_BRAND_ID = `test_brand_${TAG}`;
export const TEST_COL_BLACK_ID = `test_col_blk_${TAG}`;
export const TEST_COL_BLUE_ID = `test_col_blu_${TAG}`;

async function setup() {
  console.log('Seeding staging test data for E2E...');

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  // 1. Store Admin
  await sql`
    insert into store_admins (id, email, password_hash, name, role, is_active)
    values (${`sa_${TAG}`}, ${TEST_ADMIN_EMAIL}, ${passwordHash}, 'Test Store Owner', 'store_owner', true)
    on conflict (email) do update set password_hash = ${passwordHash}, is_active = true
  `;

  // 2. Customers A and B
  const custAId = `usr_a_${TAG}`;
  const custBId = `usr_b_${TAG}`;

  await sql`
    insert into users (id, email, password_hash, first_name, last_name, customer_group, last_login_at)
    values
      (${custAId}, ${TEST_CUST_A_EMAIL}, ${passwordHash}, 'Asha', 'Sharma', 'retail', now()),
      (${custBId}, ${TEST_CUST_B_EMAIL}, ${passwordHash}, 'Rohan', 'Verma', 'retail', now())
    on conflict (email) do update set password_hash = ${passwordHash}
  `;

  // 3. Category, Brand, Model, Colours
  await sql`
    insert into categories (id, slug, name, is_active)
    values ('mobile-cases', 'mobile-cases', 'Mobile Cases', true)
    on conflict (id) do nothing
  `;

  await sql`
    insert into device_brands (id, name, is_active)
    values (${TEST_BRAND_ID}, 'Apple', true)
    on conflict (id) do nothing
  `;

  await sql`
    insert into device_models (id, brand_id, name, is_active)
    values (${TEST_MODEL_ID}, ${TEST_BRAND_ID}, 'iPhone 16 Pro', true)
    on conflict (id) do nothing
  `;

  await sql`
    insert into colours (id, name, hex, is_active)
    values
      (${TEST_COL_BLACK_ID}, 'Midnight Black', '#1D1D1F', true),
      (${TEST_COL_BLUE_ID}, 'Storm Blue', '#4A6B82', true)
    on conflict (id) do nothing
  `;

  // 4. Test Variant Product
  await sql`
    insert into products (
      id, category_id, slug, name, subtitle, price_paise, inventory_mode, is_active, in_stock
    ) values (
      ${TEST_PRODUCT_ID}, 'mobile-cases', ${TEST_PRODUCT_ID},
      'Gadzio MagPulse Armor Case', 'Military-Grade Drop Defense with MagSafe',
      199900, 'variant', true, true
    )
    on conflict (id) do update set
      inventory_mode = 'variant',
      is_active = true,
      in_stock = true
  `;

  await sql`
    insert into product_device_models (product_id, device_model_id)
    values (${TEST_PRODUCT_ID}, ${TEST_MODEL_ID})
    on conflict (product_id, device_model_id) do nothing
  `;

  // 5. Product Variants
  await sql`
    insert into product_variants (
      id, product_id, sku, option_name, option_value, option_hex, is_purchasable, is_active,
      device_model_id, combination_key, price_paise_override
    ) values
      (${TEST_VAR_BLACK_ID}, ${TEST_PRODUCT_ID}, ${`SKU-BLK-${TAG}`}, 'Colour', 'Midnight Black', '#1d1d1f', true, true, ${TEST_MODEL_ID}, ${TEST_VAR_BLACK_ID}, 199900),
      (${TEST_VAR_BLUE_ID}, ${TEST_PRODUCT_ID}, ${`SKU-BLU-${TAG}`}, 'Colour', 'Storm Blue', '#4a6b82', true, true, ${TEST_MODEL_ID}, ${TEST_VAR_BLUE_ID}, 219900)
    on conflict (id) do update set
      is_purchasable = true,
      is_active = true,
      price_paise_override = excluded.price_paise_override
  `;

  await sql`
    insert into product_variant_colours (variant_id, product_id, colour_id)
    values
      (${TEST_VAR_BLACK_ID}, ${TEST_PRODUCT_ID}, ${TEST_COL_BLACK_ID}),
      (${TEST_VAR_BLUE_ID}, ${TEST_PRODUCT_ID}, ${TEST_COL_BLUE_ID})
    on conflict (variant_id) do nothing
  `;

  // 5b. Product Images
  await sql`
    insert into product_images (
      id, product_id, url, alt, role, sort_order, is_active
    ) values
      (${`img_pri_${TAG}`}, ${TEST_PRODUCT_ID}, '/sites/cases-protection/images/iphone17-silicone-black.jpg', 'Gadzio MagPulse Armor Case - Primary', 'primary', 0, true),
      (${`img_gal_${TAG}`}, ${TEST_PRODUCT_ID}, '/sites/cases-protection/images/iphone17pro-clear-magsafe.jpg', 'Gadzio MagPulse Armor Case - Side Angle', 'gallery', 1, true)
    on conflict (id) do nothing
  `;

  // 6. Stock
  await sql`
    insert into stock (
      id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold
    ) values
      (${`stk_blk_${TAG}`}, ${TEST_PRODUCT_ID}, ${TEST_VAR_BLACK_ID}, 12, 0, true, 3),
      (${`stk_blu_${TAG}`}, ${TEST_PRODUCT_ID}, ${TEST_VAR_BLUE_ID}, 6, 0, true, 2)
    on conflict (id) do update set
      on_hand = excluded.on_hand,
      reserved = 0,
      track_inventory = true,
      low_stock_threshold = excluded.low_stock_threshold
  `;

  console.log('Staging test data seeded successfully.');
  await sql.end();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
