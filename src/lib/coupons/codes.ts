/**
 * Coupon code generation. Isomorphic: `globalThis.crypto.getRandomValues` is
 * available in both the browser and Node, so the staff form's "Generate code"
 * button uses the same unambiguous alphabet as bulk generation on the server.
 *
 * The alphabet omits 0/O and 1/I/L, so a code read aloud or copied from a
 * screenshot cannot be mistaken for a different valid code.
 */
import { COUPON_CODE_PATTERN, normalizeCouponCode } from './rules';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomIndexes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateCouponCode(prefix = 'GZ', length = 8): string {
  const cleanPrefix = normalizeCouponCode(prefix).replace(/[^A-Z0-9-]/g, '').replace(/-+$/, '');
  const size = Math.max(6, Math.min(24, Math.trunc(length) || 8));

  // Bytes above the largest multiple of the alphabet size are discarded so
  // every character is equally likely.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let body = '';
  while (body.length < size) {
    for (const byte of randomIndexes(Math.max(size - body.length, 8))) {
      if (byte < limit) {
        body += ALPHABET[byte % ALPHABET.length];
        if (body.length === size) break;
      }
    }
  }

  const code = cleanPrefix ? `${cleanPrefix}-${body}` : body;
  return COUPON_CODE_PATTERN.test(code) ? code : body.slice(0, 8);
}
