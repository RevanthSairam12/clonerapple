# Gadzio Product Editor Simplification – Product-Specific Variants & Central Device Models

Act as a senior full-stack engineer and database architect working in the existing Gadzio codebase.

## Objective

Simplify the product creation and editing workflow.

Currently, creating products depends heavily on shared Catalogue Data configuration, including product types, attribute definitions, attribute mappings, device brands and device models.

This makes ordinary product creation unnecessarily complicated.

I want to change the workflow so that:

1. Device brands and device models remain in one central reusable database.
2. Each product independently manages its own specifications, colours, models, options, SKUs and inventory.
3. Admins can add a new device model when needed without leaving the product workflow.
4. Ordinary product creation should not require visiting Catalogue Data or configuring attribute mappings first.

The goal is to make product creation simple while retaining proper data relationships, inventory safety and historical records.

---

## 1. Simplify Catalogue Data

Reduce the dependency on the existing Catalogue Data system for everyday product creation.

### Keep centrally managed:

- Device brands (Apple, Samsung, OnePlus, etc.).
- Device models (iPhone 16, Galaxy S25, etc.).

Maintain a single shared device database.

Do not create duplicate device records for individual products.

### Product types and attributes

- Keep the existing product type and attribute infrastructure where necessary.
- Make advanced attribute configuration optional for ordinary products.
- Do not require an owner to manually create attribute definitions and mappings for every new product.
- Allow products to maintain their own specifications.
- Preserve existing structured attributes and existing product references.
- Do not remove existing catalogue functionality without proving it is no longer needed.

---

## 2. Create a Simple Central Device Models Manager

Provide a straightforward management section inside Store Admin.

Suggested location:

Store Admin → Device Models

Features:

- Add device brand.
- Add device model.
- Search device models.
- Filter by device brand.
- Activate/deactivate models.
- Prevent duplicate models under the same brand.
- Edit display names safely.
- Preserve stable database identities.

Example:

Apple:
- iPhone 15
- iPhone 16
- iPhone 16 Pro
- iPhone 17

Samsung:
- Galaxy S24
- Galaxy S25
- Galaxy S25 Ultra

OnePlus:
- Nord 4
- Nord 5

This must use the existing compatible-device database and relationships wherever possible.

Do not create a second device database.

### Add model without leaving product creation

Inside the product editor's compatible-device selector, provide an Add New Model action.

Workflow:

1. Admin opens the compatible-device dropdown.
2. Searches for a device.
3. If the model doesn't exist, selects Add New Model.
4. Enters the device brand and exact model name.
5. Saves the new device model.
6. The new model becomes available in the current product editor.
7. Admin explicitly selects it.

Adding a device model must never automatically declare it compatible with the product.

Preserve unsaved product changes when adding a new model.

---

## 3. Make Product Specifications Product-Specific

Products should be able to maintain their own specifications without mandatory global attribute configuration.

Example:

Product A: Gadzio Premium Case
- Material: Silicone
- Finish: Matte
- Protection: Shock Resistant

Product B: Gadzio Fast Charger
- Wattage: 35W
- Connector: USB-C
- Charging: Fast Charging

Product C: Gadzio USB Cable
- Length: 1 metre
- Connector: USB-C
- Material: Braided

Provide a simple interface to:

- Add specification.
- Enter specification name.
- Enter specification value.
- Edit specifications.
- Remove or archive specifications safely.

Specifications must belong to the relevant product.

Do not accidentally expose internal fields such as cost, audit information or stock-management metadata.

Preserve existing structured attributes and historical data. Avoid destructive migrations.

---

## 4. Product-Specific Models and Colours

This is the most important part.

Every product should independently define which models and colours it offers.

Example:

Product: Gadzio Premium Back Case

Compatible device models:
- iPhone 15
- iPhone 16
- iPhone 16 Pro

Available colours:
- Black
- Blue
- Red

Provide an option generator that can generate:

- iPhone 15 – Black
- iPhone 15 – Blue
- iPhone 15 – Red
- iPhone 16 – Black
- iPhone 16 – Blue
- iPhone 16 – Red
- iPhone 16 Pro – Black
- iPhone 16 Pro – Blue
- iPhone 16 Pro – Red

Each generated sellable sub-item must have:

- Its own stable identity.
- Unique SKU.
- Model reference where applicable.
- Colour.
- Optional colour hex.
- Stock limit.
- Stock quantity.
- Active/inactive status.
- Stock movement history.

Do not assume every possible combination actually exists. Let the admin review and activate only the combinations they physically sell.



B. Different physical versions for different devices:
- One parent product.
- Separate model-specific sub-items.
- Separate SKUs and stock quantities.

Do not force every compatible device to become a separate sellable variant.

---

## 5. Simplify the Product Editor

Reorganize the existing six-section editor without unnecessarily changing its overall visual design.

### Basics
- Product name.
- Category.
- Brand.
- Subtitle.
- Optional product type.
- Product-specific specifications.
- Compatible devices selector.
- Add New Model action.

