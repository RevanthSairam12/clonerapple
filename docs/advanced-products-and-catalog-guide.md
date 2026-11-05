# Advanced appendix — products, catalog and customer pages

> Moved here from the old long guide on 5 November 2026. The one-page guide
> [`PRODUCTS_AND_CATALOG_SIMPLE_GUIDE.md`](../PRODUCTS_AND_CATALOG_SIMPLE_GUIDE.md)
> is the place to start. This appendix keeps the detailed explanation of product
> types, shared catalog references, compatibility, stock modes and how a saved
> product reaches a customer page.
>
> It describes the code, not a check of your live database or deployment.


> **Start in Products. You do not need to configure every Catalog section to add a normal product.**
>
> This explains the current code, not a check of your live database or deployment.

## 1. Why are there two admin pages?

Think of a shop:

- **Products** is the actual merchandise you sell.
- **Catalogue data** is the shared list of choices and rules that products can reuse.
- **The customer product page** is how a saved, published product is presented to shoppers.

| Page | What you do there | Example |
|---|---|---|
| **Products** — `/store-admin/products` | Create and edit an actual item, its photos, price, description, options and stock. | “Gadzio Clear Case” |
| **Catalogue data** — `/store-admin/catalog` | Manage reusable references and optional advanced product rules. | A “Mobile Case” type with a reusable “Material” field. |
| **Category tree** — `/store-admin/categories` | Organize the groups products belong to. | “Mobile Cases” |
| **Device models** — `/store-admin/device-models` | Manage exact devices you can later select as compatible. | An exact phone model, under its device manufacturer. |

**Adding something to Catalogue data does not create a product or publish a customer page.** Store admins and owners can manage products; shared Catalog reference changes need an owner. A viewer cannot save edits.

## 2. How do they connect?

A simple product has:

```text
Category: Mobile Cases
    → Product: Gadzio Clear Case
        → Photos, price, description and specifications
        → Verified compatible devices, if relevant
        → Stock and optional sellable versions
        → Save and publish
            → Customer category listing and product detail page
```

Catalog's advanced setup is a separate, optional layer:

```text
Shared setup: Mobile Case type → Material field
Product:      choose that type → enter Material = TPU
```

**For an ordinary product, you can leave the type unset and enter `Material: TPU` directly in its specifications.** You do not need to build a reusable field first.

Shared choices are reused, but each product keeps its own facts. Creating a device model only makes it available to choose; it does not automatically mark any product as compatible.

## 3. The simplest way to create one product

Start with **one item with one stock pool**, rather than learning every advanced setting at once.

Open **Products → New product** (`/store-admin/products/new`). The six sections are parts of **one product form**, not six separate products:

| Section | What to do for a simple item |
|---|---|
| **1. Basics** | Enter the name and select an active category. Add specifications directly. Leave the advanced product type unset. Select exact verified compatible devices only if relevant. |
| **2. Photos** | Add image references and choose the main photo. This step uses image URLs/media paths; it is not itself an upload action. |
| **3. Price and options** | Enter the product’s regular price; sale and compare-at prices are optional. Skip options for a single physical version. Independent option prices are currently read-only. |
| **4. Stock** | For limited physical stock, turn **Limit my stock** on and enter the actual total count. |
| **5. Description** | Explain what the item is, its features and what the customer receives. Specifications here and in Basics are the same product-local content. |
| **6. Review and publish** | Resolve the readiness errors. Leave **Publish in the storefront** off for a draft, or turn it on to publish. Use the product save action and wait for confirmation. |

**Moving to the next section does not save.** Save before leaving the form. If a save reports a conflict or an unknown outcome, inspect the latest saved record before retrying; do not assume nothing was saved.

Example: one adapter with a verified specification of `20 W`, `USB-C`, and 15 units needs one product and one stock count. It does not need a product type, mapped fields or variants just to exist.

## 4. The confusing part: specification, compatibility or option?

Ask these three questions:

| Question | Use | Example |
|---|---|---|
| “What is this item like?” | **Specification** | Material = TPU; Connector = USB-C. |
| “Which exact devices does this item work with?” | **Compatible devices** | Models you have actually verified. |
| “Which physical version is the customer buying?” | **Sellable option / variant** | Black vs Blue, or a separately fitted case for Model A vs Model B. |

