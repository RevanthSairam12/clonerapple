import { NextResponse } from 'next/server';

import { getPincodeLocation, isValidIndianPincode } from '@/lib/storefront/pincode';

/**
 * Same-origin proxy to India Post's Postal PIN Code API so client CSP
 * (`connect-src 'self'`) stays strict while product pages resolve PIN codes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pincode: string }> },
) {
  const { pincode } = await params;
  const normalized = String(pincode ?? '').trim();

  if (!isValidIndianPincode(normalized)) {
    return NextResponse.json(
      { ok: false, location: null, error: 'Enter a valid 6-digit PIN code.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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
      return NextResponse.json(
        { ok: false, location: null },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const payload: unknown = await upstream.json();
    const location = getPincodeLocation(payload);

    if (!location) {
      return NextResponse.json(
        { ok: false, location: null },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, location },
      { status: 200, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, location: null },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
