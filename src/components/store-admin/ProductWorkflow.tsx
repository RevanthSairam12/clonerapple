'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState, type ReactNode } from 'react';
import { ProductField as Field } from './ProductField';
import { ProductGuide, ProductHelp } from './ProductHelp';
import type { MetadataReferences } from '@/lib/catalog/product-metadata-rules';
import { publicationProblems } from '@/lib/catalog/product-metadata-rules';
import { convertLegacyProductDescription, parseProductDescription, type ProductDescription } from '@/lib/catalog/product-description';
import type { CatalogProductDetail, CatalogStockRow } from '@/lib/store-admin/catalog';
import type { ProductMetadataState } from '@/lib/store-admin/product-metadata';
import { parseRupeesToPaise } from '@/lib/store-admin/money';
import { normalizeOptionIdentity, optionSemanticKey, productOptionCombinations, type OptionCombination } from '@/lib/store-admin/product-option-combinations';
import {
  SELL_BY_OPTIONS, generateOptionRows, isSellBy, largePriceChange,
  missingOptionRows, optionRowWarnings, sellByUsesColour, sellByUsesModel, suggestedSku,
  type GeneratedOptionRow, type SellBy,
} from '@/lib/store-admin/options-table-rules';
import { ProductSpecificationsEditor } from './ProductSpecificationsEditor';
import { emptyMetadataDraft, ProductMetadataFields, scopedMetadataInput } from './ProductMetadataFields';
import { ProductDescriptionEditor } from './ProductDescriptionEditor';

