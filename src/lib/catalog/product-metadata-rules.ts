import { validateAttributeValue } from '@/lib/store-admin/catalog-rules';

export interface TypeAttribute {
  attributeId: string; key: string; label: string; dataType: string;
  options: string[]; isRequired: boolean; sortOrder: number;
  showInSpecs: boolean; showInFilters: boolean; showInSearch: boolean;
}
export interface ProductType {
  id: string; categoryId: string; name: string; requiresCompatibility: boolean;
  isActive: boolean; sortOrder: number; attributes: TypeAttribute[];
}
export interface DeviceBrand { id: string; name: string; isActive: boolean; sortOrder: number }
export interface DeviceModel {
  id: string; brandId: string; brandName: string; name: string;
  isActive: boolean; sortOrder: number;
}
export interface MetadataReferences { types: ProductType[]; brands: DeviceBrand[]; models: DeviceModel[] }
export type AttributePrimitive = string | number | boolean | null;
export interface MetadataInput {
  productTypeId?: string | null;
  deviceModelIds?: string[];
  attributeValues?: Record<string, AttributePrimitive>;
}
export class MetadataError extends Error {}
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export function parseMetadataInput(raw: unknown): MetadataInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MetadataError('Send product metadata as an object.');
  const source = raw as Record<string, unknown>;
  const result: MetadataInput = {};
  if ('productTypeId' in source) {
    if (source.productTypeId !== null && (typeof source.productTypeId !== 'string' || !ID.test(source.productTypeId))) throw new MetadataError('Select a valid product type.');
    result.productTypeId = source.productTypeId as string | null;
  }
  if ('deviceModelIds' in source) {
    const ids = source.deviceModelIds;
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string' || !ID.test(id))) throw new MetadataError('Device models must be an array of model IDs (maximum 500).');
    if (new Set(ids).size !== ids.length) throw new MetadataError('Select each device model only once.');
    result.deviceModelIds = ids;
  }
  if ('attributeValues' in source) {
    const values = source.attributeValues;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 100) throw new MetadataError('Attribute values must be an object (maximum 100 fields).');
    result.attributeValues = {};
    for (const [id,value] of Object.entries(values)) {
      if (!ID.test(id) || !(value === null || ['string','number','boolean'].includes(typeof value)) || (typeof value === 'string' && value.length > 2000) || (typeof value === 'number' && !Number.isFinite(value))) throw new MetadataError('Invalid attribute value.');
      result.attributeValues[id] = value as AttributePrimitive;
    }
  }
  return result;
}
export function validateScopedValue(attribute: TypeAttribute, value: AttributePrimitive): void {
  if (value === null) return;
  const checked = validateAttributeValue(attribute.dataType as Parameters<typeof validateAttributeValue>[0], value);
  if (!checked.ok) throw new MetadataError(`${attribute.label}: ${checked.error}`);
  if (attribute.dataType === 'enum' && !attribute.options.includes(String(value).trim())) throw new MetadataError(`${attribute.label}: select a defined option.`);
}
/** Explicit null means deliberately untyped; omitted IDs retain the legacy strict check. */
export function publicationProblems(type: ProductType | undefined, categoryId: string, values: Record<string, AttributePrimitive>, activeModelIds: string[], effectiveTypeId?: string | null): string[] {
  if (effectiveTypeId === null) return [];
  if (!type || !type.isActive || type.categoryId !== categoryId || (effectiveTypeId !== undefined && type.id !== effectiveTypeId)) return ['Select an active product type for this category before publishing.'];
  const problems: string[] = [];
  for (const attribute of type.attributes) {
    const value = values[attribute.attributeId];
    if (attribute.isRequired && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) problems.push(`${attribute.label} is required.`);
    if (value !== undefined && value !== null) {
      try { validateScopedValue(attribute, value); }
      catch (error) { problems.push(error instanceof MetadataError ? error.message : `${attribute.label} is invalid.`); }
    }
  }
  if (type.requiresCompatibility && activeModelIds.length === 0) problems.push('Select at least one active compatible device model before publishing.');
  return problems;
}
