/**
 * India Post PIN code response parser for product delivery availability.
 *
 * Parses responses from `https://api.postalpincode.in/pincode/{PINCODE}` and
 * selects the primary Block/Mandal/Taluk plus frequency-ordered districts so
 * border PIN codes let customers switch districts when applicable.
 */

export interface PostalPostOffice {
  Name?: string | null;
  BranchType?: string | null;
  DeliveryStatus?: string | null;
  Circle?: string | null;
  District?: string | null;
  Division?: string | null;
  Region?: string | null;
  Block?: string | null;
  State?: string | null;
  Country?: string | null;
  Pincode?: string | null;
}

export interface PostalPincodeApiEntry {
  Message?: string | null;
  Status?: string | null;
  PostOffice?: PostalPostOffice[] | null;
}

export interface PincodeLocation {
  pincode: string;
  town: string;
  defaultDistrict: string;
  districts: string[];
  state: string;
}

const VALID_INDIAN_PINCODE = /^[1-9]\d{5}$/;

export function isValidIndianPincode(pincode: string): boolean {
  return VALID_INDIAN_PINCODE.test(String(pincode ?? '').trim());
}

/** Returns unique non-empty strings sorted by descending frequency of occurrence. */
export function getUniqueByFrequency(arr: readonly string[]): string[] {
  const counts = arr.reduce<Record<string, number>>((acc, raw) => {
    const val = typeof raw === 'string' ? raw.trim() : '';
    if (!val) return acc;
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

/** Returns the single most frequent item in `arr`, or null when empty. */
export function getMostFrequent(arr: readonly string[]): string | null {
  return getUniqueByFrequency(arr)[0] || null;
}

function cleanField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isUsableRegionName(value: string): boolean {
  return Boolean(value) && value.toUpperCase() !== 'NA';
}

/**
 * Extracts a clean location summary from a Postal PIN Code API payload.
 * Returns `null` when the API reports an error or has no post office records.
 */
export function getPincodeLocation(apiResponse: unknown): PincodeLocation | null {
  const data = Array.isArray(apiResponse)
    ? (apiResponse[0] as PostalPincodeApiEntry | undefined)
    : undefined;
  if (data?.Status !== 'Success' || !Array.isArray(data.PostOffice) || data.PostOffice.length === 0) {
    return null;
  }

  const offices = data.PostOffice;

  // 1. Extract clean Block/Mandal/Taluk (ignoring "NA" and stripping "(mdl)")
  const validBlocks = offices
    .map((office) => cleanField(office?.Block))
    .filter(isUsableRegionName)
    .map((block) => block.replace(/\(mdl\)/gi, '').trim())
    .filter(Boolean);

  // 2. Get all unique Districts sorted by frequency (so user can switch if on a border)
  const districts = getUniqueByFrequency(
    offices.map((office) => cleanField(office?.District)).filter(isUsableRegionName),
  );

  const fallbackDivision =
    offices.map((office) => cleanField(office?.Division)).find(isUsableRegionName) || '';
  const fallbackDistrict = districts[0] || '';

  // Pick the most frequent Block, fallback to Division, then District
  const town = getMostFrequent(validBlocks) || fallbackDivision || fallbackDistrict;

  const state =
    offices.map((office) => cleanField(office?.State)).find(isUsableRegionName) || '';
  const pincode =
    offices.map((office) => cleanField(office?.Pincode)).find(Boolean) || '';

  if (!pincode || (!town && districts.length === 0 && !state)) {
    return null;
  }

  return {
    pincode,
    town,
    defaultDistrict: fallbackDistrict,
    districts,
    state,
  };
}
