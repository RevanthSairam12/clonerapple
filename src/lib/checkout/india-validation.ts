/** Pure customer input contract shared by checkout, initiation and address book. */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
  'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;
export type CheckoutField = 'firstname' | 'email' | 'phone' | 'name' | 'line1' | 'line2' | 'city' | 'state' | 'pincode';
export type FieldErrors = Partial<Record<CheckoutField, string>>;
export interface IndianAddress {
  name: string; phone: string; line1: string; line2: string; city: string; state: string; pincode: string;
}
export interface CheckoutContact { firstname: string; email: string; phone: string }
export type InputResult<T> = { ok: true; value: T; errors: FieldErrors } | { ok: false; errors: FieldErrors; error: string };
const record = (input: unknown): Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
const text = (input: unknown) => typeof input === 'string' ? input.trim() : '';
const controls = /[\u0000-\u001f\u007f]/;
const stateAliases: Record<string, string> = {
  'orissa': 'Odisha', 'uttaranchal': 'Uttarakhand', 'pondicherry': 'Puducherry',
  'nct of delhi': 'Delhi', 'new delhi': 'Delhi', 'national capital territory of delhi': 'Delhi',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'jammu & kashmir': 'Jammu and Kashmir',
  'dadra & nagar haveli and daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
};
export function normalizeIndianState(value: unknown): string {
  const candidate = text(value).replace(/\s+/g, ' ');
  return INDIAN_STATES.find(state => state.toLowerCase() === candidate.toLowerCase()) ?? stateAliases[candidate.toLowerCase()] ?? '';
}
/** Normalize supported prefixes only; never strip arbitrary characters into a valid phone. */
export function normalizeIndianMobile(value: unknown): string {
  const candidate = text(value).replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(candidate)) return candidate;
  if (/^\+91\d{10}$/.test(candidate)) return candidate.slice(3);
  if (/^91\d{10}$/.test(candidate)) return candidate.slice(2);
  if (/^0\d{10}$/.test(candidate)) return candidate.slice(1);
  return candidate;
}
function result<T>(value: T, errors: FieldErrors): InputResult<T> {
  const error = Object.values(errors)[0];
  return error ? { ok: false, errors, error } : { ok: true, value, errors: {} };
}
function validName(value: string, max: number): boolean {
  return value.length >= 2 && value.length <= max && /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(value) && !controls.test(value);
}
export function validateCheckoutContact(input: unknown): InputResult<CheckoutContact> {
  const raw = record(input);
  const value = { firstname: text(raw.firstname), email: text(raw.email).toLowerCase(), phone: normalizeIndianMobile(raw.phone) };
  const errors: FieldErrors = {};
  if (!validName(value.firstname, 50)) errors.firstname = 'Enter your first name (2–50 letters).';
  if (!value.email || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || controls.test(value.email)) errors.email = 'Enter a valid email address.';
  if (!/^[6-9]\d{9}$/.test(value.phone)) errors.phone = 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  return result(value, errors);
}
export function validateIndianAddress(input: unknown): InputResult<IndianAddress> {
  const raw = record(input);
  const value: IndianAddress = {
    name: text(raw.name), phone: normalizeIndianMobile(raw.phone), line1: text(raw.line1),
    line2: text(raw.line2), city: text(raw.city), state: normalizeIndianState(raw.state), pincode: text(raw.pincode),
  };
  const errors: FieldErrors = {};
  if (!validName(value.name, 100)) errors.name = 'Enter the recipient’s name (2–100 letters).';
  if (!/^[6-9]\d{9}$/.test(value.phone)) errors.phone = 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  if (!value.line1 || value.line1.length > 200 || controls.test(value.line1)) errors.line1 = 'Enter the house or flat and street (up to 200 characters).';
  if ((raw.line2 != null && typeof raw.line2 !== 'string') || value.line2.length > 200 || controls.test(value.line2)) errors.line2 = 'Keep the area or landmark within 200 characters.';
  if (!value.city || value.city.length > 100 || controls.test(value.city)) errors.city = 'Enter your city (up to 100 characters).';
  if (!value.state || text(raw.state).length > 100) errors.state = 'Choose an Indian state or union territory.';
  if (!/^[1-9]\d{5}$/.test(value.pincode)) errors.pincode = 'Enter a 6-digit PIN code that does not start with 0.';
  return result(value, errors);
}
/** Same field errors used on blur, submit and the payment API. */
export function checkoutFieldErrors(contact: unknown, address: unknown): FieldErrors {
  const contactResult = validateCheckoutContact(contact);
  const addressResult = validateIndianAddress(address);
  // Checkout derives a new recipient from First name; it has no separate name
  // input. Keep contact fields first for focus order and never target a missing ID.
  const { name, ...addressErrors } = addressResult.errors;
  return { ...contactResult.errors,
    ...(name && !contactResult.errors.firstname ? { firstname: name } : {}),
    ...addressErrors,
    ...(contactResult.errors.phone ? { phone: contactResult.errors.phone } : {}),
  };
}
