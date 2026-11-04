# Creating Products and Showing Them on the Website

Updated: 2026-11-04

> **Start in Products, not Catalogue data.** An ordinary product does not need a product type, attribute definition or type-field mapping. Enter its own specifications directly. Central device brands/models are reused only when you deliberately select verified compatibility.
>
> Creating a device model does **not** select it, declare compatibility, generate a variant, add stock or save your product.

**Deployment prerequisite:** the implementation reports record migrations **0055–0057 as unapplied**. This guide describes the matching source implementation, not proof that a deployed store already supports it. Prerequisites through 0054 and a separately approved, coordinated migration/application rollout are needed; see [deployment instructions](PHASE2_CATALOG_DEPLOYMENT.md). Do not run migrations or seeds merely to follow this guide. No real database/payment acceptance is implied.

Examples are illustrative, not compatibility claims. Verify the actual item, device fit and stock yourself. Prices use existing permissions; **option-price editing remains locked**.

## Quick start: create one product

Open **Store Admin → Products → Add product** (`/store-admin/products/new`). A store admin or owner can create/edit products; a viewer cannot save. Only an owner creates/edits shared device records and Website Content.

The six sections form **one draft**. Next, section links and option previews do not save it. All product sections save together using the product save action. Device-reference creation is a separate save, as explained below.

### Step 1 — Basics

1. Enter the **Product name**, choose an active **Category**, and optionally select the accessory maker under **Brand** and enter a subtitle.
2. Enter product-specific specifications, for example `Material: TPU`, `Connector: USB-C` or `Wattage: 20 W`. These are this product's facts, not global attribute setup. Basics and Description edit the same specification content.
3. If relevant, turn on **Compatible devices active**, search, and explicitly add each exact device you have verified. An empty/off list does not mean universal compatibility.
4. Leave **Advanced** product type/detail fields alone for an ordinary product. They remain available for existing structured products; if you choose a type, its required fields and compatibility rules still apply.

**Product brand ≠ device brand.** A Gadzio accessory can be compatible with an Apple device; selecting Gadzio does not select Apple or any phone model.

#### If a device model is missing

- First search the central **Device models** page (`/store-admin/device-models`) to avoid duplicates.
- An owner can use **Add New Model** inside Basics. Select its device brand; use the nested brand creator only if that shared brand is genuinely missing. Complete and save the device record.
- The product name, photos, specifications and other staged changes stay in the draft. The new model becomes a choice, **not a selected compatible device**. Add it explicitly afterward only if verified.
- Finish **Create** or **Reset** for unfinished device-creator inputs before saving the product. Do not use Enter to try to submit the entire product from inside the creator.
- If references were edited in another tab, use **Reload catalogue choices**, not browser page reload. Reloading choices preserves the draft and does not select anything.
- If creation was confirmed but choice reload failed, use the locally available saved record/reload choices; do not create it again. If the save outcome is unknown, inspect the shared record before attempting another creation.

### Step 2 — Photos

Use **Add photo**, enter an existing public image URL or media path such as `/media/photo.jpg`, add descriptive alt text, and choose **Main photo**, optional **Hover photo**, or **Gallery photo**. Set the display order. Remove unfinished blank photo rows before saving.

Photos are recommended for customers, not a mandatory publication blocker. Image changes remain staged until the product save. This section takes image references; it is not itself an upload action.

### Step 3 — Price and options

Enter the **Product price ₹**, and optional sale/compare-at values where permitted. A sale price must be below the regular price and is used only while sale mode is on; compare-at cannot be below regular price.

Choose the physical selling arrangement:

- **One physical item, one shared stock pool:** do not create sellable options merely because several devices are compatible. Continue to Stock.
- **Different physical versions:** choose an option type such as Colour, Model, Wattage or Size and enter the actual values. For model × colour versions, first select verified devices in Basics and check **Create a sub-item for each selected compatible device**.

Click **Generate options** to preview candidates. **Nothing is selected automatically.** Tick only combinations you actually sell, then **Add selected combinations**. For example, if you stock A/Black, A/Blue and B/Black but not B/Blue, add only the first three. Do not assume the full cross-product exists.

Review Active status and SKU. New SKUs are generated; a saved non-null SKU is locked. Saved sellable identities cannot be repurposed. **Archive and replace** makes a new identity rather than changing what historical orders refer to.

**Option prices are read-only.** New options inherit the product price. Existing independently priced options retain their pricing rules; this workflow does not unlock a new option-price write path.

### Step 4 — Stock

For finite physical goods, turn **Limit my stock** on and enter exact whole counts. Turning it off permits unbounded sales of otherwise eligible items; do not use it accidentally.

**Shared product stock:** enter the total item count once. Selecting several compatible devices does not multiply the count.

**Individual variant stock:** review/activate actual sellable rows and explicitly check **Use these options at checkout with their own stock counts** when switching from parent stock. Enter a reason in the stock note and choose where units come from:

- **Transfer existing parent units:** use the per-option allocation fields. Do not also change parent/destination counts in the same transfer save. Allocations cannot exceed available parent units. Save count corrections separately.
- **Receive genuinely new variant units:** explicitly confirm they are new units, not units already counted in parent stock, and enter the real per-option counts.

