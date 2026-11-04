import type { MetadataReferences } from '@/lib/catalog/product-metadata-rules';

export interface OptionCombination {
  optionName: string;
  optionValue: string;
  deviceModelId: string;
  optionIdentity: string;
}

export const normalizeOptionIdentity = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function optionSemanticKey(row: { optionName: string; deviceModelId?: string | null; optionIdentity?: string | null }): string | null {
  return row.optionIdentity ? JSON.stringify([normalizeOptionIdentity(row.optionName), row.deviceModelId || null, normalizeOptionIdentity(row.optionIdentity)]) : null;
}

/** One commerce identity per selected device/value pair; never infer compatibility. */
export function productOptionCombinations(
  optionType: string,
  rawValues: string,
  combineModels: boolean,
  selectedIds: string[],
  references: MetadataReferences,
): OptionCombination[] {
  const seenValues = new Set<string>();
  const values = rawValues.split(/[,\n]/).map(value => value.trim().replace(/\s+/g, ' ')).filter(value => {
    const identity = normalizeOptionIdentity(value);
    if (!identity || seenValues.has(identity)) return false;
    seenValues.add(identity); return true;
  });
  if (!optionType.trim() || optionType.length > 40) throw new Error('Choose an option type within 40 characters.');
  if (values.some(value => value.length > 60)) throw new Error('Keep each option value within 60 characters.');
  if (!combineModels) {
    if (!values.length) throw new Error('Type at least one option value, separated by commas or new lines.');
    if (values.length > 100) throw new Error('Use at most 100 sub-items.');
    return values.map(optionValue => ({ optionName: optionType, optionValue, deviceModelId: '', optionIdentity: optionValue.trim().replace(/\s+/g,' ').toLowerCase() }));
  }
  const models = references.models.filter(model => selectedIds.includes(model.id) && model.isActive && references.brands.some(brand => brand.id === model.brandId && brand.isActive));
  if (!models.length) throw new Error('Select active compatible devices in Basics before generating model sub-items.');
  const combinations = models.flatMap(model => (values.length ? values : ['']).map(value => ({
    optionName: values.length ? `Model / ${optionType}` : 'Model',
    optionValue: (() => {
      const ambiguous = models.some(other => other.id !== model.id && normalizeOptionIdentity(other.name) === normalizeOptionIdentity(model.name));
      const label = ambiguous ? `${model.brandName} ${model.name}` : model.name;
      return values.length ? `${label} / ${value}` : label;
    })(),
    deviceModelId: model.id,
    optionIdentity: value ? value.trim().replace(/\s+/g,' ').toLowerCase() : 'model',
  })));
  if (combinations.length > 100 || combinations.some(item => item.optionValue.length > 60 || item.optionName.length > 40)) throw new Error('Use at most 100 sub-items and keep each combined label within 60 characters.');
  return combinations;
}