type Choice = { id: string; name: string };
export interface ProductWorkflowProps {
  categories: Choice[];
  brands: Choice[];
  conditions: Choice[];
  metadataReferences: MetadataReferences;
  /** Shared colours for a new product; an edited product carries its own list. */
  colours?: Array<{ id: string; name: string; hex: string; isActive?: boolean }>;
  product?: CatalogProductDetail;
  metadataState?: ProductMetadataState | null;
  canEdit?: boolean;
  canManageDevices?: boolean;
  canCreateShared?: boolean;
}
type Photo = { id?: string; key: string; url: string; alt: string; role: string; sortOrder: number; colourId: string | null };
type OptionDraft = {
  id?: string; clientKey: string; sku: string; optionName: string; optionValue: string;
  optionHex: string; deviceModelId: string; combinationKey: string; isActive: boolean;
  optionIdentity?: string | null; replacesVariantId?: string; retiredAt?: string | null; savedSku?: string | null;
  sourceWasActive?: boolean; allocation?: string; receiptConfirmed?: boolean;
  isPurchasable: boolean; sortOrder: number; price: string; salePrice: string;
  count: string; threshold: string; trackInventory: boolean; originalStock: CatalogStockRow | null;
  /** Shared colour for this row; empty for a model, size or free-text option. */
  colourId: string;
};
const steps = ['Basics', 'Photos', 'Price and options', 'Stock', 'Description', 'Review and publish'];
const explanations = [
  'Give your product a name and choose where customers will find it. Verify its type, attributes and compatible devices.',
  'Add image URLs and helpful descriptions of each photo. Choose one main photo and an optional hover photo. A colour photo shows only when that colour is picked; colours without a photo use the main gallery.',
  'Choose how you sell this product, then set one price and stock count for each real model or colour. A blank option price uses the product price.',
  'Decide whether customers can buy without a stock limit, or enter the exact quantities you have.',
  'Write a short summary and arrange the sections customers will read on the product page.',
  'Check your product, then save a draft or publish it. All sections save together.',
];
const moneyInput = (value: number | null | undefined) => value == null ? '' : (value / 100).toFixed(2);
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
function paise(value: string, label: string, optional = false, allowZero = false): number | null {
  const parsed = parseRupeesToPaise(value);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.message}`);
  if (parsed.paise === null) {
    if (optional) return null;
    throw new Error(`${label} is required.`);
  }
  if (!allowZero && parsed.paise === 0) throw new Error(`${label} must be above zero.`);
  return parsed.paise;
}
function count(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim()) || Number(value) > 1_000_000) throw new Error(`${label}: enter an explicit whole count between 0 and 1,000,000.`);
  return Number(value);
}
function stockPatch(original: CatalogStockRow | null, quantity: string, threshold: string, tracking: boolean, reason: string, note: string) {
  const onHand = count(quantity, 'In stock');
  const lowStockThreshold = count(threshold, 'Warn me when below');
  if (original && original.onHand === onHand && original.lowStockThreshold === lowStockThreshold && original.trackInventory === tracking) return undefined;
  return { ...(original?.onHand === onHand ? {} : { onHand }), ...(original?.lowStockThreshold === lowStockThreshold ? {} : { lowStockThreshold }), ...(original?.trackInventory === tracking ? {} : { trackInventory: tracking }), confirmTracking: tracking, reason, note };
}

/** One in-memory draft; no child editor commits independently. */
export function ProductWorkflow({ categories, brands, conditions, metadataReferences: initialMetadataReferences, colours: colourChoices, product, metadataState, canEdit = true, canManageDevices = false, canCreateShared = false }: ProductWorkflowProps) {
  const router = useRouter();
  const [metadataReferences, setMetadataReferences] = useState(initialMetadataReferences);
  useEffect(() => { setMetadataReferences(initialMetadataReferences); }, [initialMetadataReferences]);
  const editing = !!product;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => ({
    name: product?.name ?? '', slug: product?.slug ?? '', categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    subtitle: product?.subtitle ?? '', brandId: product?.brandId ?? '', brand: product?.brand ?? '', conditionId: product?.conditionId ?? '',
    material: product?.material ?? '', badge: product?.badge ?? '', price: moneyInput(product?.pricePaise),
    salePrice: moneyInput(product?.salePricePaise), compareAt: moneyInput(product?.compareAtPaise),
    seoTitle: product?.seoTitle ?? '', seoDescription: product?.seoDescription ?? '', isActive: product?.isActive ?? false,
    cost: moneyInput(product?.costPaise), sortOrder: String(product?.sortOrder ?? 0), inStock: product?.inStock ?? true,
  }));
  const [metadata, setMetadata] = useState(() => emptyMetadataDraft(metadataState));
  const [photos, setPhotos] = useState<Photo[]>(() => (product?.images ?? []).filter(image => !image.deletedAt).map(image => ({ id: image.id, key: image.id, url: image.url, alt: image.alt, role: image.role, sortOrder: image.sortOrder, colourId: image.colourId })));
  const sharedColours = product?.colours ?? colourChoices ?? [];
  const [options, setOptions] = useState<OptionDraft[]>(() => (product?.variants ?? []).map(option => ({
    id: option.id, clientKey: option.id, sku: option.sku ?? '', optionName: option.optionName, optionValue: option.optionValue,
    optionHex: option.optionHex ?? '', deviceModelId: option.deviceModelId ?? '', combinationKey: option.combinationKey ?? '',
    optionIdentity: option.optionIdentity, retiredAt: option.retiredAt, savedSku: option.sku,
    isActive: option.isActive, isPurchasable: option.isPurchasable, sortOrder: option.sortOrder,
    price: moneyInput(option.pricePaiseOverride), salePrice: moneyInput(option.salePricePaise), count: String(option.stock?.onHand ?? 0),
    threshold: String(option.stock?.lowStockThreshold ?? 0), trackInventory: option.stock?.trackInventory ?? false, originalStock: option.stock,
    colourId: sharedColours.find(colour => option.optionHex && colour.hex.toLowerCase() === option.optionHex.toLowerCase())?.id ?? '',
  })));
  const [sellBy, setSellBy] = useState<SellBy>(product?.sellBy ?? 'single');
  const [skuPattern, setSkuPattern] = useState(product?.skuPattern ?? '');
  const [otherName, setOtherName] = useState('Wattage');
  const [otherValues, setOtherValues] = useState('');
  const [generatedRows, setGeneratedRows] = useState<GeneratedOptionRow[]>([]);
  const [generatedNotice, setGeneratedNotice] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkSale, setBulkSale] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [colourPrices, setColourPrices] = useState<Record<string, string>>({});
  const [description, setDescription] = useState<ProductDescription>(() => convertLegacyProductDescription({
    shortDescription: product?.shortDescription, sections: product?.descriptionSections,
    description: product?.description, highlights: product?.highlights, specs: product?.specs, inTheBox: product?.inTheBox,
  }));
  const [parentCount, setParentCount] = useState(String(product?.stock?.onHand ?? 0));
  const [parentThreshold, setParentThreshold] = useState(String(product?.stock?.lowStockThreshold ?? 0));
  const [parentTracking, setParentTracking] = useState(product?.stock?.trackInventory ?? false);
  const [activateOptions, setActivateOptions] = useState(false);
  const [stockReason, setStockReason] = useState('adjustment');
  const [stockNote, setStockNote] = useState('');
  const [optionType, setOptionType] = useState('Model');
  const [optionValues, setOptionValues] = useState('');
  const [combineModels, setCombineModels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceDirty, setDeviceDirty] = useState(false);
  const [saveState, setSaveState] = useState<'ready' | 'conflict' | 'unknown' | 'saved'>('ready');
  const [candidates, setCandidates] = useState<Array<OptionCombination & { selected: boolean }>>([]);
  const [candidateNotice, setCandidateNotice] = useState('');
  const [stockSource, setStockSource] = useState<'transfer' | 'receipt'>('transfer');
  const [receiptConfirmed, setReceiptConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [initialDescription] = useState(() => JSON.stringify(description));
  const [initialSections] = useState(() => JSON.stringify(description.sections));
  const snapshot = JSON.stringify({ form, metadata, photos, options, description, parentCount, parentThreshold, parentTracking, activateOptions, stockReason, stockNote, stockSource, receiptConfirmed, candidates, sellBy, skuPattern });
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = baseline !== snapshot || deviceDirty;
  const disabled = busy || saveState !== 'ready' || !canEdit;
  const retiringIds = new Set(options.flatMap(option => option.replacesVariantId ? [option.replacesVariantId] : []));
  const liveOptions = options.filter(option => !option.retiredAt);
  const commerceOptions = liveOptions.filter(option => option.isActive && option.isPurchasable && !retiringIds.has(option.id ?? ''));
  const useOptionStock = product?.inventoryMode === 'variant' || activateOptions;
  const transferring = activateOptions && product?.inventoryMode !== 'variant' && stockSource === 'transfer';
  const masterTracking = useOptionStock ? commerceOptions.length > 0 && commerceOptions.every(option => option.trackInventory) : parentTracking;
  const selectedType = metadataReferences.types.find(type => type.id === metadata.productTypeId && type.categoryId === form.categoryId && type.isActive);
  const metadataValues = { ...Object.fromEntries((metadataState?.attributes ?? []).filter(attribute => !attribute.archived && attribute.applicable).map(attribute => [attribute.attributeId, attribute.value])), ...scopedMetadataInput(metadata, metadataReferences, form.categoryId).attributeValues };
  const metadataProblems = publicationProblems(selectedType, form.categoryId, metadataValues, metadata.deviceModelIds.filter(id => metadataReferences.models.some(model => model.id === id && model.isActive && metadataReferences.brands.some(brand => brand.id === model.brandId && brand.isActive))), metadata.productTypeId);
  const checklist = [
    { label: 'Product name', ready: !!form.name.trim() },
    { label: 'Category', ready: !!form.categoryId },
    { label: 'Main photo (recommended)', ready: photos.some(photo => photo.role === 'primary' && !!photo.url.trim()), recommended: true },
    { label: 'Product price', ready: Number(form.price) > 0 },
    { label: 'Stock choice', ready: !masterTracking || (useOptionStock ? commerceOptions.every(option => /^\d+$/.test(option.count)) : /^\d+$/.test(parentCount)) },
    { label: 'Classification and compatibility', ready: metadataProblems.length === 0 },
    { label: 'Options ready for checkout', ready: useOptionStock ? commerceOptions.length > 0 : commerceOptions.length === 0 },
  ];
  useEffect(() => {
    if ((!dirty && !deviceBusy) || busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const warnLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || anchor.target === '_blank') return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (deviceBusy || !window.confirm('Discard your unsaved product changes?')) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', warnLink, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', warnLink, true); };
  }, [dirty, busy, deviceBusy]);
  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) { setForm(current => ({ ...current, [key]: value })); setSaved(''); }
  function updateOption(key: string, patch: Partial<OptionDraft>) { setOptions(current => current.map(option => option.clientKey === key && !option.retiredAt && !retiringIds.has(option.id ?? '') ? { ...option, ...patch, ...(!option.id && patch.optionValue !== undefined && !option.deviceModelId ? {optionIdentity:normalizeOptionIdentity(patch.optionValue)} : {}) } : option)); }
  function cancelReplacement(option: OptionDraft) {
    setOptions(current => current.filter(row => row.clientKey !== option.clientKey).map(row => row.id === option.replacesVariantId ? { ...row, isActive: option.sourceWasActive ?? false } : row));
  }
  function setMasterTracking(value: boolean) {
    if (!useOptionStock) setParentTracking(value);
    if (useOptionStock) setOptions(current => current.map(option => option.isActive && option.isPurchasable && !option.retiredAt && !retiringIds.has(option.id ?? '') ? { ...option, trackInventory: option.replacesVariantId ? true : value } : option));
  }
  function generateOptions() {
    setError('');
    try {
      const combinations = productOptionCombinations(optionType, optionValues, combineModels, metadata.deviceModelIds, metadataReferences);
      const retained = liveOptions.filter(option => !retiringIds.has(option.id ?? ''));
      const seen = new Set(retained.map(optionSemanticKey).filter(Boolean));
      const added = combinations.filter(item => !seen.has(optionSemanticKey(item)));
      if (!added.length) throw new Error('These combinations already exist, including inactive rows. Review those rows instead.');
      const labels = new Set(retained.map(option => JSON.stringify([option.optionName, option.optionValue])));
      const preview = added.map(item => {
        let optionValue = item.optionValue;
        if (labels.has(JSON.stringify([item.optionName, optionValue]))) {
          const model = metadataReferences.models.find(model => model.id === item.deviceModelId);
          if (model) optionValue = `${model.brandName} ${optionValue}`;
        }
        if (optionValue.length > 60 || labels.has(JSON.stringify([item.optionName, optionValue]))) throw new Error('A new display label conflicts with an existing option. Review the existing row or use a distinct value within 60 characters.');
        labels.add(JSON.stringify([item.optionName, optionValue]));
        return { ...item, optionValue, selected: false };
      });
      setCandidates(preview);
      setCandidateNotice(retained.some(option => option.isPurchasable && !option.optionIdentity) ? 'Legacy options have unknown semantic values. Compare their saved labels before explicitly selecting new physical combinations; their identity is never guessed.' : 'Nothing is selected. Select only physical combinations you actually sell.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the sub-item values.'); }
  }
  function addReviewedOptions() {
    setError('');
    try {
      const selected = candidates.filter(candidate => candidate.selected);
      if (!selected.length) throw new Error('Select at least one reviewed combination.');
      const currentChoices = productOptionCombinations(optionType, optionValues, combineModels, metadata.deviceModelIds, metadataReferences);
      const validKeys = new Set(currentChoices.map(optionSemanticKey));
      const retained = liveOptions.filter(option => !retiringIds.has(option.id ?? ''));
      const seen = new Set(retained.map(optionSemanticKey).filter(Boolean));
      if (selected.some(candidate => !validKeys.has(optionSemanticKey(candidate)) || seen.has(optionSemanticKey(candidate)))) throw new Error('Choices changed. Generate a fresh preview before adding combinations.');
      if (liveOptions.length + selected.length > 100) throw new Error('Use at most 100 non-retired options, including inactive rows.');
      const added = selected.map((item, index): OptionDraft => {
        const key = `option-${crypto.randomUUID()}`;
        return { ...item, clientKey: key, sku: `SKU-${key.slice(-12).toUpperCase()}`, optionHex: '', colourId: '', combinationKey: key,
          isActive: true, isPurchasable: true, sortOrder: options.length + index, price: '', salePrice: '', count: '0', threshold: '0', trackInventory: true, originalStock: null };
      });
      setOptions(current => [...current, ...added]); setCandidates([]); setOptionValues('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review the combinations.'); }
  }
  function colourOf(option: OptionDraft) {
    return sharedColours.find(colour => colour.id === option.colourId) ?? null;
  }
  function modelOf(option: OptionDraft) {
    return option.deviceModelId ? metadataReferences.models.find(model => model.id === option.deviceModelId) ?? null : null;
  }
  function priceOf(value: string): number | null {
    const parsed = parseRupeesToPaise(value);
    return parsed.ok && parsed.paise !== null ? parsed.paise : null;
  }
  function pricePayload(option: OptionDraft): { pricePaise?: number | null; salePricePaise?: number | null } {
    const saved = option.id ? product?.variants.find(variant => variant.id === option.id) : undefined;
    const price = priceOf(option.price);
    const sale = priceOf(option.salePrice);
    // Blank means "use the product price". A clear is sent only when a saved
    // override existed, so an untouched row never writes price history.
    return {
      ...(price === null ? (saved?.pricePaiseOverride != null ? { pricePaise: null } : {}) : { pricePaise: price }),
      ...(sale === null ? (saved?.salePricePaise != null ? { salePricePaise: null } : {}) : { salePricePaise: sale }),
    };
  }
  function planOptionRows() {
    setError(''); setGeneratedRows([]);
    try {
      const rows = generateOptionRows({
        sellBy,
        models: metadataReferences.models.filter(model => metadata.deviceModelIds.includes(model.id)),
        colours: sharedColours.filter(colour => colour.isActive !== false),
        otherName,
        otherValues: otherValues.split(/[\n,]/),
      });
      const existing = options.filter(option => !retiringIds.has(option.id ?? '')).map(option => ({
        deviceModelId: option.deviceModelId || null,
        colourId: option.colourId || null,
        optionName: option.optionName,
        optionValue: option.optionValue,
        optionIdentity: option.optionIdentity,
      }));
      const missing = missingOptionRows(existing, rows);
      setGeneratedRows(missing);
      setGeneratedNotice(sellBy === 'single'
        ? 'A product sold as one item needs no option rows. Everything uses the product price and stock.'
        : missing.length
        ? `${missing.length} new row${missing.length === 1 ? '' : 's'} will be added as inactive. Check them, then add.`
        : 'Every row already exists, including inactive ones. Nothing new to add.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Choose how to sell before generating rows.'); }
  }
  function addGeneratedRows() {
    setError('');
    try {
      if (!generatedRows.length) throw new Error('Plan the missing rows first.');
      if (liveOptions.length + generatedRows.length > 100) throw new Error('Use at most 100 non-retired options, including inactive rows.');
      const added = generatedRows.map((row, index): OptionDraft => {
        const key = `option-${crypto.randomUUID()}`;
        const model = row.deviceModelId ? metadataReferences.models.find(item => item.id === row.deviceModelId) : undefined;
        const colour = row.colourId ? sharedColours.find(item => item.id === row.colourId) : undefined;
        const suggestion = suggestedSku(skuPattern, { product: form.name, model: model?.name, colour: colour?.name, value: row.optionValue });
        return {
          clientKey: key, sku: suggestion || `SKU-${key.slice(-12).toUpperCase()}`,
          optionName: row.optionName, optionValue: row.optionValue, optionHex: colour?.hex ?? '',
          deviceModelId: row.deviceModelId ?? '', combinationKey: key, optionIdentity: row.optionIdentity,
          isActive: false, isPurchasable: true, sortOrder: options.length + index, price: '', salePrice: '',
          count: '0', threshold: '0', trackInventory: true, originalStock: null, colourId: row.colourId ?? '',
        };
      });
      setOptions(current => [...current, ...added]);
      setGeneratedRows([]); setGeneratedNotice(''); setOtherValues('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review the rows before adding them.'); }
  }
  function applyBulk() {
    setError('');
    try {
      const patch: Partial<OptionDraft> = {};
      if (bulkPrice.trim()) { paise(bulkPrice, 'Price for all rows'); patch.price = bulkPrice.trim(); }
      if (bulkSale.trim()) { const sale = paise(bulkSale, 'Sale price for all rows'); const regular = paise(bulkPrice.trim() || form.price, 'Price for all rows'); if (sale !== null && regular !== null && sale >= regular) throw new Error('Sale price must be below the price it applies to.'); patch.salePrice = bulkSale.trim(); }
      if (bulkStock.trim()) { patch.count = String(count(bulkStock, 'Stock for all rows')); }
      if (!Object.keys(patch).length) throw new Error('Type a price, sale price or stock count to fill into every row.');
      const targets = new Set(commerceOptions.map(option => option.clientKey));
      if (!targets.size) throw new Error('No active sellable rows to fill.');
      setOptions(current => current.map(option => targets.has(option.clientKey) ? { ...option, ...patch } : option));
      setBulkPrice(''); setBulkSale(''); setBulkStock('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the fill values.'); }
  }
  function applyColourPrices() {
    setError('');
    try {
      const prices = Object.entries(colourPrices).filter(([, value]) => value.trim());
      if (!prices.length) throw new Error('Type a price beside at least one colour.');
      const parsed = new Map(prices.map(([colourId, value]) => [colourId, paise(value, 'Colour price') ?? null]));
      const targets = new Set(commerceOptions.filter(option => option.colourId && parsed.has(option.colourId)).map(option => option.clientKey));
      if (!targets.size) throw new Error('No active sellable rows use those colours.');
      setOptions(current => current.map(option => {
        const price = option.colourId ? parsed.get(option.colourId) : undefined;
        return targets.has(option.clientKey) && price != null ? { ...option, price: (price / 100).toFixed(2) } : option;
      }));
      setColourPrices({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the colour prices.'); }
  }
  function largePriceChanges(): string[] {
    let base = 0;
    try { base = paise(form.price, 'Product price') ?? 0; } catch { return []; }
    const cost = form.cost.trim() ? priceOf(form.cost) : null;
    const reasons = new Set<string>();
    for (const option of commerceOptions) {
      const saved = option.id ? product?.variants.find(variant => variant.id === option.id) : undefined;
      const oldPrice = saved ? saved.pricePaiseOverride ?? base : base;
      const newPrice = priceOf(option.price) ?? base;
      const reason = largePriceChange({ oldPricePaise: oldPrice, newPricePaise: newPrice, costPaise: cost });
      if (reason) reasons.add(reason);
    }
    return [...reasons];
  }
  function rowWarningList(option: OptionDraft, seenSkus: Set<string>): string[] {
    if (option.retiredAt || retiringIds.has(option.id ?? '')) return [];
    let base = 0;
    try { base = paise(form.price, 'Product price') ?? 0; } catch { return []; }
    return optionRowWarnings({
      sku: option.sku,
      pricePaise: priceOf(option.price),
      basePricePaise: base,
      stockOnHand: Number(option.count || 0),
      trackInventory: option.trackInventory,
      isPurchasable: option.isPurchasable,
    }, seenSkus);
  }
  function replaceOption(option: OptionDraft) {
    if (!option.id || option.retiredAt || retiringIds.has(option.id)) return;
    if (!window.confirm('Archive this saved sub-item and create an editable replacement? Past orders and stock history keep the original identity. Replacement stock starts at zero; no held units or prices are copied.')) return;
    const key = `option-${crypto.randomUUID()}`;
    setOptions(current => [...current.map(row => row.clientKey === option.clientKey ? { ...row, isActive: false } : row), {
      ...option, id: undefined, replacesVariantId: option.id, clientKey: key, sku: `SKU-${key.slice(-12).toUpperCase()}`, combinationKey: key,
      optionIdentity: option.optionIdentity ?? null, colourId: option.colourId,
      isActive: false, retiredAt: null, savedSku: null, sourceWasActive: option.isActive, trackInventory: true, threshold: '0', originalStock: null, count: '0', price: '', salePrice: '', sortOrder: current.length,
    }]);
  }
  function validateBasics() {
    if (!form.name.trim()) throw new Error('Enter a product name in Basics.');
    if (!form.categoryId) throw new Error('Choose a category in Basics.');
  }
  function validatePrices() {
    const regular = paise(form.price, 'Product price')!;
    const sale = paise(form.salePrice, 'Product sale price', true);
    const compare = paise(form.compareAt, 'Compare-at price', true);
    if (compare !== null && compare < regular) throw new Error('Compare-at price cannot be below the product price.');
    if (sale !== null && sale >= regular) throw new Error('Product sale price must be below the product price.');
    const labels = new Set<string>();
    const semantics = new Set<string>();
    for (const option of liveOptions.filter(option => !retiringIds.has(option.id ?? ''))) {
      if (!option.optionName.trim() || !option.optionValue.trim()) throw new Error('Enter an option type and value for every sub-item.');
      const identity = JSON.stringify([option.optionName.trim(), option.optionValue.trim()]);
      if (labels.has(identity)) throw new Error('Each non-retired option needs a distinct type and display label.');
      labels.add(identity);
      const semantic = optionSemanticKey(option);
      if (option.isPurchasable && semantic) { if (semantics.has(semantic)) throw new Error('This model and option value already exist, including inactive rows.'); semantics.add(semantic); }
      if (!option.id && option.isPurchasable && !semantic) throw new Error('Enter the explicit option value identity for every new sellable option.');
      if (option.isPurchasable && !option.sku.trim()) throw new Error('Every sellable option requires a unique SKU.');
      const price = paise(option.price, `${option.optionValue} price`, true) ?? regular;
      const optionSale = paise(option.salePrice, `${option.optionValue} sale price`, true);
      if (optionSale !== null && optionSale >= price) throw new Error(`${option.optionValue}: sale price must be below its price (${(price / 100).toFixed(2)}).`);
    }
  }
  function nextStep() {
    setError('');
    try {
      if (step === 0) validateBasics();
      if (step === 2) validatePrices();
      if (step === 3) {
        count(parentCount, 'Product in stock');
        options.filter(option => option.isActive && option.isPurchasable).forEach(option => count(option.count, `${option.optionValue} in stock`));
      }
      setStep(current => Math.min(5, current + 1));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check this step.'); }
  }
  async function save() {
    if (!canEdit || busy || deviceBusy || saveState !== 'ready') return;
    setError(''); setSaved('');
    try {
      if (deviceDirty) throw new Error('Create or reset the unsaved shared model, brand or colour input in Basics before saving this product. Shared references are saved separately.');
      validateBasics(); validatePrices();
      const large = largePriceChanges();
      if (large.length && !window.confirm(`${large.join('\n\n')}\n\nSave anyway?`)) throw new Error('Nothing was saved: the large price change was not confirmed.');
      if (product && (!Number.isInteger(product.catalogRevision) || product.catalogRevision < 0 || product.catalogRevision > 2_147_483_647)) throw new Error('The edit revision is unavailable. Reload the saved product before editing; this form cannot save without conflict protection.');
      if (photos.some(photo => !photo.url.trim())) throw new Error('Enter a URL for each photo, or remove the empty photo.');
      if (options.some(option => option.isActive && option.deviceModelId && !metadata.deviceModelIds.includes(option.deviceModelId))) throw new Error('An active sub-item uses a device that is no longer selected in Basics. Restore its compatible device, or archive and replace the sub-item.');
      if ((useOptionStock || form.isActive) && commerceOptions.some(option => selectedType?.requiresCompatibility && !option.deviceModelId)) throw new Error('In Advanced option details, choose a compatible device for each purchasable option.');
      if (commerceOptions.length > 0 && !useOptionStock && form.isActive) throw new Error('Turn on option checkout in Stock, or save as a draft.');
      if (form.isActive && checklist.some(item => !item.ready && !item.recommended)) throw new Error('Finish the Ready to publish checklist, or turn off Publish in the storefront to save as a draft.');
      const descriptionParsed = parseProductDescription(description);
      if (activateOptions && !stockNote.trim()) throw new Error('Enter a reason for switching to individual variant stock.');
      if (activateOptions && stockSource === 'receipt' && !receiptConfirmed) throw new Error('Confirm these are genuinely new units, not units already in parent stock.');
      if (!transferring && commerceOptions.some(option => option.replacesVariantId && count(option.count, 'Replacement stock') > 0 && !option.receiptConfirmed)) throw new Error('Confirm new stock received for each replacement with nonzero stock. Original units and holds are never copied.');
      if (activateOptions && stockSource === 'receipt' && commerceOptions.some(option => Number(option.count) < (option.originalStock?.onHand ?? 0))) throw new Error('New receipts cannot reduce existing destination counts. Save count corrections separately before switching stock mode.');
      if (transferring && parentCount !== String(product?.stock?.onHand ?? 0)) throw new Error('Save parent count changes before transferring units to variants.');
      if (transferring && commerceOptions.some(option => option.count !== String(option.originalStock?.onHand ?? 0))) throw new Error('Restore destination counts before transferring parent units. Save new receipts or count corrections separately; transfer quantities belong in the allocation fields.');
      const allocations = transferring ? commerceOptions.map(option => ({ variantId: option.id ?? option.clientKey, quantity: count(option.allocation ?? '0', 'Transfer quantity') })) : [];
      const transferred = allocations.reduce((total, row) => total + row.quantity, 0);
      if (transferred > Math.max(0, (product?.stock?.onHand ?? 0) - (product?.stock?.reserved ?? 0))) throw new Error('Transfers exceed available parent stock.');
      const parentStock = product?.inventoryMode === 'variant' || transferring ? undefined : stockPatch(product?.stock ?? null, parentCount, parentThreshold, parentTracking, stockReason, stockNote);
      const metadataInput = scopedMetadataInput(metadata, metadataReferences, form.categoryId);
      const metadataPayload = product ? {
        ...(metadataInput.productTypeId !== metadataState?.productTypeId ? { productTypeId: metadataInput.productTypeId } : {}),
        ...(JSON.stringify(metadataInput.deviceModelIds) !== JSON.stringify(metadataState?.deviceModelIds ?? []) ? { deviceModelIds: metadataInput.deviceModelIds } : {}),
        attributeValues: metadataInput.attributeValues,
      } : metadataInput;
      const draftOptions = liveOptions.map(option => ({
        ...(option.id ? { id: option.id } : {}), ...(option.replacesVariantId ? {replacesVariantId:option.replacesVariantId} : {}), clientKey: option.clientKey, sku: option.sku || null,
        optionName: option.optionName, optionValue: option.optionValue, optionHex: option.optionHex || null,
        deviceModelId: option.deviceModelId || null, combinationKey: option.combinationKey || null,
        optionIdentity: option.optionIdentity,
    isActive: option.isActive, isPurchasable: option.isPurchasable, sortOrder: option.sortOrder,
        ...(option.retiredAt ? {} : pricePayload(option)),
        ...(option.isActive && option.isPurchasable ? { stock: stockPatch(option.originalStock, transferring ? String(option.originalStock?.onHand ?? 0) : option.count, option.threshold, option.replacesVariantId ? true : option.trackInventory, option.replacesVariantId || (activateOptions && stockSource === 'receipt') ? 'receipt' : stockReason, stockNote) } : {}),
      }));
      const slug = form.slug.trim() || form.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const payload = {
        ...(product ? { id: product.id, expectedRevision: product.catalogRevision } : {}),
        product: { ...form, id: product?.id ?? slug, slug, pricePaise: paise(form.price, 'Product price'), compareAtPaise: paise(form.compareAt, 'Compare-at price', true),
          description: product?.description ?? '', brandId: form.brandId || null, conditionId: form.conditionId || null,
          trackInventory: parentTracking, initialOnHand: editing ? 0 : count(parentCount, 'Opening stock'),
          ...(form.cost !== moneyInput(product?.costPaise) ? { costPaise: paise(form.cost, 'Internal cost', true, true) } : {}), sortOrder: count(form.sortOrder, 'Display order'), inStock: form.inStock,
          sellBy, skuPattern: skuPattern.trim() || null },
        metadata: metadataPayload,
        ...(!product || JSON.parse(initialDescription).shortDescription !== description.shortDescription ? { shortDescription: descriptionParsed.shortDescription } : {}),
        ...(!product || initialSections !== JSON.stringify(description.sections) ? { descriptionSections: descriptionParsed.sections } : {}),
        salePricePaise: paise(form.salePrice, 'Product sale price', true),
        ...(large.length ? { confirmLargePriceChanges: true } : {}),
        gallery: photos.map(({ key: _key, ...photo }) => photo), options: draftOptions,
        ...(parentStock ? { stock: parentStock } : {}),
        ...(activateOptions && product?.inventoryMode !== 'variant' ? { activateVariantInventory: { confirm: true, reason: stockNote.trim(), allocations } } : {}),
      };
      setBusy(true);
      let response: Response;
      try { response = await fetch('/api/store-admin/catalog/products/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
      catch { setSaveState('unknown'); throw new Error('Save outcome unknown: the request may have committed. Your draft is retained. Inspect the latest record before reloading; do not repeat this save blindly.'); }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500) { setSaveState('unknown'); throw new Error('Save outcome unknown: the service could not confirm completion. Your draft is retained. Inspect the latest record before reloading; do not repeat this save blindly.'); }
        if (result.code === 'CATALOG_REVISION_CONFLICT') setSaveState('conflict');
        throw new Error(typeof result.error === 'string' ? result.error : 'Could not save this product. Your changes are still here.');
      }
      if (typeof result.product?.id !== 'string' || !Number.isInteger(result.product?.catalogRevision) || result.product.catalogRevision < 0 || result.product.catalogRevision > 2_147_483_647 || (product && result.product.id !== product.id)) {
        setSaveState('unknown'); throw new Error('Save outcome unknown: the response did not contain the saved identity and revision. Inspect the latest record before reloading.');
      }
      setSaveState('saved');
      const warnings = Array.isArray(result.warnings) ? result.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [];
      setBaseline(snapshot); setSaved(['All sections saved.', ...warnings].join(' '));
      router.push(`/store-admin/products/${encodeURIComponent(result.product.id)}`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this product.'); setBusy(false); }
  }
  function cancel() { if (busy || deviceBusy) return; if (!dirty || window.confirm('Discard your unsaved product changes?')) router.push('/store-admin/products'); }
  const input = (key: 'name' | 'slug' | 'subtitle' | 'brand' | 'material' | 'badge' | 'seoTitle' | 'seoDescription', maxLength: number) => <input className="sa-input" maxLength={maxLength} value={form[key]} onChange={event => update(key, event.target.value)} />;
  const money = (key: 'price' | 'salePrice' | 'compareAt') => <input className="sa-input" type="number" min="0.01" step="0.01" value={form[key]} onChange={event => update(key, event.target.value)} />;
  const stockGuide = <p className="sa-hint">1. Turn on “Limit my stock”. 2. Type how many you have in each row. 3. Save. When a row reaches 0, customers can no longer buy it.</p>;
  const colourFillRows = sharedColours.filter(colour => commerceOptions.some(option => option.colourId === colour.id));
  const rowWarnings = new Map<string, string[]>();
  {
    const seenSkus = new Set<string>();
    for (const option of options) rowWarnings.set(option.clientKey, rowWarningList(option, seenSkus));
  };

  const sections: ReactNode[] = [
    <div key="basics">
      <div className="sa-control-grid">
        <Field label="Product name" help="Use the name customers will recognise.">{input('name', 140)}</Field>
        <Field label="Category" help="The category determines which product types are available."><select className="sa-input" value={form.categoryId} onChange={event => { if ((metadata.productTypeId || metadata.deviceModelIds.length || metadataState?.attributes.length || Object.keys(metadata.attributeValues).length) && !window.confirm('Change category? Choose a product type again. Saved and draft attributes and device selections are retained for your review, but out-of-scope fields are not submitted.')) return; update('categoryId', event.target.value); setMetadata(current => ({ ...current, productTypeId: null })); }}><option value="">Choose a category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
        <Field label="Brand" help="The accessory maker or product brand. This does not select a compatible device brand or model."><select className="sa-input" value={form.brandId} onChange={event => { const id = event.target.value; setForm(current => ({ ...current, brandId: id, brand: brands.find(brand => brand.id === id)?.name ?? current.brand })); }}><option value="">No brand record</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></Field>
        <Field label="Subtitle" help="A short line below the name.">{input('subtitle', 200)}</Field>
      </div>
      <ProductSpecificationsEditor value={description} onChange={setDescription} disabled={disabled} />
      {product?.descriptionSections == null && initialSections !== JSON.stringify(description.sections) && <p className="sa-notice">Saving adopts the converted older description and specifications as structured product content. Existing sections are retained and changes are recorded in content history.</p>}
      <ProductMetadataFields references={metadataReferences} state={metadataState} categoryId={form.categoryId} value={metadata} onChange={setMetadata} onReferencesChange={setMetadataReferences} disabled={disabled} canManageDevices={canManageDevices && canEdit} canCreateShared={canCreateShared && canEdit} onDeviceBusyChange={setDeviceBusy} onDeviceDirtyChange={setDeviceDirty} />
      <details><summary>More product settings</summary><div className="sa-control-grid">
        <Field label="Page address (slug)" help="Leave blank to use the name. Changing it changes the product URL.">{input('slug', 80)}</Field>
        <Field label="Brand label" help="Legacy free-text product brand label, kept for existing product copy. Choosing a Brand record fills this label; editing it does not change that record or device compatibility.">{input('brand', 80)}</Field>
        <Field label="Condition" help="The condition of the item being sold, such as new or refurbished; not its publication or stock status. Leave unset when not applicable."><select className="sa-input" value={form.conditionId} onChange={event => update('conditionId', event.target.value)}><option value="">Not set</option>{conditions.map(condition => <option key={condition.id} value={condition.id}>{condition.name}</option>)}</select></Field>
        <Field label="Material" help="Optional legacy material description, such as silicone. This does not fill or replace a material detail field required by the product type.">{input('material', 120)}</Field><Field label="Badge" help="Optional short customer-facing label, such as New. It does not activate a sale, publish the product or change its price.">{input('badge', 40)}</Field>
        <Field label="Internal cost ₹" help="Optional; used for internal valuation."><input className="sa-input" type="number" min="0.01" step="0.01" value={form.cost} onChange={event => update('cost', event.target.value)} /></Field>
        <Field label="Display order" help="Lower numbers appear first where manual product ordering is used. This does not change category, stock or price."><input className="sa-input" type="number" min="0" max="9999" step="1" value={form.sortOrder} onChange={event => update('sortOrder', event.target.value)} /></Field>
        <label className="sa-check"><input type="checkbox" checked={form.inStock} onChange={event => update('inStock', event.target.checked)} />Available for purchase (stock limits still apply)</label>
      </div></details>
    </div>,
    <div key="photos">
      {photos.length === 0 && <p className="sa-empty">No photos yet. Add a main photo to help customers recognise this product.</p>}
      {photos.map((photo, index) => <fieldset key={photo.key} className="sa-detail-card"><legend>Photo {index + 1}</legend><div className="sa-control-grid">
        <Field label="Image URL" help="Use a public https URL or a media path such as /media/photo.jpg."><input className="sa-input" maxLength={2048} value={photo.url} onChange={event => setPhotos(current => current.map(row => row.key === photo.key ? { ...row, url: event.target.value } : row))} /></Field>
        <Field label="Photo description (alt text)" help="Describe what is visible for customers using a screen reader."><input className="sa-input" maxLength={200} value={photo.alt} onChange={event => setPhotos(current => current.map(row => row.key === photo.key ? { ...row, alt: event.target.value } : row))} /></Field>
        <Field label="Use photo as"><select className="sa-input" value={photo.role} onChange={event => { const role = event.target.value; setPhotos(current => current.map(row => row.key === photo.key ? { ...row, role } : row.role === role && role !== 'gallery' ? { ...row, role: 'gallery' } : row)); }}><option value="primary">Main photo</option><option value="hover">Hover photo</option><option value="gallery">Gallery photo</option></select></Field>
        <Field label="Colour (optional)" help="Choose a colour to show this photo only when that colour is picked. Leave blank for the main gallery."><select className="sa-input" value={photo.colourId ?? ''} onChange={event => { const colourId = event.target.value || null; setPhotos(current => current.map(row => row.key === photo.key ? { ...row, colourId, role: colourId && row.role !== 'gallery' ? 'gallery' : row.role } : row)); }}><option value="">All colours (main gallery)</option>{sharedColours.filter(colour => colour.isActive !== false || colour.id === photo.colourId).map(colour => <option key={colour.id} value={colour.id}>{colour.name} ({colour.hex})</option>)}</select></Field>
        <Field label="Display order"><input className="sa-input" type="number" min="0" step="1" value={photo.sortOrder} onChange={event => setPhotos(current => current.map(row => row.key === photo.key ? { ...row, sortOrder: Number(event.target.value) } : row))} /></Field>
      </div><button className="sa-btn sa-btn-quiet" type="button" onClick={() => setPhotos(current => current.filter(row => row.key !== photo.key))}>Remove photo {index + 1}</button></fieldset>)}
      <button className="sa-btn" type="button" onClick={() => setPhotos(current => [...current, { key: crypto.randomUUID(), url: '', alt: '', role: current.some(photo => photo.role === 'primary') ? 'gallery' : 'primary', sortOrder: current.length, colourId: null }])}>Add photo</button>
      {sharedColours.length === 0 && <p className="sa-hint">No shared colours yet. Add colours under Shared lists in Basics to give each colour its own photos.</p>}
      <p className="sa-hint">Photo changes are staged until you save the product.</p>
    </div>,
    <div key="price"><div className="sa-control-grid">
      <Field label="Product price ₹" help="The regular price, including any applicable taxes.">{money('price')}</Field>
      <Field label="Sale price ₹" help="Optional; must be below the regular price. Used only while sale mode is on.">{money('salePrice')}</Field>
      <Field label="Compare-at price ₹" help="Optional reference price; cannot be below the regular price.">{money('compareAt')}</Field>
    </div>
    <h3 className="sa-card-title">Options, price and stock</h3><p className="sa-hint">Choose how you sell this product, then check every row in one table. A blank price uses the product price. Saved SKUs never change; archive and replace a row to change one.</p><ProductHelp label="How option prices work">A blank regular price uses the product price. An option with its own price does not inherit the product sale, so set an option sale too when you want one. Option sales apply only while sale mode is on. A large price change asks you to confirm, then saves; it is never blocked.</ProductHelp>
    <div className="sa-control-grid">
      <Field label="Sell by" help="Changes only how rows are suggested. Saved rows are never rewritten."><select className="sa-input" value={sellBy} onChange={event => { if (isSellBy(event.target.value)) { setSellBy(event.target.value); setGeneratedRows([]); setGeneratedNotice(''); } }}>{SELL_BY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
      <Field label="SKU pattern (optional)" help="Used only to suggest new SKUs. Type {product}, {model}, {colour} or {value}; saved SKUs never change."><input className="sa-input" maxLength={120} placeholder="{product}-{model}-{colour}-{value}" value={skuPattern} onChange={event => setSkuPattern(event.target.value)} /></Field>
      {sellBy === 'other' && <Field label="Option name" help="For example Wattage or Size."><input className="sa-input" maxLength={40} value={otherName} onChange={event => setOtherName(event.target.value)} /></Field>}
    </div>
    <p className="sa-hint">{SELL_BY_OPTIONS.find(option => option.value === sellBy)?.help}</p>
    {sellBy === 'other' && <Field label="Option values" help="Separate values with commas or new lines, for example 20W, 30W, 65W."><textarea className="sa-input" rows={2} value={otherValues} onChange={event => setOtherValues(event.target.value)} /></Field>}
    {sellByUsesColour(sellBy) && !sharedColours.some(colour => colour.isActive !== false) && <p className="sa-notice">Add colours under Shared lists in Basics before generating colour rows.</p>}
    {sellByUsesModel(sellBy) && metadata.deviceModelIds.length === 0 && <p className="sa-notice">Select compatible devices in Basics before generating model rows.</p>}
    <button className="sa-btn" type="button" onClick={planOptionRows}>Add missing rows</button>
    {generatedNotice && <p className="sa-hint" role="status">{generatedNotice}</p>}
    {generatedRows.length > 0 && <fieldset className="sa-detail-card"><legend>Rows to add</legend><p className="sa-hint">New rows start inactive with zero stock, so nothing goes on sale by accident. Add them, then set price and stock below.</p><ul className="sa-plain-list">{generatedRows.map(row => <li key={`${row.deviceModelId ?? ''}:${row.optionName}:${row.optionValue}`}>{row.optionValue} — {row.optionName}</li>)}</ul><button className="sa-btn" type="button" onClick={addGeneratedRows}>Add these rows</button><button className="sa-btn sa-btn-quiet" type="button" onClick={() => { setGeneratedRows([]); setGeneratedNotice(''); }}>Discard</button></fieldset>}
    <details><summary>Other ways to add rows</summary><div className="sa-control-grid"><Field label="Option type"><select className="sa-input" value={optionType} onChange={event => setOptionType(event.target.value)}>{['Model', 'Wattage', 'Colour', 'Size', 'Specification'].map(type => <option key={type}>{type}</option>)}</select></Field><Field label="Option values" help="Separate values with commas or new lines, for example 20W, 30W, 65W."><textarea className="sa-input" rows={2} value={optionValues} onChange={event => setOptionValues(event.target.value)} /></Field></div>
    <label className="sa-check"><input type="checkbox" checked={combineModels} onChange={event => setCombineModels(event.target.checked)} />Create a sub-item for each selected compatible device</label>
    <p className="sa-hint">For model × colour combinations, select devices in Basics and enter colours above. With no values, this creates one sub-item per selected device. Compatibility is never guessed.</p>
    <button className="sa-btn" type="button" onClick={generateOptions}>Generate options</button>
    {candidates.length > 0 && <fieldset className="sa-detail-card"><legend>Review physical combinations</legend><p className="sa-hint" role="status">{candidateNotice}</p>{candidates.map((candidate, index) => <label className="sa-check" key={optionSemanticKey(candidate)}><input type="checkbox" checked={candidate.selected} onChange={event => setCandidates(current => current.map((row, i) => i === index ? { ...row, selected: event.target.checked } : row))} />{candidate.optionValue}</label>)}<button className="sa-btn" type="button" onClick={addReviewedOptions}>Add selected combinations</button><button className="sa-btn sa-btn-quiet" type="button" onClick={() => setCandidates([])}>Discard preview</button></fieldset>}</details>
    <fieldset className="sa-detail-card"><legend>Fill several rows at once</legend><p className="sa-hint">Fills the same value into every active sellable row below. Blank boxes are left alone.</p><div className="sa-control-grid"><Field label="Price ₹ for all rows"><input className="sa-input" type="number" min="0.01" step="0.01" value={bulkPrice} onChange={event => setBulkPrice(event.target.value)} /></Field><Field label="Sale ₹ for all rows"><input className="sa-input" type="number" min="0.01" step="0.01" value={bulkSale} onChange={event => setBulkSale(event.target.value)} /></Field><Field label="Stock for all rows"><input className="sa-input" type="number" min="0" step="1" value={bulkStock} onChange={event => setBulkStock(event.target.value)} /></Field></div><button className="sa-btn" type="button" onClick={applyBulk}>Fill rows</button>
    {colourFillRows.length > 0 && <><p className="sa-hint">Or set a different price for each colour, for example Red ₹100 and Black ₹120.</p><div className="sa-control-grid">{colourFillRows.map(colour => <Field key={colour.id} label={`${colour.name} price ₹`}><input aria-label={`Price for all ${colour.name} rows`} className="sa-input" type="number" min="0.01" step="0.01" value={colourPrices[colour.id] ?? ''} onChange={event => setColourPrices(current => ({ ...current, [colour.id]: event.target.value }))} /></Field>)}</div><button className="sa-btn" type="button" onClick={applyColourPrices}>Set these prices</button></>}</fieldset>
    {stockGuide}
    <label className="sa-check"><input type="checkbox" role="switch" checked={masterTracking} onChange={event => setMasterTracking(event.target.checked)} />Limit my stock</label>
    {!masterTracking && <p className="sa-notice">Stock is not limited, so this can be sold without end. <button type="button" className="sa-btn sa-btn-small" onClick={() => setMasterTracking(true)}>Turn on</button></p>}
    <div className="sa-table-wrap"><table className="sa-table"><caption>One row per option — price, sale, stock and visibility save together</caption><thead><tr><th>Model or option</th><th>Colour</th><th>SKU</th><th>Price ₹</th><th>Sale ₹</th><th>Stock</th><th>Active</th><th>History</th><th>Remove</th></tr></thead><tbody>{options.map(option => {
      const locked = !!option.retiredAt || (!!option.id && option.isPurchasable) || retiringIds.has(option.id ?? '');
      const model = modelOf(option);
      const colour = colourOf(option);
      const history = option.id ? (product?.priceHistory ?? []).filter(row => row.variantId === option.id) : [];
      const warnings = rowWarnings.get(option.clientKey) ?? [];
      return <tr key={option.clientKey}>
        <td><Field label={`Option type for ${option.optionValue}`}><input className="sa-input" readOnly={locked} maxLength={40} value={option.optionName} onChange={event => updateOption(option.clientKey, { optionName: event.target.value })} /></Field><Field label={`Model, colour or value for ${option.optionValue}`}><input className="sa-input" readOnly={locked} maxLength={60} value={option.optionValue} onChange={event => updateOption(option.clientKey, { optionValue: event.target.value })} /></Field>{model && <span className="sa-row-sub">Model: {model.brandName} {model.name}</span>}{option.retiredAt && <span className="sa-row-sub">Retired — read-only history</span>}{retiringIds.has(option.id ?? '') && <span className="sa-row-sub">Retires when replacement is saved</span>}{!option.isPurchasable && <span className="sa-row-sub">Display only</span>}</td>
        <td>{sharedColours.length > 0 ? <select aria-label={`Colour for ${option.optionValue}`} className="sa-input" disabled={locked} value={option.colourId} onChange={event => { const next = sharedColours.find(item => item.id === event.target.value); updateOption(option.clientKey, { colourId: event.target.value, ...(next ? { optionHex: next.hex } : {}) }); }}><option value="">No colour</option>{sharedColours.filter(item => item.isActive !== false || item.id === option.colourId).map(item => <option key={item.id} value={item.id}>{item.name} ({item.hex})</option>)}</select> : <span className="sa-row-sub">Add colours in Basics</span>}{colour && <span className="sa-swatch" aria-hidden="true" style={{ background: colour.hex }} />}</td>
        <td><input aria-label={`SKU for ${option.optionValue}`} className="sa-input sa-input-mono" maxLength={64} disabled={!!option.retiredAt || (!!option.id && option.savedSku != null) || retiringIds.has(option.id ?? '')} value={option.sku} onChange={event => updateOption(option.clientKey, { sku: event.target.value.toUpperCase() })} />{warnings.map(warning => <span className="sa-row-sub" key={warning}>{warning}</span>)}</td>
        <td><input aria-label={`Price for ${option.optionValue}`} className="sa-input" type="number" min="0.01" step="0.01" disabled={!!option.retiredAt || retiringIds.has(option.id ?? '')} placeholder={form.price || 'Product price'} value={option.price} onChange={event => updateOption(option.clientKey, { price: event.target.value })} /></td>
        <td><input aria-label={`Sale price for ${option.optionValue}`} className="sa-input" type="number" min="0.01" step="0.01" disabled={!!option.retiredAt || retiringIds.has(option.id ?? '')} placeholder="No sale" value={option.salePrice} onChange={event => updateOption(option.clientKey, { salePrice: event.target.value })} /></td>
        <td><label className="sa-check"><input aria-label={`Limit stock for ${option.optionValue}`} type="checkbox" role="switch" disabled={!!option.retiredAt || !option.isActive || !option.isPurchasable || transferring || !!option.replacesVariantId} checked={option.trackInventory} onChange={event => updateOption(option.clientKey, { trackInventory: event.target.checked })} />Limit</label><input aria-label={`In stock for ${option.optionValue}`} className="sa-input" type="number" min="0" step="1" disabled={!!option.retiredAt || !option.isActive || !option.isPurchasable || transferring} value={option.count} onChange={event => updateOption(option.clientKey, { count: event.target.value })} /></td>
        <td><label className="sa-check"><input aria-label={`Active ${option.optionValue}`} type="checkbox" disabled={!!option.retiredAt || retiringIds.has(option.id ?? '')} checked={option.isActive} onChange={event => updateOption(option.clientKey, { isActive: event.target.checked })} />Active</label></td>
        <td>{option.id ? history.length ? <details><summary>{history.length} change{history.length === 1 ? '' : 's'}</summary><ul className="sa-plain-list">{history.map(row => <li key={row.id}>{row.priceKind === 'sale' ? 'Sale' : row.priceKind === 'sale_cleared' ? 'Sale cleared' : 'Regular'}: {row.oldPricePaise === null ? '—' : rupees(row.oldPricePaise)} → {row.priceKind === 'sale_cleared' && row.newPricePaise === 0 ? '—' : rupees(row.newPricePaise)}</li>)}</ul></details> : <span className="sa-row-sub">No changes</span> : <span className="sa-row-sub">New row</span>}</td>
        <td>{!option.id ? <button type="button" className="sa-btn sa-btn-small sa-btn-quiet" disabled={!!option.retiredAt} onClick={() => option.replacesVariantId ? cancelReplacement(option) : setOptions(current => current.filter(row => row.clientKey !== option.clientKey))}>{option.replacesVariantId ? 'Cancel replacement' : 'Remove'}</button> : option.isPurchasable && !option.retiredAt && !retiringIds.has(option.id) ? <button type="button" className="sa-btn sa-btn-small" disabled={liveOptions.length >= 100} onClick={() => replaceOption(option)}>Archive and replace</button> : <span className="sa-row-sub">Read-only</span>}</td>
      </tr>; })}</tbody></table></div>
    {options.length > 0 && <details><summary>Advanced option details</summary><p className="sa-hint">Saved commerce identities cannot be changed. Archive an option and create a new one to change its identity. New SKUs are generated for you. Choose a compatible device for each model option when the product type requires it.</p>{options.map(option => <fieldset key={option.clientKey} className="sa-detail-card"><legend>{option.optionName}: {option.optionValue}</legend><div className="sa-control-grid">
      <Field label="SKU"><input className="sa-input" disabled={!!option.retiredAt || (!!option.id && option.savedSku != null)} maxLength={60} value={option.sku} onChange={event => updateOption(option.clientKey, { sku: event.target.value })} /></Field>
      <Field label="Compatible device"><select className="sa-input" disabled={!!option.retiredAt || (!!option.id && option.isPurchasable) || retiringIds.has(option.id ?? '')} value={option.deviceModelId} onChange={event => updateOption(option.clientKey, { deviceModelId: event.target.value })}><option value="">No device mapping</option>{metadataReferences.models.filter(model => metadata.deviceModelIds.includes(model.id)).map(model => <option key={model.id} value={model.id}>{model.brandName} {model.name}</option>)}{option.deviceModelId && !metadata.deviceModelIds.includes(option.deviceModelId) && <option value={option.deviceModelId}>{option.deviceModelId} — compatibility needs review</option>}</select></Field>
      <Field label="Colour hex (optional)"><input className="sa-input" disabled={!!option.retiredAt || retiringIds.has(option.id ?? '')} maxLength={7} value={option.optionHex} onChange={event => updateOption(option.clientKey, { optionHex: event.target.value })} /></Field>
      <label className="sa-check"><input type="checkbox" disabled={!!option.retiredAt || (!!option.id && option.isPurchasable) || retiringIds.has(option.id ?? '')} checked={option.isPurchasable} onChange={event => updateOption(option.clientKey, { isPurchasable: event.target.checked })} />Customers can buy this option</label>
      {!option.id && <Field label="Option value identity" help="The explicit colour or value alone, not an inferred combined model label. Saved identities cannot change."><input className="sa-input" maxLength={100} value={option.optionIdentity ?? ''} onChange={event => updateOption(option.clientKey, { optionIdentity: normalizeOptionIdentity(event.target.value) })} /></Field>}
    </div>{option.replacesVariantId && <label className="sa-check"><input type="checkbox" checked={option.receiptConfirmed ?? false} onChange={event => updateOption(option.clientKey, { receiptConfirmed: event.target.checked })} />Confirm new stock received for {option.optionValue} replacement</label>}{!option.id && <button className="sa-btn sa-btn-quiet" type="button" onClick={() => option.replacesVariantId ? cancelReplacement(option) : setOptions(current => current.filter(row => row.clientKey !== option.clientKey))}>{option.replacesVariantId ? 'Cancel replacement' : 'Remove unsaved option'}</button>}</fieldset>)}</details>}
    </div>,
    <div key="stock"><p className="sa-notice">Inventory mode: <strong>{useOptionStock ? 'Individual variant stock' : 'Shared product stock'}</strong>. Compatible devices alone do not change this mode.</p>{stockGuide}
      {product?.inventoryMode === 'variant' && <p className="sa-hint">Retained parent balance: {product.stock?.onHand ?? 0}. These units are not an additional customer stock pool.</p>}
      {activateOptions && product?.inventoryMode !== 'variant' && <fieldset className="sa-detail-card"><legend>Where do variant units come from?</legend><label className="sa-field"><span className="sa-label">Stock source</span><select className="sa-input" value={stockSource} onChange={event => { setStockSource(event.target.value as 'transfer' | 'receipt'); setReceiptConfirmed(false); }}><option value="transfer">Transfer existing parent units</option><option value="receipt">Receive genuinely new variant units</option></select></label>{transferring ? <><p className="sa-hint">Available parent units: {Math.max(0, (product?.stock?.onHand ?? 0) - (product?.stock?.reserved ?? 0))}. Existing destination counts remain unchanged before allocation. Receive additional units in a separate save afterward.</p>{commerceOptions.map(option => <Field key={option.clientKey} label={`Transfer to ${option.optionValue}`}><input className="sa-input" type="number" min="0" step="1" value={option.allocation ?? '0'} onChange={event => updateOption(option.clientKey, { allocation: event.target.value })} /></Field>)}<p className="sa-hint">Total transfer: {commerceOptions.reduce((sum, option) => sum + Number(option.allocation ?? 0), 0)}. Never enter the same units as opening variant stock.</p></> : <label className="sa-check"><input type="checkbox" checked={receiptConfirmed} onChange={event => setReceiptConfirmed(event.target.checked)} />I confirm these are new units, not units already counted in parent stock.</label>}</fieldset>}
      {commerceOptions.length > 0 && product?.inventoryMode !== 'variant' && <div className="sa-notice"><p><strong>Needs review:</strong> this product sells options but keeps one shared stock count, so the store cannot tell which colour or model ran out. Nothing changes until you choose option stock and save.</p><label className="sa-check"><input type="checkbox" checked={activateOptions} onChange={event => setActivateOptions(event.target.checked)} />Use these options at checkout with their own stock counts</label><p className="sa-hint">This switches the product to option stock when saved. Enter each option count explicitly. Existing product stock stays separate and is never copied or split automatically. Outstanding checkouts or old stock obligations may prevent the switch.</p></div>}
      <label className="sa-check"><input type="checkbox" role="switch" checked={masterTracking} onChange={event => setMasterTracking(event.target.checked)} />Limit my stock</label>
      {!masterTracking && <p className="sa-notice">Stock is not limited, so this can be sold without end. <button type="button" className="sa-btn sa-btn-small" onClick={() => setMasterTracking(true)}>Turn on</button></p>}
      {useOptionStock && commerceOptions.length === 0 ? <p className="sa-notice">No active sellable variants. Review and activate physical options in Price and options. Parent stock cannot substitute for missing variants.</p> : useOptionStock ? <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>Option</th><th>In stock</th><th>Held in checkouts</th><th>Available to buy</th><th>Warn me when below</th></tr></thead><tbody>{commerceOptions.map(option => <tr key={option.clientKey}><td>{option.optionValue}<span className="sa-row-sub">{option.trackInventory ? 'Limited' : 'Not limited'}</span></td><td><input aria-label={`Stock count for ${option.optionValue}`} className="sa-input" type="number" min={option.originalStock?.reserved ?? 0} step="1" disabled={transferring} value={option.count} onChange={event => updateOption(option.clientKey, { count: event.target.value })} /></td><td>{option.originalStock?.reserved ?? 0}</td><td>{option.trackInventory ? Math.max(0, Number(option.count) - (option.originalStock?.reserved ?? 0)) : 'Not limited'}</td><td><input aria-label={`Warn below for ${option.optionValue}`} className="sa-input" type="number" min="0" step="1" value={option.threshold} onChange={event => updateOption(option.clientKey, { threshold: event.target.value })} /></td></tr>)}</tbody></table></div> : <div className="sa-control-grid"><Field label="In stock" help="The exact total you have, including units held in checkouts."><input className="sa-input" type="number" min={product?.stock?.reserved ?? 0} step="1" value={parentCount} onChange={event => setParentCount(event.target.value)} /></Field><Field label="Warn me when below"><input className="sa-input" type="number" min="0" step="1" value={parentThreshold} onChange={event => setParentThreshold(event.target.value)} /></Field><p className="sa-hint">Held in checkouts: {product?.stock?.reserved ?? 0} · Available to buy: {parentTracking ? Math.max(0, Number(parentCount) - (product?.stock?.reserved ?? 0)) : 'Not limited'}</p></div>}
      <div className="sa-control-grid"><Field label="Reason for stock change"><select className="sa-input" value={stockReason} onChange={event => setStockReason(event.target.value)}><option value="adjustment">Count correction</option><option value="receipt">New stock received</option><option value="damage">Damaged stock</option></select></Field><Field label="Stock note (optional)" help="Explain the change to other staff. Avoid customer information."><input className="sa-input" maxLength={200} value={stockNote} onChange={event => setStockNote(event.target.value)} /></Field></div>
      <p className="sa-hint">Every saved stock change has a movement record. Counts must cover units held in checkouts; the server checks current holds before saving.</p>
    </div>,
    <div key="description"><ProductDescriptionEditor value={description} onChange={setDescription} disabled={disabled} /><details><summary>Search result settings (optional)</summary><div className="sa-control-grid"><Field label="Search title">{input('seoTitle', 120)}</Field><Field label="Search description">{input('seoDescription', 320)}</Field></div></details></div>,
    <div key="review"><h3 className="sa-card-title">Ready to publish?</h3><ul className="sa-plain-list">{checklist.map(item => <li key={item.label}>{item.ready ? 'Ready' : 'Needs attention'} — {item.label}<ProductHelp label={item.label}>{item.recommended ? 'Recommended for customers, but not a publication blocker for existing or ordinary products.' : 'Complete this check before publishing, or save a draft while you finish.'}</ProductHelp></li>)}</ul>{metadataProblems.length > 0 && <ul className="sa-hint">{metadataProblems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
      <dl className="sa-meta"><div><dt>Product</dt><dd>{form.name || 'Name not entered'}</dd></div><div><dt>Price</dt><dd>{form.price ? `₹${form.price}` : 'Not entered'}</dd></div><div><dt>Photos</dt><dd>{photos.length}</dd></div><div><dt>Active options</dt><dd>{commerceOptions.length}</dd></div><div><dt>Stock</dt><dd>{masterTracking ? 'Limited to your entered counts' : 'Not limited'}</dd></div></dl>
      <label className="sa-check"><input type="checkbox" checked={form.isActive} onChange={event => update('isActive', event.target.checked)} />Publish in the storefront</label><p className="sa-hint">Leave this off to save as a draft. The server checks required metadata and compatible devices again before publishing.</p>
    </div>,
  ];
  return <ProductGuide><div className={`sa-product-workflow ${editing ? 'lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6' : ''}`}>
    <nav aria-label={editing ? 'Product sections' : 'Product setup progress'} className={editing ? 'lg:sticky lg:top-6 lg:self-start' : 'sa-detail-card'}>
      {!editing && <><p className="sa-hint">Step {step + 1} of {steps.length}</p><progress className="w-full" aria-label="Product setup progress" max={steps.length} value={step + 1} /></>}
      <ol className={editing ? 'space-y-2' : 'flex flex-wrap gap-2'}>{steps.map((title, index) => <li key={title}>{editing ? <div className="sa-product-guided-action"><a className="sa-btn sa-btn-quiet" href={`#product-step-${index}`}>{index + 1}. {title}</a><ProductHelp label={`Go to ${title}`}>{explanations[index]} This link moves to the section without saving.</ProductHelp></div> : <button className={`sa-btn ${step === index ? 'sa-btn-primary' : 'sa-btn-quiet'}`} type="button" aria-current={step === index ? 'step' : undefined} onClick={() => { setStep(index); setError(''); }}>{index + 1}. {title}</button>}</li>)}</ol>
    </nav>
    <div className="min-w-0">
      {!canEdit && <div className="sa-lock-note">You have view-only access. A store admin or owner can save changes.<ProductHelp label="View-only access">You can read every section and open help, but cannot change or save product data. Ask a store admin or owner to make changes.</ProductHelp></div>}
      <form onSubmit={event => { event.preventDefault(); if (editing || step === 5) void save(); else nextStep(); }}>
        <fieldset disabled={disabled} className="min-w-0 border-0 p-0 m-0">
          {steps.map((title, index) => (editing || step === index || index === 0) && <section hidden={!editing && step !== index} className="sa-detail-card scroll-mt-6" id={`product-step-${index}`} key={title}><h2 className="sa-section-title">{index + 1}. {title}</h2><p className="sa-card-note">{explanations[index]}</p>{sections[index]}</section>)}
        </fieldset>
        <div className="sa-detail-card sticky bottom-0 z-20 border-t border-gray-200 bg-white shadow-lg" aria-label="Save product">
          {error && <p className="sa-error" role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
          {(saveState === 'conflict' || saveState === 'unknown') && <div className="sa-notice"><p>Your local draft is retained. Compare it with the saved record before discarding or reapplying any changes.</p>{product && <a href={`/store-admin/products/${encodeURIComponent(product.id)}`} target="_blank" rel="noopener noreferrer">Inspect latest product in a new tab</a>}<button className="sa-btn" type="button" onClick={() => { if (window.confirm('Reload and discard this local draft? Inspect and copy any unsaved changes first.')) window.location.reload(); }}>Reload saved product</button></div>}
          <p className="sa-hint">{dirty ? 'You have unsaved changes. ' : ''}All six sections save together.</p>
          <div className="sa-inline-actions">
            {!editing && step > 0 && <button className="sa-btn" type="button" disabled={busy} onClick={() => setStep(current => current - 1)}>Back</button>}
            {canEdit && (editing || step === 5 ? <button className="sa-btn sa-btn-primary" type="submit" disabled={busy || deviceBusy || saveState !== 'ready'}>{busy ? 'Saving…' : editing ? 'Save changes' : form.isActive ? 'Create and publish' : 'Save as draft'}</button> : <button className="sa-btn sa-btn-primary" type="submit" disabled={busy}>Continue</button>)}
            <button className="sa-btn sa-btn-quiet" type="button" disabled={busy || deviceBusy} onClick={cancel}>{canEdit ? 'Cancel' : 'Back to products'}</button>
          </div>
        </div>
      </form>
    </div>
  </div></ProductGuide>;
}