For a new variant-only product with no parent units to allocate, keep parent opening stock at zero and deliberately use the new-receipt path for newly counted variant units. Do not invent parent units just to enable a transfer.

Existing parent stock is never copied into every variant. After switching, any retained parent balance is **not extra customer stock**. Existing holds/stock obligations may prevent switching; resolve them rather than bypassing the guard.

Each replacement starts **inactive, tracked and at zero stock**, with a new ID/SKU. Activate it deliberately and confirm new stock received before saving a nonzero replacement receipt. Original stock, holds, prices and order references stay with the original identity; replacement does not move them.

For later stock edits, choose **Count correction**, **New stock received** or **Damaged stock**, and add a non-sensitive reason/note. The server rechecks holds; displayed counts are not permission to overwrite current obligations.

### Step 5 — Description

Write the short description and arrange overview/features/specifications/FAQ content. Specifications edited here are the same product-local specifications shown in Basics, not another copy to maintain. Optional search-result settings are available.

A written compatibility claim does not add a structured device selection. Keep the copy accurate and consistent with verified compatibility. On older products, adopting edited canonical sections preserves the previous content in private content history; an intentionally empty section list is different from retaining legacy fallback.

### Step 6 — Review and publish

1. Check name, category, price, intended inventory mode, actual option rows and verified compatibility. Resolve readiness errors. Ordinary products may publish **without a product type**; chosen types still enforce their own requirements.
2. Leave **Publish in the storefront** off to save a draft, or turn it on to publish.
3. Use the product save action and wait for confirmation/navigation. All product sections save together; moving between steps did not save them.
4. Open the saved record and verify it. If another editor changed it, a revision conflict preserves your draft: compare with the latest record before manually reapplying changes. Do not overwrite blindly.

A network failure, malformed success or server failure may leave the save outcome **unknown**. The form blocks unsafe retries. Inspect the latest saved record before reloading or trying again; a missing confirmation does not prove nothing committed.

## Two stock examples

| | One item, many compatible devices | Different physical model/colour versions |
|---|---|---|
| Example | The exact same verified adapter supports Device A and B | A case has different fitted versions for A and B |
| Basics | Select A and B as verified compatible devices | Select A and B as verified compatible devices |
| Options | No sellable options needed | Preview A/Black, A/Blue, B/Black, B/Blue; add only actually sold combinations |
| Stock | Shared total = 20 | A/Black = 10, A/Blue = 4, B/Black = 6; omit B/Blue if not sold |
| Customer | Sees compatibility information; purchases from one shared pool | Must explicitly select an eligible option; each choice has its own identity and stock |
| After one purchase | Shared available count falls by one | Only the selected option's stock is claimed; no sibling/parent substitution |

These are setup examples, not claims about actual device compatibility. Checkout claims stock when reserving the order; verified payment consumes that reservation without a second deduction. Failure release follows the configured grace/expiry rules, not necessarily instant restoration.

## Where the product appears on the website

### Category and product page

- The published product belongs to its selected category. An **active, nondeleted category** and eligible active product are required for managed public visibility. Category grids use catalogue products, not copied product lists in marketing content. Drafts do not appear as published products.
- Use the canonical product URL **`/shop/product/<saved-product-id>`**. Keep the saved ID from the record/link; do not assume changing a slug changes this ID-based route.
- Customers see public product information: name/subtitle, main/hover/gallery artwork where supported, price, description/specification sections and supplied verified compatibility. Internal cost, audit entries and private history are not customer content.
- Shared compatibility is information, **not automatically a selector or separate stock**. Variant products require an explicit eligible model/specification choice before purchase. The selected option's label, ID and current price travel into the bag and checkout.
- Inactive/ineligible choices cannot be substituted with a sibling, replacement or parent. Zero available tracked stock cannot authorize a purchase, even if sale presentation still shows a purchase control. Quantity is checked at action time and again at checkout.
- Cards can show a starting/“From” price when eligible variant prices differ. It is a browsing summary, not authorization to buy an unspecified variant.

### Homepage promotions and collection rails

**Publishing does not automatically feature a product in every homepage section.**

- An owner opens **Website → Content → Homepage — Diwali Festive Campaign** or **Homepage — The Crowd Favorites** and selects published products for the ordered product slots. The current fixed layouts require four distinct campaign selections and six distinct favorites selections. Save the content section and ensure it is enabled if you want it displayed.
- Those slots reference catalogue products. Their names/images/prices come from the current catalogue; promotional badges remain section settings. Do not copy a second product price into marketing content. An unavailable saved selection gets an unavailable presentation rather than silently becoming a different product.
- **Collections** (`/store-admin/collections`) chooses and orders products for other named rails/carousels that consume those collections. It does not replace the two homepage slot editors, nor does it automatically attach a rail to every page.

### What happens after an edit