Two important examples:

- **The same physical adapter works with two verified devices:** one product, two compatibility selections, one shared stock pool. Compatibility does not create extra stock.
- **A case comes in two different fitted versions:** use deliberate sellable options or separate products. If using individual option stock, each physical version needs its own correct count and the option-stock mode must be explicitly enabled.

Selecting devices does **not** automatically generate variants. Generating options only previews candidates: add the combinations you actually sell. Product stock is not automatically copied into each option. Independent option-price editing remains locked; product price controls are separate.

Also: **product brand ≠ device brand.** Gadzio can be the accessory brand while Apple is the manufacturer of a compatible device.

## 5. Why does everything look different?

These screens are showing different views, not necessarily different products:

| What you see | What it represents |
|---|---|
| Products list | Staff management view of actual items, including drafts. |
| Catalogue data | Shared choices/rules, not a shopper-facing product list. |
| Customer category page | A browsing grid with a short summary of eligible published items in that category. |
| Customer product page | One item's fuller information and purchase choices. |
| Homepage promotion | A deliberately selected group of featured products, inside a marketing layout. |

Different customer layouts can show different amounts of information. A small card is not the full detail page. A variant product may show a starting/“From” price on its card, then require an exact choice before purchase.

**There is also a real inconsistency in the current app:** cases use a special product template, while other accessories use a different template. Some older products still get extra artwork or marketing copy from code when database content is blank. Category headings and homepage decorations can come from separate code/CMS settings. New products do not automatically get that older, hand-designed content. Saving a product updates its data; it does not redesign every page or replace every promotional image.

**You do not need to code a new page for each product.** The shared `/shop/product/<saved-product-id>` route already handles database products. Creating the item in the admin and publishing it is the intended path.

**Publishing and featuring are different actions:**

- Publish the product to make it eligible for the storefront; its category must also be active.
- The usual accessory category address is `/in/shop/iphone/accessories/<category-slug>`. Products are matched to their exact category; a parent category does not automatically collect every child category's products.
- Open its customer page using `/shop/product/<saved-product-id>`; use the actual saved ID/link, not a guessed slug.
- To feature it in **Diwali Festive Campaign** or **The Crowd Favorites**, an owner selects it in that section under **Website → Content**. Publishing alone does not put it there.
- **Collections** controls other named product groups where those collections are used. It is not a replacement for those homepage section selections.
- Published does not necessarily mean buyable: purchase availability, eligible options and stock still matter.

After saving, reload or navigate to the customer page to check it. An already-open tab does not update itself just because an admin saved.

## 6. What can I ignore at first?

For an ordinary product, skip:

- Product types and type-to-field mappings.
- Shared attribute definitions, field options and measurement-unit setup.
- Starter setup, unless an owner deliberately wants those advanced references.
- Sellable options, unless you really sell different physical versions.
- Homepage slots and collections, unless you want to feature the item there.

**Do not skip:** correct name/category, an intentional price and stock setup, accurate product information, and the final save. Add useful photos and descriptions for customers. Verify compatibility rather than guessing it.

If you deliberately choose an advanced product type, its required fields and compatibility rules still apply. Local specification text does not automatically fill a required mapped field.

## 7. What happens behind the scenes?

### A. Product creation and save flow

```text
Open New product
    → Load categories and reusable catalog choices
    → Fill the six sections (changes stay in the form)
    → Click Save as draft / Create and publish
    → Server checks permission and validates the submitted data
    → Save product + content + photos + selections + options + stock together
    → Request a storefront cache refresh
    → Open/reload the customer page to see the saved result
```

The important logic:

- **One coordinated save:** the form sends its staged product changes together. If validation or the save transaction fails, that transaction rolls back rather than deliberately saving half a product.
- **Draft is not “anything goes”:** even a draft needs a name, a valid category and a valid price. Publishing adds the relevant readiness checks.
- **Server checks are final:** the readiness list helps you, but the server checks again. It also checks staff permissions; a hidden or disabled button is not the security rule.
- **Shared records save separately:** adding a device model creates a reusable catalog record, not a saved product. Select the model on the product and then save the product itself.
- **Edits can conflict:** if another editor has changed the saved product, the form can reject your stale save. Keep your draft, compare the latest record and reapply deliberately.
- **A missing confirmation is not proof of failure:** if the connection fails after submission, the save may have committed. Inspect the saved record before retrying.