### Photos
- Main photo.
- Gallery photos.
- Optional hover photo.
- Preserve staged saving behaviour.

### Price and options
- Product price.
- Sale price.
- Compare-at price.
- Option type and values.
- Model × colour combination generation.
- Individual SKU and stock settings.
- Archive and replace existing commerce identities.

### Stock
- Parent-level stock when there are no individually tracked variants.
- Variant-level stock when variants are individually tracked.
- Clear indication of which inventory mode is being used.
- Never allow the same physical units to be counted twice.

### Description
- Short description.
- Overview.
- Features.
- Specifications.
- FAQs.
- Reorderable sections.

### Review and publish
- Validate all required information.
- Show clear missing-field messages.
- Save as draft.
- Publish when valid.

The ordinary workflow must not require the admin to visit Catalogue Data to create a basic product.

---

## 6. Critical Data and Inventory Rules

These rules must not be compromised.

1. Every sellable sub-item has a stable identity.
2. Saved SKUs cannot be silently rewritten.
3. Archive and replace creates a new identity.
4. Historical orders retain original product, variant, SKU, quantity and price details.
5. Checkout deducts stock from the exact selected variant when variant inventory is enabled.
6. Parent inventory must not create extra stock beyond variant inventory.
7. Stock reservations must be released correctly after payment failure or checkout expiry.
8. Payment callbacks must not deduct inventory twice.
9. Inactive variants must never be purchasable.
10. Zero-stock variants must not be purchasable when stock limiting is enabled.
11. Removing device compatibility must not silently delete or rewrite existing variants.
12. New device models must not automatically become compatible with any product.
13. Price shown on the storefront must match the price charged at checkout.
14. Existing stock movement records must remain intact.

---

## 7. Existing Data and Migration Safety

Before implementation:

- Inspect the existing database schema.
- Inspect existing device brand/model tables.
- Inspect product-device relationships.
- Inspect product variants and inventory logic.
- Inspect the six-section product editor.
- Inspect storefront catalogue and checkout dependencies.
- Identify which existing functionality can be reused.

Do not create duplicate tables or duplicate device records if existing structures can support the new workflow.

Do not delete existing product types, attribute definitions, mappings, product details or device records.

If schema changes are required:

- Provide a migration plan.
- Preserve existing data.
- Make migrations backward-compatible wherever possible.
- Never migrate or modify real production business data without explicit approval.

Existing products must continue to work after the change.

---

## 8. Testing Requirements

Test the complete flow:

Admin creates product → Adds/selects device model → Adds colours → Generates variants → Enters stock → Saves → Publishes → Customer selects variant → Checkout → Payment → Stock deduction → Order history.

Test:

- New product without advanced Catalogue Data configuration.
- Existing product with structured attributes.
- Adding a device model from inside the product editor.
- Multiple device models and colours.
- Duplicate generation prevention.
- One product with shared stock across compatible devices.
- Separate stock per model-specific variant.
- Archiving and replacing a variant.
- Existing order history after variant replacement.
- Payment failure and reservation release.
- Concurrent purchases.
- Inactive and zero-stock variants.
- Product edits after publication.
- Existing catalogue data compatibility.

---

## 9. Implementation Instructions

Work in phases.

Phase 1: Audit
- Inspect existing architecture and database.
- Identify reusable tables and components.
- Report existing dependencies and risks.
- Propose the simplest implementation.

Phase 2: Backend and data model
- Implement necessary changes.
- Preserve existing references.
- Avoid duplicate data structures.

Phase 3: Product editor
- Simplify the workflow.
- Add the Device Models manager.
- Add the inline Add New Model flow.
- Add product-specific specifications and combinations.

Phase 4: Storefront and checkout
- Verify variant selection, compatibility, pricing and stock deduction.

Phase 5: Testing
- Run existing and new tests.
- Report every failure.
- Do not claim success without actual test results.

### Strict development constraints

- Preserve existing user changes and uncommitted work.
- Do not overwrite unrelated files.
- Do not make unnecessary storefront visual changes.
- Do not modify Education Store.
- Do not weaken RLS or API authorization.
- Do not expose internal costs, audit records, secrets or masked PII.
- Do not bypass existing pricing restrictions.
- Do not run migrations against production business tables without explicit approval.
- Do not silently change existing product behaviour.

## Expected Result

I should be able to:

1. Open Products.
2. Create a product.
3. Add specifications directly to that product.
4. Select existing compatible device models.
5. Add a new device model without leaving the editor.
6. Add colours.
7. Generate model × colour combinations.
8. Edit each sub-item's SKU and stock.
9. Save and publish.

All without needing to visit Catalogue Data for ordinary product creation.

Keep one shared device database, but make product-specific configurations independent.

**Prioritize simplicity, data safety and reuse of existing architecture over adding more configuration screens.**

Start with Phase 1. Do not begin destructive changes or production migrations.