A successful product save requests catalogue cache invalidation so the **next relevant server read** can fetch fresh data without a rebuild. This is not a live push into already-open customer tabs: reload/navigate to inspect the saved page. If cache invalidation fails independently, a saved record can precede the visible refresh; ordinary catalogue caching is separate from purchase verification.

Add to Bag/Buy Now perform fresh managed-price and availability checks. A changed price is shown for review and requires another explicit action; it does not silently add at an unexpected price. Cumulative demand in the whole bag is checked. Checkout validates again transactionally; an earlier availability check is not a reservation.

If checkout says a selection is unavailable, the bag stays intact and offers **Review bag / Choose options**. No replacement is selected automatically. **Buy Again** for variant products goes to Choose options rather than recreating an unspecified parent line. Existing order product/SKU/price snapshots keep their original meaning after later edits or replacements.

### Quick troubleshooting

| Situation | Safe next step |
|---|---|
| Product saved but absent from category | Check publication, active category, intended category/page and a fresh page request. A saved draft is not a published product. |
| Product absent from homepage promotions | Select it in the specific Website Content slots; publishing alone does not place it there. |
| Type not configured | Use product-specific specifications and no type for an ordinary product. Only configure advanced mappings if actually needed. |
| Added model not selected | Expected: explicitly add the verified model to compatibility. Creation never assigns it. |
| Variant stock entered but no option checkout | Activate real sellable rows and explicitly enable individual option stock, with the correct stock source/reason. |
| Price changed / stock unavailable | Review the current price or quantity/choice and act again deliberately; do not repeatedly submit blindly. |
| Revision conflict / save outcome unknown | Preserve draft information and inspect the authoritative saved record before reloading/reapplying. |
| Schema unavailable | Ask the operator to review migration/deployment readiness. Do not bypass validation or run broad setup scripts. |

## Advanced reference guide

The following reference sections are for stores using shared structured product types/attributes. They are **optional advanced setup**, not prerequisites for ordinary product creation. Existing structured data and dependency protections remain in place.

## Contents

