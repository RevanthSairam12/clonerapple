import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * PayU Hash Utility Module
 * 
 * Strict SHA-512 cryptographic hash generation and constant-time verification.
 * Adheres strictly to the PayU Hosted Checkout specification.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: PayU hash operations must never run in browser code.');
}

export interface InitiateHashParams {
  key: string;
  txnid: string;
  amount: string; // Must be 2-decimal string e.g. "499.00"
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  salt: string;
}

export interface ReverseHashParams {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  status: string;
  additionalCharges?: string | null;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  salt: string;
}

/**
 * Computes SHA-512 lowercase hex digest.
 */
export function sha512(str: string): string {
  return createHash('sha512').update(str, 'utf8').digest('hex').toLowerCase();
}

/**
 * Sanitizes input to avoid unexpected pipes or carriage returns in hash strings.
 */
function sanitizeHashField(val: string | undefined | null): string {
  if (val === undefined || val === null) return '';
  return String(val).replace(/[\r\n]/g, '').trim();
}

/**
 * Generates the PayU Hosted Checkout Request Hash.
 * Formula:
 * sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 */
export function generateRequestHash(params: InitiateHashParams): { hash: string; hashStringForLog: string } {
  const {
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = '',
    salt,
  } = params;

  const sKey = sanitizeHashField(key);
  const sTxnid = sanitizeHashField(txnid);
  const sAmount = sanitizeHashField(amount);
  const sProductinfo = sanitizeHashField(productinfo);
  const sFirstname = sanitizeHashField(firstname);
  const sEmail = sanitizeHashField(email);
  const sUdf1 = sanitizeHashField(udf1);
  const sUdf2 = sanitizeHashField(udf2);
  const sUdf3 = sanitizeHashField(udf3);
  const sUdf4 = sanitizeHashField(udf4);
  const sUdf5 = sanitizeHashField(udf5);

  // 16 pipes between 17 fields (udf6-udf10 are empty)
  const hashString = `${sKey}|${sTxnid}|${sAmount}|${sProductinfo}|${sFirstname}|${sEmail}|${sUdf1}|${sUdf2}|${sUdf3}|${sUdf4}|${sUdf5}||||||${salt}`;
  
  // Safe string for development logs (never log the salt)
  const hashStringForLog = `${sKey}|${sTxnid}|${sAmount}|${sProductinfo}|${sFirstname}|${sEmail}|${sUdf1}|${sUdf2}|${sUdf3}|${sUdf4}|${sUdf5}||||||<REDACTED_SALT>`;

  const hash = sha512(hashString);
  return { hash, hashStringForLog };
}

/**
 * Computes the PayU Reverse Hash for return URLs and Webhooks.
 * Formula without additionalCharges:
 * sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 * Formula with additionalCharges:
 * sha512(additionalCharges|SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
export function computeReverseHash(params: ReverseHashParams): string {
  const {
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    status,
    additionalCharges,
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = '',
    salt,
  } = params;

  const sKey = sanitizeHashField(key);
  const sTxnid = sanitizeHashField(txnid);
  const sAmount = sanitizeHashField(amount);
  const sProductinfo = sanitizeHashField(productinfo);
  const sFirstname = sanitizeHashField(firstname);
  const sEmail = sanitizeHashField(email);
  const sStatus = sanitizeHashField(status);
  const sUdf1 = sanitizeHashField(udf1);
  const sUdf2 = sanitizeHashField(udf2);
  const sUdf3 = sanitizeHashField(udf3);
  const sUdf4 = sanitizeHashField(udf4);
  const sUdf5 = sanitizeHashField(udf5);

  const baseReverse = `${salt}|${sStatus}||||||${sUdf5}|${sUdf4}|${sUdf3}|${sUdf2}|${sUdf1}|${sEmail}|${sFirstname}|${sProductinfo}|${sAmount}|${sTxnid}|${sKey}`;

  if (additionalCharges && sanitizeHashField(additionalCharges).length > 0) {
    const sCharges = sanitizeHashField(additionalCharges);
    return sha512(`${sCharges}|${baseReverse}`);
  }

  return sha512(baseReverse);
}

/**
 * Performs a constant-time comparison of two strings to prevent timing attacks.
 */
export function safeCompareHashes(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();

  const bufA = Buffer.from(normA, 'utf8');
  const bufB = Buffer.from(normB, 'utf8');

  if (bufA.length !== bufB.length) {
    // Perform dummy timingSafeEqual to minimize timing leakage
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies received response hash against calculated reverse hash.
 * Automatically tries both with and without additionalCharges if ambiguous.
 */
export function verifyResponseHash(receivedHash: string, params: ReverseHashParams): boolean {
  if (!receivedHash) return false;

  // Case 1: Use provided additionalCharges (or lack thereof)
  const computedPrimary = computeReverseHash(params);
  if (safeCompareHashes(receivedHash, computedPrimary)) {
    return true;
  }

  // Case 2: If additionalCharges was passed, test without it as fallback, or vice-versa
  if (params.additionalCharges) {
    const fallbackWithoutCharges = computeReverseHash({ ...params, additionalCharges: undefined });
    if (safeCompareHashes(receivedHash, fallbackWithoutCharges)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes hash for PayU Verify Payment API.
 * Formula: sha512(key|command|var1|salt)
 */
export function generateVerifyPaymentHash(key: string, command: string, var1: string, salt: string): string {
  const str = `${key.trim()}|${command.trim()}|${var1.trim()}|${salt.trim()}`;
  return sha512(str);
}
