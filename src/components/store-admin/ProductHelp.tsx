'use client';

import React, { Fragment, Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/** Native disclosure: usable even when the surrounding form is view-only. */
export function ProductHelp({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  const generated = useId();
  return <details className="sa-product-help"><summary aria-label={`Help for ${label}`} aria-controls={id ?? generated}><span aria-hidden="true">?</span></summary><div className="sa-product-help-copy" id={id ?? generated}>{children}</div></details>;
}

export function productHelpText(label: string): string {
  const text = label.toLowerCase();
  const rules: [RegExp, string][] = [
    [/^remove/, 'Removes this item from the current draft. The change is applied only when you save. Review before saving.'],
    [/^add photo/, 'Adds an empty photo row. Fill in its image address or remove the row before saving.'],
    [/^sell by/, 'Choose what changes between the options you sell: one item, colour, model, model and colour, or another option. This only suggests rows; saved options are never rewritten.'],
    [/sku pattern/, 'Used only to suggest new option SKUs. Type {product}, {model}, {colour} or {value}. A saved SKU never changes; archive and replace the option to get a new one.'],
    [/paste|spreadsheet/, 'One line per active option, in the same order as the table: price, sale price, stock. Separate the columns with Tab, a comma or a semicolon. A blank cell keeps the old value. Nothing is applied until every line reads correctly.'],
    [/move existing stock|stock per option/, 'Each option keeps its own count. Move shared units into the options only when you know where they belong; nothing is split automatically.'],
    [/internal cost/, 'Optional internal purchase cost in rupees, used for valuation rather than the customer selling price.'],
    [/hex|colour code/, 'Optional colour swatch code such as #000000 for black. This changes the swatch, not the option identity.'],
    [/search title/, 'Optional title for search results. Leave blank to use the normal product title.'],
    [/search description/, 'Optional short description for search results. This does not replace the product page content.'],
    [/search device/, 'Type part of a brand or device name to narrow the dropdown. Searching does not select or remove any devices.'],
    [/reason|stock note/, 'Explain the stock adjustment for other staff. Choose Count correction, New stock received or Damaged stock as appropriate. Do not include customer contact information.'],
    [/use these options at checkout/, 'Switches checkout to exact option stock when saved. Enter each option count explicitly. Choose explicit parent-unit transfers or confirmed new receipts. Parent units are never copied automatically; outstanding stock obligations may prevent the switch.'],
    [/available for purchase/, 'Allows purchase only when the product is published and other checks pass. Turning this off prevents purchases regardless of its stock count.'],
    [/customers can buy/, 'Marks this option as sellable rather than display-only. A saved option keeps its identity; archive and replace it to change one.'],
    [/active .+/, 'Keeps this option active. Turning it off archives it for future selection without deleting past order or stock history. Save to apply.'],
    [/clear|restore/, 'Clear archives the saved detail value. Restore brings back the previous value. Details belonging to other product types are preserved.'],
    [/new product/, 'Start with Basics and follow the six steps. You can save a draft before publishing.'],
    [/cancel/, 'Leaves the product screen. If there are unsaved changes, you will be asked before discarding them.'],
    [/save changes|save as draft|create and publish/, 'Saves all six sections together. If validation fails, your draft stays here so you can correct it.'],
    [/back to products/, 'Return to the product list. If there are unsaved changes you will be asked before leaving.'],
    [/product id/, 'A stable internal reference. It is not the customer-facing name or page address.'],
    [/currency/, 'The currency recorded for this product. Amount fields show rupees; saving does not convert currencies.'],
    [/changed by|source/, 'Read-only record of who or which operation made this price change. Past records are not edited here.'],
    [/product setup|product sections/, 'Work through the same six sections. Navigation does not save; the final Save action saves them together.'],
    [/^(value|label)$/, 'Enter the specification name and its value, for example Cable length and 1 metre. Use units only when appropriate for the product.'],

    [/archive and replace/, 'Keeps the original option and its order history. The replacement gets a new identity and starts with zero stock. Review and activate the replacement explicitly. It may keep the same display label; no stock holds or price overrides are copied.'],
    [/compatible|compatibility|device mapping/, 'Select only devices you have checked this product fits. Device choices are not guessed. Removing a device used by an active option requires archiving or replacing that option first.'],
    [/held|reserved/, 'Units recorded as set aside and not available to buy. Available stock excludes these units. Checkout may also claim stock directly, so this is not a count of every pending payment.'],
    [/available to buy/, 'The entered stock count minus recorded held units, never below zero. A row with no stock limit is shown as Not limited.'],
    [/warn|threshold/, 'Enter a whole number. This is the low-stock warning level, not extra stock. For example, enter 5 to flag a low count.'],
    [/limit.*stock|stock limit/, 'On: sales are limited by the stock count. Off: there is no quantity limit. Save the product to apply this choice.'],
    [/stock|in stock/, 'Enter the total count for this exact product or option, including any recorded held units. Counts must be whole numbers and cannot be below held units. Save to record the change.'],
    [/sale price/, 'Optional reduced price, used only while sale mode is on. It must be lower than the regular price on the same row.'],
    [/compare-at/, 'Optional reference price displayed for comparison. It cannot be lower than the regular product price.'],
    [/price|₹/, 'Amount in rupees, for example 499.00. A blank option price uses the product price. An option can have its own price and sale price.'],
    [/sku|identity/, 'An internal code identifying this exact option. A saved SKU never changes, because orders and stock history refer to it. Archive and replace the option to get a new one.'],
    [/option type/, 'What changes between options: for example Colour, Size or Wattage. Saved purchasable labels are locked; archive and replace to change them.'],
    [/option values|generate options/, 'Enter choices separated by commas or new lines, for example Black, Blue. Generate previews combinations with nothing selected. Only reviewed selections become sellable draft rows; nothing is saved yet.'],
    [/color|colour|model or specification/, 'A specific choice customers can select, such as Black or Phone A / Blue. Saved purchasable choices keep their identity and history.'],
    [/option/, 'A choice the customer buys, such as a colour or phone model. Each option has its own SKU, price and stock. Open it to review before saving.'],
    [/publish|active|status|visibility/, 'Published or active items can appear in the store when all other checks allow it. Turning this off keeps a draft. Publication alone does not override stock or compatibility checks.'],
    [/metadata|classification|product type/, 'Product type is optional for ordinary products. Choosing one enables its mapped details and compatibility requirements; existing structured details are preserved.'],
    [/category/, 'Groups products for browsing and determines available product types. Category counts are information, not filters.'],
    [/product name/, 'The customer-facing name. Use a clear name such as USB-C Charger 30W.'],
    [/slug|page address/, 'The last part of the product web address. Leave blank to use the name. Changing it changes the product URL.'],
    [/brand/, 'The product maker or brand label. This is separate from the brand of a compatible device.'],
    [/subtitle/, 'A short supporting line under the product name, such as Fast charging, compact design.'],
    [/condition/, 'Choose the product condition from the configured list, or leave it unset.'],
    [/material/, 'Optional material description, such as silicone or aluminium.'],
    [/badge/, 'Optional short label shown with the product, such as New.'],
    [/display order|ordering/, 'Lower numbers appear first. This changes display order, not stock or price.'],
    [/image url|photo url/, 'Paste a public HTTPS image address or a media path such as /media/photo.jpg. The image is saved with the product.'],
    [/alt text|photo description/, 'Describe what the image shows for someone using a screen reader, for example Black phone case, rear view.'],
    [/use photo as|photo role/, 'Main is the main product photo. Hover is an optional alternate. Gallery adds another image. Only one photo can be Main or Hover.'],
    [/remove/, 'Removes this item from the current draft. The change is applied only when you save. Review before saving.'],
    [/add photo/, 'Adds an empty photo row. Fill in its image address or remove the row before saving.'],
    [/short description|summary/, 'A short plain-language overview of the product. Detailed information belongs in the sections below.'],
    [/link/, 'Optional full web, email or telephone link. Supported prefixes are https:, http:, mailto: and tel:. Unsafe links are not saved.'],
    [/bold|italic|format/, 'Formatting applies to this text part only. Turn Bold or Italic on or off; use a separate text part for different formatting.'],
    [/move|reorder|drag/, 'Changes the order of description sections. Use Move up/down, drag the handle, or focus it and press Alt + Arrow Up/Down. Save to apply.'],
    [/hide/, 'Keeps the content saved but hides this section from customers. Clear the switch to show it again.'],
    [/section title/, 'A customer-facing heading, such as Features, Specifications or Common questions.'],
    [/specification|label|value/, 'Enter a clear detail name and its value, for example Cable length and 1 metre. Use units only when appropriate for the product.'],
    [/question|faq/, 'Add a common customer question and a helpful answer. You can format the answer or add lists.'],
    [/paragraph|text|list|description|section/, 'Write customer-facing information. Add text, bullet points, specifications or questions and answers. Changes stay in this draft until saved.'],
    [/save/, 'Saves all six sections together. If validation fails, your draft stays here so you can correct it.'],
    [/continue|back/, 'Moves between sections without saving. Your draft stays available while you work.'],
    [/updated|created|changed/, 'The recorded date and time for this product or price change.'],
    [/all products|review|filter/, 'Changes which products are shown. It does not edit, publish or save a product.'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? `Review ${label.toLowerCase()} here. Any edits are applied only when you save the product.`;
}

function contentText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(contentText).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (['input', 'select', 'textarea'].includes(String(node.type))) return '';
    return contentText(node.props.children);
  }
  return '';
}

/** Annotates intrinsic presentation only; never executes child components or changes handlers. */
export function ProductGuide({ children }: { children: ReactNode }) {
  const prefix = useId();
  let sequence = 0;
  function decorate(node: ReactNode): ReactNode {
    return Children.map(node, child => {
      if (!isValidElement<Record<string, unknown>>(child)) return child;
      const element = child as ReactElement<Record<string, unknown>>;
      const tag = element.type;
      if (tag === Fragment) return cloneElement(element, {}, decorate(element.props.children as ReactNode));
      if (typeof tag !== 'string') return element;
      if (tag === 'summary' || tag === 'option' || tag === 'optgroup' || tag === 'progress') return element;
      const p = element.props;
      const label = String(p['aria-label'] || contentText(p.children as ReactNode)).trim();
      const help = (name: string, id?: string) => <ProductHelp label={name} id={id}>{productHelpText(name)}</ProductHelp>;
      if (tag === 'label') {
        const name = label || 'Product setting';
        const id = `${prefix}-guide-${sequence++}`;
        function associate(nodes: ReactNode): ReactNode {
          return Children.map(nodes, item => {
            if (!isValidElement<Record<string, unknown>>(item)) return item;
            if (['input', 'textarea', 'select'].includes(String(item.type))) return cloneElement(item, { 'aria-describedby': [item.props['aria-describedby'], id].filter(Boolean).join(' ') });
            return item;
          });
        }
        return <div className="sa-product-guided-field">{cloneElement(element, {}, associate(p.children as ReactNode))}<ProductHelp label={name} id={id}>{typeof p['data-product-help'] === 'string' ? p['data-product-help'] : productHelpText(name)}</ProductHelp></div>;
      }
      if (['input', 'select', 'textarea'].includes(tag) && p['aria-label']) {
        const id = `${prefix}-guide-${sequence++}`;
        return <div className="sa-product-guided-field">{cloneElement(element, { 'aria-describedby': [p['aria-describedby'], id].filter(Boolean).join(' ') })}{help(label, id)}</div>;
      }
      if (['button', 'th', 'dt', 'h2', 'h3'].includes(tag) && label) {
        // A table header must remain a th, not become a div outside its row.
        if (tag === 'th' || tag === 'dt') return cloneElement(element, {}, <span>{p.children as ReactNode}</span>, help(label));
        return <div className="sa-product-guided-action">{element}{help(label)}</div>;
      }
      if (['input', 'img', 'br', 'hr', 'wbr'].includes(tag)) return element;
      // Disclosures are flow content: paragraphs must not wrap generated help.
      if (tag === 'p') return <div {...p} className={`${p.className ?? ''} sa-product-paragraph`}>{decorate(p.children as ReactNode)}</div>;
      return cloneElement(element, {}, decorate(p.children as ReactNode));
    });
  }
  return <>{decorate(children)}</>;
}