1. [Understand the two pages](#1-understand-the-two-pages)
2. [Understand the important terms](#2-understand-the-important-terms)
3. [Optional advanced Catalogue data setup](#3-optional-advanced-catalogue-data-setup)
4. [Use the starter setup safely](#4-use-the-starter-setup-safely)
5. [Create or edit a product](#5-create-or-edit-a-product)
6. [Understand compatible devices versus sellable options](#6-understand-compatible-devices-versus-sellable-options)
7. [Worked examples](#7-worked-examples)
8. [Change existing references safely](#8-change-existing-references-safely)
9. [Troubleshoot messages](#9-troubleshoot-messages)
10. [Roles and responsibilities](#10-roles-and-responsibilities)
11. [Quick checklists](#11-quick-checklists)
12. [Technical connection map](#12-technical-connection-map)

## 1. Understand the two pages

| Page | Purpose | Example |
|---|---|---|
| **Catalogue data** — `/store-admin/catalog` | Optional advanced reusable types/fields and other shared references. | Create a mapped Material field only if structured classification is needed. |
| **Products** — `/store-admin/products` | Create/manage actual items: local specifications, photos, options, stock and publication. | Create a case with local Material = TPU and explicitly verified compatibility, with no type required. |
| **Device models** — `/store-admin/device-models` | Shared device brands/models, independently of product-type setup. | Add a missing exact device record as an owner; select it separately on the product. |
| **Category tree** — `/store-admin/categories` | Organize the categories to which products and optional product types belong. | Create or maintain the Mobile Cases category. |

### The connection, in plain language

```text
Category → Product → Local specifications + photos/price/stock/content

Optional advanced classification:
Category
  └── Product type
        └── Assigned detail fields
              └── Values entered on each product

Device brand
  └── Exact device models
        └── Verified models selected on each product
              └── Optional explicit model mapping on sellable options

Product brand ──────────── selected separately on the product
Condition ─────────────── selected separately on the product

Product + photos + price/options + stock + description
  └── Review and publish
```

**Example:** Catalogue data contains `Mobile Case`, `Material`, `Apple` and `iPhone 17 Pro`. A product can then choose Mobile Case, answer Material = TPU, and select iPhone 17 Pro if verified. Another product can use the same choices with different values or device selections.

## 2. Understand the important terms

| Term | What it means | Where you configure it |
|---|---|---|
| **Category** | The group the product belongs to. It controls which product types are eligible. | Category tree; choose it on the product. |
| **Product type** | What kind of item it is within a category. | Catalogue data → Product types. |
| **Detail field / attribute definition** | A reusable question, such as Material or Wattage. | Catalogue data → Detail fields. |
| **Field assigned to a type / mapping** | A rule saying that a field applies to that type, with required/display settings. | Catalogue data → Detail fields → Type attribute mappings. |
| **Detail value** | An answer for one product, such as TPU or 20. | Product → Basics → Details for this product type. |
| **Field option** | An allowed answer for a list-of-options field, such as Silicone in a Material list. | Catalogue data → Detail fields → field options. |
| **Product brand** | Who makes or brands the accessory you sell. | Catalogue data → Other references → Product brands; select on product. |
| **Device brand** | Who makes the device the accessory fits. | Device models manager; also available in advanced Catalogue data. |
| **Device model** | The exact device that may be compatible. | Device models manager or owner-only Add New Model in Basics. |
| **Product compatibility selection** | Your verified claim that this product supports the selected device models. | Product → Basics → Compatible device models. |
| **Sellable option / sub-item** | A separately selectable version of a product, potentially with its own device mapping and stock. | Product → Price and options. |
| **Unit** | The measurement attached to a numeric detail field. | Catalogue data → Other references → Units. |
| **Condition** | A managed condition reference, such as New. | Catalogue data → Other references → Conditions; select on product. |

### Three things that must not be confused

1. **Product brand is not device brand.** A Gadzio accessory can fit an Apple device.
2. **A detail-field option is not a sellable product option.** An allowed Material answer does not automatically create a version with separate stock.
3. **A device record is not a compatibility assignment.** Adding iPhone 17 Pro to Catalogue data does not make every case fit it.

## 3. Optional advanced Catalogue data setup

Skip this setup for an ordinary product: choose its category and enter local specifications directly. Follow Steps B–D only if you deliberately want reusable structured types/attributes or are maintaining an existing classified product. Device records in Step E are shared independently of product types.

### Step A — Check the category

Open **Category tree** and confirm that the intended category exists and is active.

Choose the actual category your product will use. A Mobile Case type created under one category will not appear when the product selects another category—even if the category names look similar.

### Step B — Create a product type

Open **Catalogue data → Product types**.

1. Enter a name, for example `Mobile Case`.
2. Select its category.
3. Decide whether **Require verified compatible devices before publishing** is appropriate.
4. Keep the type active if it should be available for selection.
5. Review its suggested stable ID under Advanced settings and save.

A stable ID identifies the record internally. Its display name can be edited, but its identity cannot be casually replaced. A saved type cannot move categories; create a new type for a different category.

**When should compatibility be required?** Use it for a fitted accessory whose exact target model matters. For a cable organizer, exact device compatibility may not be necessary. Optional compatibility does not mean universal compatibility.

### Step C — Create detail-field definitions

Open **Catalogue data → Detail fields** and create the reusable fields you need.

| Field type | Use it for | Example value |
|---|---|---|
| Text | A written specification. | TPU |
| Number | A numeric measurement; select a suitable existing unit if needed. | 20 |
| Yes / no | A true/false property. | Yes |
| List of options | An answer chosen from a controlled list you configure. | USB-C |

For a list-of-options field, add the allowed answers to its definition. Do not add device compatibility as a generic Model detail: compatible devices have their own records and picker.

### Step D — Assign fields to the type

Still under **Detail fields**, use **Type attribute mappings**.

1. Choose the product type.
2. Choose the field definition.
3. Decide whether it is **Required to publish**.
4. Review the specifications/filter/search flags under Advanced settings.
5. Save the mapping as active.

**Defining a field alone is not enough.** It must be assigned to the type before it appears in that type's product details.

Example:

```text
Definition: Material, list of options: TPU / Silicone
Mapping:    Mobile Case → Material, optional, show in specifications
Product A:  Material = TPU
Product B:  Material = Silicone
```

Display flags configure where a field is eligible for use; they do not themselves create a new storefront search/filter interface.

### Step E — Add compatible-device records

Open **Catalogue data → Compatible devices**.

1. Under **Device brands**, add the manufacturer, for example Apple.
2. Under **Device models**, choose that brand and add the exact model name, for example iPhone 17 Pro.
3. Keep both the device brand and model active for product selection.
4. Repeat only for the models relevant to the products you sell.

Device names should be precise. A broad phrase such as `all phones` is not a substitute for verified device models. This system does not check physical dimensions, connector standards, or manufacturer specifications for you.

### Step F — Configure other references if needed

Under **Other references**:

- **Product brands:** the brands of the items you sell.
- **Conditions:** reusable condition labels.
- **Units:** measurement references for numeric fields; derived units reference a base unit and conversion factor.

Create units before the numeric fields that need them. Shared references can affect many products, so keep names and meanings consistent.

## 4. Use the starter setup safely

The starter setup is a shortcut for creating types, optional detail definitions and mappings—not for creating products or assigning compatibility.

1. Sign in as a store owner.
2. Open **Catalogue data → Preview starter setup**.
3. Select only the suggested groups you need.
4. Review the category for each selected group. Exact active category slugs are matched; for custom categories, choose an active category manually or skip the group.
5. Click **Review selected setup**.
6. Read the proposed rows:

| Result | Meaning | What to do |
|---|---|---|
| Create | A missing reference will be inserted on confirmation. | Check its category, field type and settings. |
| Already configured | A compatible reference exists and will be retained. | No duplicate is needed. |
| Conflict | An existing definition or identity does not safely match the suggestion. | Inspect the existing record or deselect the group; no overwrite occurs. |
| Missing prerequisite | Required setup is unavailable. | Fix the prerequisite or skip the group, then preview again. |

7. Click **Confirm reference setup** only after reviewing a valid preview.

### Current suggested groups

| Category slug | Suggested type | Suggested optional details |
|---|---|---|
| `cases-protection` | Protective Case | Material |
| `mobile-cases` | Mobile Case | Material |
| `airpods-case` | AirPods Case | Material |
| `power-adapter-cable` | Power Adapter | Wattage, Connector |
| `wired-earphones` | Wired Earphones | Connector, Driver |
| `cable-plug-case` | Cable Organizer | Accessory type, Material |
| `cable-plug-case` | Charger Case | Accessory type, Material |

Existing compatible field definitions/options are reused. An existing definition with a different data type or incompatible unit can cause a conflict. The starter does not change its meaning to force a match.

### What starter setup does not do

- It does not add device brands or device models.
- It does not select a type or compatible devices on an existing product.
- It does not fill product detail values, create sellable options or publish products.
- It does not change prices, stock, categories or database security.
- It does not reactivate or overwrite conflicting references.

Opening or cancelling a preview writes nothing. Confirmation is atomic and audited: a validation/audit failure rolls the setup back. If the catalogue changed since preview, generate a new preview. A fresh preview of an already completed setup can finish without inserting duplicates.

## 5. Create or edit a product

Open **Products → Add product**, or open an existing product. The form has six sections. Moving between sections stages your edits; it is not the same as saving them. Use the product save action to save the coordinated changes.

### 1 — Basics

1. Enter the product name.
2. Choose the category.
3. Select the product brand if applicable.
4. Enter this product's local specifications directly; they are shared with the Description section.
5. Optionally expand Advanced and choose an active product type belonging to that category. Complete its required mapped fields only when using that type.
6. Configure verified compatible devices if applicable; creating a model is separate from selecting it.

If you added references while the product form was already open:

- Open its Catalogue data link in a separate tab.
- Finish the reference setup there.
- Return to the product and click **Reload catalogue choices**.
- Choose the new records yourself. Reloading does not assign them or discard your staged product edits.

#### Compatible devices active

- **Off:** no device selection is being made through this control. Turning it off clears the selected device IDs in the draft after confirmation, and the change is persisted when you save.
- **On:** search by brand/model and add the exact verified devices.
- If the type requires compatibility, at least one eligible active model is needed before publication.
- If active purchasable options use a device mapping, removing that device is blocked until the affected options are archived/replaced appropriately.

**Off or empty never means universal compatibility.**

#### Switching product type or category

Changing type preserves saved details and staged edits. Only fields assigned to the currently selected category/type are submitted as its applicable detail values. Switching category clears the current type selection so you choose a type for the new category. Retained device selections still need your review.

**Clear** removes a saved detail from active use while retaining its saved value. **Restore saved value** explicitly brings an archived value back into use. Changing type does not automatically erase historical values.

#### More product settings

| Setting | How to use it |
|---|---|
| Page address / slug | Editable catalogue slug. The canonical storefront route shown here is ID-based: `/shop/product/<saved-product-id>`. Do not assume a slug edit changes that route. |
| Brand label | Editable legacy display text, separate from the product-brand relationship. Selecting a product brand copies its name here, but it remains editable. |
| Condition | Optional managed reference, configured in Catalogue data. |
| Material | Legacy free-form product text, separate from the structured Material detail. Values are not automatically synchronized. |
| Badge | Short optional display text; not a stock rule or automatic condition indicator. |
| Internal cost | Optional internal valuation input, not the selling price. |
| Display order | Sorting value where the catalogue uses this ordering. |
| Available for purchase | Purchase availability flag; stock limits and publication still apply. |

For ordinary specifications use the product-local editor. If a chosen type also requires a mapped Material/detail answer, fill that field explicitly: neither a local specification nor legacy Material automatically answers a required mapped field.

### 2 — Photos

Add product images, image descriptions, roles and display order. Choose a main photo and add gallery/hover photos as needed. Photo changes are staged with the product save.

### 3 — Price and options

Review product price settings and create the versions customers can choose. Existing pricing permissions/gates still apply; this guide does not enable a locked price write path.

Examples of sellable choices: Black/Blue, 20W/35W, or versions for different device models.

- Generating options previews candidates; nothing is selected automatically. Tick actual physical combinations and use Add selected combinations to stage sub-items. This does not verify compatibility.
- A model-based option can be explicitly mapped to one of the product's selected compatible models.
- Review the generated rows and enter the stock counts you actually hold.
- Saved sellable identities are protected. Use **Archive and replace** when their identity must change, rather than repurposing an old sellable identity with order history.
- A replacement starts inactive with zero tracked stock. Activate deliberately; nonzero new stock needs explicit receipt confirmation. Source units/holds are not copied.
- Option prices can remain read-only even while labels/new choices are configurable. Respect the locked controls.

### 4 — Stock

Choose whether to limit stock, and enter actual counts.

- With **Limit my stock** on, availability is constrained by stock and checkout holds.
- With it off, stock is not limited by the entered count; do not use this accidentally for finite physical stock.
- Product-level stock and option-level stock are distinct.
- Switching to option stock requires explicit counts; parent stock is not automatically copied or split among options.
- Counts must cover units already held in checkouts. Outstanding obligations can prevent a stock-mode switch.
- Enter the stock-change reason and an appropriate non-sensitive internal note if needed.

### 5 — Description

Fill the product description and optional search-result settings. A written claim such as “fits iPhone” does not create a structured compatibility selection. Keep product copy consistent with the exact models you verified and selected.

### 6 — Review and publish

Check the readiness list, resolve the listed issues, and save.

- New products start as drafts.
- Leave **Publish in the storefront** off while work is incomplete.
- Ordinary untyped products can publish after the normal product checks. If a type is selected, it must be eligible for the category, its required details must be valid, and any required compatible models must be selected.
- The server validates again when saving; a client-side readiness indicator is not permission to bypass validation.
- Being published does not guarantee an item is purchasable: availability and stock still matter.

## 6. Understand compatible devices versus sellable options

### Case A — The same physical item supports several devices

If the exact same item genuinely works with multiple models, select those verified models on the product. You do not need separate stock rows merely because the compatibility list contains several devices.

```text
One physical item
  ├── Verified compatible device A
  └── Verified compatible device B

One stock pool, unless you separately configure sellable versions.
```

### Case B — Different physical versions fit different devices

If the case for Device A is a different physical version from the case for Device B, create separate sellable options or separate products.

```text
Product: Gadzio Clear Case
  ├── Device A version → explicit device A mapping → stock 10
  └── Device B version → explicit device B mapping → stock 6
```

For a single product with options:

1. Select the verified device models in Basics.
2. Under Price and options, explicitly generate/configure the model sub-items.
3. Map each applicable sub-item to the correct selected device.
4. For model × colour combinations, review every generated combination.
5. Enter stock for each actual version and enable the intended stock mode.
6. Review and save.

**Selecting two devices in Basics does not by itself create two sellable versions, two checkout choices, or two stock pools.**

### Case C — Different information, not a different sellable item

Material = TPU, Wattage = 20, or Connector = USB-C may simply be specifications of one product. Put these in product-local specifications, or the appropriate mapped fields when deliberately using a structured type. Create sellable options only when the customer is actually choosing among versions you sell.

## 7. Worked examples

### Example A — One phone case, one verified device

Assume you have independently verified fit for the named device.

**Optional advanced catalogue setup for this example:**

This example deliberately uses a structured type. An ordinary version can instead leave the type unset and enter Material in local specifications; central device records and verified compatibility work in either case.

```text
Category:        Mobile Cases
Product type:    Mobile Case, requires compatibility
Detail field:    Material
Mapping:         Mobile Case → Material
Product brand:   Gadzio
Device brand:    Apple
Device model:    iPhone 17 Pro
```

**Product setup:**

```text
Name:                  Gadzio Clear Case
Category:              Mobile Cases
Product brand:         Gadzio
Type:                  Mobile Case
Structured Material:   TPU
Compatible devices:    Apple / iPhone 17 Pro
Stock:                 Actual count of this exact case
Publication:           Draft until photos/details/review are complete
```

Do not add another phone model just because its name is similar. Verify the actual fit first.

### Example B — Two model versions and two colours

Assume both versions and all listed colour combinations are actually stocked and verified.

```text
Product: Gadzio Silicone Case
Selected compatible devices: Device A, Device B
Colour choices: Black, Blue

Sellable combinations:
  Device A / Black → device A mapping → actual stock
  Device A / Blue  → device A mapping → actual stock
  Device B / Black → device B mapping → actual stock
  Device B / Blue  → device B mapping → actual stock
```

Do not create or activate nonexistent combinations. Each sellable combination needs its own deliberate stock count when option inventory is used.

### Example C — A power adapter

```text
Category:        Power Adapter / Cable category
Product type:    None required (optional Power Adapter type)
Specifications:  Wattage = 20 W; Connector = USB-C
Device models:   Leave unselected unless exact device support has been verified
Stock:           Actual adapter count
```

A connector label alone does not prove full compatibility, charging speed or protocol support for every device. Optional device selection means no explicit model assertion is required by that type—not that every device is supported.

## 8. Change existing references safely

Shared references are reused by products. A change can affect more than the row you are editing.

### Renaming versus changing meaning

Correcting a spelling mistake is different from repurposing a definition. Do not rename a connector value from USB-C to Lightning merely to reuse its identity: existing answers would no longer describe the same thing.

- Keep stable IDs and field keys meaningful.
- Do not repurpose a mapped field's data type.
- Create a new definition/type when the meaning genuinely changes.
- Review affected products before changing requirements or deactivating dependencies.

Reference changes that would invalidate published classified products are rejected and rolled back. Device-brand/model deactivation is also blocked when active purchasable options use them, including options belonging to draft products.

### The two different kinds of option removal

| What you are removing | Where | Why it can be blocked |
|---|---|---|
| An allowed detail answer, such as Silicone | Catalogue data → Detail fields → a list field's options | A retained product-detail value still uses that answer. |
| A sellable version, such as Device A / Black | Product → Price and options | Protected sellable identity, stock obligations and checkout/order history require archive/replace workflows rather than repurposing. |

Archiving a sellable version does not remove a saved Material/Connector answer. These are separate relationships.

### “One product still uses this option.” — exact meaning

This message is raised while removing a **list-of-options detail answer** from Catalogue data. It does not mean one sellable variant uses it.

Example:

```text
Field definition: Material
Allowed answers: TPU, Silicone
Product answer:  Material = Silicone

Attempt: remove Silicone from the allowed answers
Result: One product still uses this option.
```

The current removal guard checks **all retained saved answer rows** for that field and option value. It does not limit the count to published products or active answers. A draft, an answer saved for another type, a cleared/archived answer, or a retained answer on a deleted product can still block removal.

**Important: Clear does not unblock this by itself.** Clear retains the old value and marks it archived. The removal guard still sees that retained value. Switching type, unpublishing the product, or archiving a sellable option does not remove it either.

### Safe way to handle that message

1. Leave the option in place while investigating.
2. Check relevant products, including drafts. Open the applicable type and inspect **Saved details not in use** as well as current details.
3. If the product's real specification has changed, select the correct valid replacement answer and save. A non-null replacement updates/reactivates that product-field answer; Clear only archives it.
4. Retry removal only when no retained answers need the old option.
5. If the old answer is still correct or should be retained, keep the option. Do not change facts merely to get past a deletion guard.
6. If you cannot locate or open the blocking record, ask the owner/developer to inspect the retained dependencies read-only.

There is no user-facing purge operation documented here. Do not delete products or database history to force removal. Removing a whole field definition can also be blocked by active type mappings or any retained answer rows, including archived ones.

## 9. Troubleshoot messages

| Message or situation | Meaning | Next step |
|---|---|---|
| No category selected | Type eligibility cannot be determined yet. | Select the product category first. |
| No active types for this category | No eligible active advanced type belongs to this exact category. | Ordinary products can use no type and local specifications. If advanced classification is intended, check the exact category and existing/inactive types. |
| Saved type unavailable in this category | The retained type is no longer eligible for this category/state. | Review and choose an eligible type; keep the product draft while resolving it. |
| No mapped detail fields appear | No type selected, or no active field mappings/definitions for it. | Use local specifications for ordinary products; define/map fields only when advanced structured details are intended. |
| No active device models | No selectable combination of active model and active device brand is available. | Check both model status and parent-brand status. |
| No matching devices | Current search excludes the eligible models. | Clear/change search before adding duplicate records. |
| All matching devices already selected | Nothing else from the current matches remains to add. | Review the selected devices; no new record is needed. |
| A newly created choice is missing on an open product | The form still has its earlier reference snapshot. | Use Reload catalogue choices; do not discard the unsaved product. |
| Required detail still missing after filling legacy Material | Legacy text and structured detail answers are separate. | Fill the mapped Material detail for the chosen type. |
| Cannot remove compatibility used by an active purchasable variant | A sellable option still maps to that device. | Keep verified compatibility or archive/replace the affected option deliberately. |
| Reference change would invalidate a published product | A requirement/dependency change would make existing published metadata invalid. | Review affected products, complete their metadata or intentionally save them as drafts where appropriate. |
| Starter conflict | Existing reference identity/schema/settings do not safely match the suggestion. | Inspect the record or deselect that group. Setup will not overwrite it. |
| Catalogue changed since preview | A confirmed preview would be stale. | Generate and review a fresh preview. |
| Data could not be loaded | Service/schema access failed; it does not prove records are absent. | Retry; ask the owner to check the service/migrations if persistent. Do not rerun broad seeds blindly. |
| One product still uses this option | A retained field answer references the option you are trying to remove. | Follow Section 8; Clear alone does not remove the dependency. |

### If you see a hydration error instead of a data error

A server/client text mismatch is an application-loading problem, not a reason to change catalogue records. Preserve unsaved work where possible and report the exact diff to the developer. Do not repeatedly apply starter setup, delete records, or edit compatibility to try to fix it.

## 10. Roles and responsibilities

| Role | Product work | Shared Catalogue data |
|---|---|---|
| Store viewer | Inspect products; no create/save actions. | View references; no create/edit/setup actions. |
| Store admin | Create/edit products and their deliberate selections, details, photos, options and stock, subject to existing restrictions. | View shared references; ask an owner for configuration changes. |
| Store owner | Product-management capabilities. | Manage shared reference data and preview/confirm starter setup. |

Store-admin access is separate from the legacy website-editor identity/session. Seeing a page or hidden button is not authorization: APIs independently enforce roles and same-origin rules. Locked price controls remain locked; reference ownership does not remove a pricing gate.

## 11. Quick checklists

### Optional advanced owner setup

Ordinary products need an active category, not this full type/mapping setup. Use this checklist only for deliberately managed structured classification.

- [ ] Intended category exists and is active.
- [ ] If a type is used, it belongs to that exact category and is active.
- [ ] Compatibility requirement is appropriate for the type.
- [ ] Required units and field definitions exist.
- [ ] Detail fields are actively assigned to the type.
- [ ] List fields have the allowed answers you need.
- [ ] Device brands/models exist only where needed and are active.
- [ ] Product brands/conditions are configured if used.
- [ ] Starter preview was reviewed before confirmation; no historical backfill was run.

### Every product

- [ ] Name, category and product brand are correct.
- [ ] Product-local specifications are accurate.
- [ ] Product type is deliberately unset or eligible for the category; if used, required mapped details are completed.
- [ ] Device compatibility is verified, not inferred from the product name/connector.
- [ ] Multiple physical versions are represented by deliberate options or separate products.
- [ ] Each sellable model version maps to the right selected device.
- [ ] Real stock counts and the intended tracking mode are entered.
- [ ] Photos and descriptions describe the actual item/version.
- [ ] Availability and publication are intentional.
- [ ] Coordinated save succeeded; navigating between steps alone did not save anything.

### If you only want to make one product work first

1. Confirm one active category exists.
2. Open Products → Add product; enter name, category and product-local specifications. Leave the optional type unset.
3. Select verified devices if relevant; an owner can add a missing shared brand/model inline, then explicitly select it.
4. Add photos and a product price. Create reviewed physical options only if actually selling distinct versions.
5. Choose shared stock or explicitly activate individual option stock with the correct counts and stock source.
6. Add description, then save a draft or review and publish. Configure homepage placement separately if wanted.

You do not need a complete database of every brand or device before creating the first product.

## 12. Technical connection map

This section is for a developer or owner who wants to understand the underlying connections. It is not a database-editing procedure.

| Concept | Stored relationship |
|---|---|
| Product category | `products.category_id` → `categories` |
| Optional product type | Nullable `products.product_type_id` → `product_types`; when selected, type/category must match |
| Product-local content/specifications | `products.short_description` and `products.description_sections`; canonical content and private revision history preserve editing semantics |
| Field definition | `attributes`, with optional `units` reference |
| Allowed field answers | `attribute_options`, attached to a field |
| Fields applicable to a type | `product_type_attributes` |
| Per-product field answer | `product_attribute_values` |
| Product brand | `products.brand_id` → `brands` |
| Legacy Brand label / Material / Badge | Separate product text fields; not automatically synchronized with structured answers |
| Device catalogue | `device_brands` → `device_models` |
| Product compatibility | `product_device_models`, linking one product to selected devices |
| Sellable option | `product_variants`, with an optional explicit `device_model_id` |
| Saved/archived answers and compatibility | Archive state preserves history rather than deleting every retained value |

### Read and save flow

```text
Owner saves shared references
  → reference transaction validates dependencies and audit
  → Catalogue data refreshes

Staff opens product / explicitly reloads choices
  → active eligible references are loaded
  → staff selects type/devices and stages product answers
  → product draft save submits coordinated edits
  → server checks type/category, values, compatibility and inventory
  → transaction saves and audits, or rolls back on failure

Storefront reads
  → applicable active type/field mappings and eligible records
  → nonarchived applicable product answers
  → publication, availability and stock determine relevant behavior
```

The storefront's active-answer filtering is different from the conservative reference-removal guard, which counts retained answer dependencies even when they are not currently displayed.

### Relevant implementation files

- `src/app/(store-admin)/store-admin/(protected)/catalog/page.tsx` — Catalogue data composition and independent loading states.
- `src/components/store-admin/CatalogueDataWorkspace.tsx` — task-based sections; panels remain mounted while switching sections.
- `src/components/store-admin/MetadataReferenceManager.tsx` — types, type-field mappings and device record management.
- `src/components/store-admin/AttributeManager.tsx` — field definitions and allowed answers.
- `src/components/store-admin/CatalogStarterSetup.tsx` — starter selection, preview and explicit confirmation.
- `src/components/store-admin/ProductWorkflow.tsx` — six product sections and coordinated save.
- `src/components/store-admin/ProductMetadataFields.tsx` — type selection, verified device picker and draft-safe choice reload.
- `src/components/store-admin/ProductAttributes.tsx` — applicable answers, Clear and Restore.
- `src/lib/store-admin/product-metadata.ts` — reference loading, scoped metadata save, archive behavior, validation and auditing.
- `src/lib/store-admin/catalog-writes.ts` — field/allowed-answer dependency protections, including the option-in-use message.
- `src/lib/store-admin/product-draft.ts` — coordinated product-save transaction.
- `src/lib/store-admin/product-option-combinations.ts` — explicit sellable-combination generation.
- `src/lib/store-admin/variant-inventory.ts` — option stock and activation safeguards.
- `src/lib/catalog/catalog-starter-rules.ts` and `src/lib/store-admin/catalog-starter-setup.ts` — deterministic reference-only planning/application.
- `src/lib/catalog/product-metadata-rules.ts` — scoped values and publication requirements.
- `src/lib/catalog/storefront.ts` — customer-facing structured metadata reads.

---

**Remember:** start in Products, enter its own specifications, reuse shared devices only when relevant, verify support yourself, create separate sellable versions only when the physical item differs, and save before leaving. Catalogue types/mappings are optional advanced tools—not mandatory setup for every product.