### B. How a saved product reaches a customer

```text
Saved product
    → Product published and category active?
        No  → Not eligible for the normal managed public listing
        Yes → Read current catalog data
                  → Category page shows a product card
                  → Product-ID route shows its detail template
                  → Homepage features it only when separately selected
```

The database holds the managed product facts. Storefront components turn those facts into cards and pages. Some layouts still add code/CMS-controlled presentation, as explained above.

**Visibility is not the same as purchase eligibility.** A product can be visible but unavailable to buy because purchasing is disabled, an eligible option is missing, or available stock is zero.

### C. How stock and options work

| Setup | What the customer is buying | Which stock counts? |
|---|---|---|
| One item, no sellable options | The product itself. | Its shared product stock. |
| Same item compatible with several devices | Still the same physical item. | The same shared stock; compatibility does not multiply it. |
| Options explicitly enabled for checkout with individual stock | One exact physical version. | The selected option's stock, not a sibling's or extra parent stock. |

For tracked stock, think of **available units = counted units minus units currently held for checkout**. A count of 10 does not mean 10 are available if some are already held.

- Turning **Limit my stock** off removes the quantity cap; it does not mean “out of stock.”
- Creating option rows alone does not enable individual option checkout. Enable the intended stock mode explicitly and establish real quantities.
- Switching from parent stock to option stock needs a deliberate allocation or a confirmed receipt of genuinely new units. Existing units are not copied into every option.
- If the chosen option is unavailable, the system must not silently sell another option instead.

### D. Price and purchase flow

```text
Customer views card/detail page
    → Chooses an exact option if required
    → Clicks Add to Bag / Buy Now
    → Fresh price and availability checks
    → Bag / checkout
    → Server validates the price, selection and stock again
    → Checkout reserves stock
    → Verified payment consumes the reservation without a second deduction
```

A product card is a browsing summary, not a guaranteed quote or stock reservation. If the current price changed, the purchase flow asks the customer to review it and act again. A variant “From” price does not authorize buying an unspecified version.

For the parent product, the regular price is the base; an eligible sale price applies while sale mode is live. Compare-at is a comparison value, not another charge. Existing option-pricing rules still apply, but independent option-price editing remains locked.

Stock is held at checkout, not simply because someone viewed the page or put an item in their bag. Failed/expired checkout holds are released according to the configured rules; restoration is not necessarily instant.

### Small developer reference

You do not need these files to use the admin, but they locate the main logic:

| Responsibility | Main source |
|---|---|
| Six-section form and save submission | `src/components/store-admin/ProductWorkflow.tsx` |
| Save endpoint | `src/app/api/store-admin/catalog/products/draft/route.ts` |
| Coordinated save and validation | `src/lib/store-admin/product-draft.ts` |
| Shared Catalog workspace | `src/components/store-admin/CatalogueDataWorkspace.tsx` |
| Managed public product/category reads | `src/lib/catalog/storefront.ts` |
| Catalog data combined with legacy presentation | `src/lib/storefront/catalog-merge.ts` |
| Customer product route and template selection | `src/app/shop/product/[productId]/page.tsx` |
| Homepage product references | `src/lib/website/homepage-products.ts` |

## 8. The main takeaway

**Your instinct is right: adding a normal product should not require setting up the entire catalog.**

Use this order:

**Products → item details → photos → price → stock → description → review → save/publish.**

Go to Catalogue data only when you need a missing reusable choice or deliberately want advanced structure. Do not create every type, field, brand and device before adding your first item.

For detailed edge cases, see [the full product/catalog guide](PRODUCT_CATALOG_FLOW.md). If the app reports a missing schema, ask the developer/operator to check [deployment prerequisites](PHASE2_CATALOG_DEPLOYMENT.md); do not run migrations or seeds just to follow this guide.
