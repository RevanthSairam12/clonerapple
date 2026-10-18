/**
 * PayU Configuration Module
 * 
 * Centralized, server-only configuration for PayU Hosted Checkout & Payment APIs.
 * Supports seamless switching between 'test' and 'live' environments via PAYU_ENV.
 * 
 * SECURITY:
 * - This module must NEVER be imported into client components.
 * - PAYU_SALT and PAYU_KEY must never be leaked or returned to the browser.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: PayU configuration and secrets must never be loaded in the browser environment.');
}

export type PayUEnvironment = 'test' | 'live';

export interface PayUConfig {
  key: string;
  salt: string;
  env: PayUEnvironment;
  paymentUrl: string;
  verifyPaymentUrl: string;
  appBaseUrl: string;
}

/**
 * Returns the active PayU configuration.
 * Validates presence of mandatory environment variables and computes proper endpoints.
 */
export function getPayUConfig(): PayUConfig {
  const env: PayUEnvironment = process.env.PAYU_ENV === 'live' ? 'live' : 'test';
  
  const key = process.env.PAYU_KEY?.trim() || '';
  const salt = process.env.PAYU_SALT?.trim() || '';
  const rawBaseUrl = process.env.PAYU_BASE_URL?.trim();

  // App Base URL for surl, furl, curl callbacks
  const appBaseUrl = (process.env.APP_BASE_URL || (
    process.env.NODE_ENV === 'production' ? 'https://gadzio.in' : 'http://localhost:3000'
  )).replace(/\/+$/, '');

  // Hosted checkout URL
  let paymentUrl: string;
  if (rawBaseUrl) {
    const cleanBase = rawBaseUrl.replace(/\/+$/, '');
    paymentUrl = cleanBase.endsWith('/_payment') ? cleanBase : `${cleanBase}/_payment`;
  } else {
    paymentUrl = env === 'live' 
      ? 'https://secure.payu.in/_payment' 
      : 'https://test.payu.in/_payment';
  }

  // Server-to-server Verify Payment API endpoint
  const verifyPaymentUrl = env === 'live'
    ? 'https://info.payu.in/merchant/postservice.php?form=2'
    : 'https://test.payu.in/merchant/postservice.php?form=2';

  return {
    key,
    salt,
    env,
    paymentUrl,
    verifyPaymentUrl,
    appBaseUrl,
  };
}

/**
 * Validates that production/test credentials are fully populated.
 * Throws a clean error without revealing salt/key.
 */
export function assertPayUConfigured(config: PayUConfig = getPayUConfig()): asserts config is PayUConfig & { key: string; salt: string } {
  if (!config.key) {
    throw new Error('PayU configuration error: PAYU_KEY environment variable is missing.');
  }
  if (!config.salt) {
    throw new Error('PayU configuration error: PAYU_SALT environment variable is missing.');
  }
}
