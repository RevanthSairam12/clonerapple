import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { checkDistributedRateLimit } from '@/lib/platform/distributed-rate-limit';
import { getPincodeLocation, isValidIndianPincode, type PincodeLocation } from '@/lib/storefront/pincode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PINCODE_IP_LIMIT = 30;
const PINCODE_IP_WINDOW_MS = 60 * 1000;
const PINCODE_HIT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PINCODE_MISS_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PINCODE_CACHE_ENTRIES = 2_000;

interface PincodeCacheEntry {
  location: PincodeLocation | null;
  expiresAt: number;
}

const pincodeCache = new Map<string, PincodeCacheEntry>();
const inflightLookups = new Map<string, Promise<{ cacheable: boolean; location: PincodeLocation | null }>>();

function readCachedPincode(normalized: string, now: number): PincodeCacheEntry | null {
  const entry = pincodeCache.get(normalized);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    pincodeCache.delete(normalized);
    return null;
  }
  // Refresh LRU order
  pincodeCache.delete(normalized);
  pincodeCache.set(normalized, entry);
  return entry;
}

function writeCachedPincode(normalized: string, location: PincodeLocation | null, now: number): void {
  if (pincodeCache.size >= MAX_PINCODE_CACHE_ENTRIES) {
    for (const [k, existing] of pincodeCache.entries()) {
      if (existing.expiresAt <= now) pincodeCache.delete(k);
    }
    if (pincodeCache.size >= MAX_PINCODE_CACHE_ENTRIES) {
      const oldest = pincodeCache.keys().next().value;
      if (oldest !== undefined) pincodeCache.delete(oldest);
    }
  }
  const ttl = location ? PINCODE_HIT_TTL_MS : PINCODE_MISS_TTL_MS;
  pincodeCache.set(normalized, { location, expiresAt: now + ttl });
}

function lookupUpstreamCoalesced(
  normalized: string,
): Promise<{ cacheable: boolean; location: PincodeLocation | null }> {
  const inflight = inflightLookups.get(normalized);
  if (inflight) return inflight;

  const p = (async (): Promise<{ cacheable: boolean; location: PincodeLocation | null }> => {
    try {
      const upstream = await fetch(
        `https://api.postalpincode.in/pincode/${encodeURIComponent(normalized)}`,
        {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(4500),
        },
      );
      if (!upstream.ok) {
        return { cacheable: false, location: null };
      }
      const payload: unknown = await upstream.json();
      const location = getPincodeLocation(payload);
      return { cacheable: true, location };
    } catch {
      return { cacheable: false, location: null };
    }
  })().finally(() => {
    if (inflightLookups.get(normalized) === p) {
      inflightLookups.delete(normalized);
    }
  });

  inflightLookups.set(normalized, p);
  return p;
}

/**
 * Same-origin proxy to India Post's Postal PIN Code API so client CSP
 * (`connect-src 'self'`) stays strict while product pages resolve PIN codes.
 * Protected by cross-site Fetch Metadata checks, distributed IP rate limiting,
 * and bounded coalesced caching so callers cannot amplify upstream lookups.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pincode: string }> },
) {
  const crossSite = assertSameOrigin(request);
  if (crossSite) return crossSite;

  const ip = clientIpFromRequest(request);
  if (ip) {
    const rate = await checkDistributedRateLimit({
      scope: 'pincode_lookup_ip',
      key: ip,
      limit: PINCODE_IP_LIMIT,
      windowMs: PINCODE_IP_WINDOW_MS,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, location: null, error: 'Too many PIN lookups. Please wait a minute and try again.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(Math.max(1, rate.retryAfterSec)),
          },
        },
      );
    }
  }

  const { pincode } = await params;
  const normalized = String(pincode ?? '').trim();

  if (!isValidIndianPincode(normalized)) {
    return NextResponse.json(
      { ok: false, location: null, error: 'Enter a valid 6-digit PIN code.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const now = Date.now();
  const cached = readCachedPincode(normalized, now);
  if (cached) {
    if (!cached.location) {
      return NextResponse.json(
        { ok: false, location: null },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: true, location: cached.location },
      { status: 200, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
    );
  }

  const resolved = await lookupUpstreamCoalesced(normalized);
  if (resolved.cacheable) {
    writeCachedPincode(normalized, resolved.location, Date.now());
  }

  if (!resolved.location) {
    return NextResponse.json(
      { ok: false, location: null },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { ok: true, location: resolved.location },
    { status: 200, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
  );
}
