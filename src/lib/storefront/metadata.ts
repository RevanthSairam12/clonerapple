import { getAppBaseUrl } from '@/lib/payu/config';

/**
 * Returns the configured site origin as a `URL`, or `undefined` when
 * `APP_BASE_URL` is unset or unsafe (failing closed without a hardcoded
 * production domain fallback).
 */
export function siteMetadataBase(): URL | undefined {
  const baseUrl = getAppBaseUrl();
  return baseUrl ? new URL(baseUrl) : undefined;
}

/**
 * Returns an OpenGraph canonical page URL built strictly from the single
 * fail-closed site address resolver (`getAppBaseUrl()`), or `undefined` when
 * no valid public origin is configured.
 */
export function siteOpenGraphUrl(pathname: string): string | undefined {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) return undefined;
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}

