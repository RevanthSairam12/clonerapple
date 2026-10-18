import { NextRequest, NextResponse } from 'next/server';
import { processPayUCallback, PayUResponseData } from '@/lib/payu/process-response';
import { getPayUConfig } from '@/lib/payu/config';

export const runtime = 'nodejs';

async function parseFormData(req: NextRequest): Promise<PayUResponseData> {
  const contentType = req.headers.get('content-type') || '';
  const data: PayUResponseData = {};

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    for (const [key, value] of formData.entries()) {
      data[key] = typeof value === 'string' ? value : value.name;
    }
  } else if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => ({}));
    Object.assign(data, json);
  } else {
    // Attempt form data parsing as fallback
    try {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = typeof value === 'string' ? value : value.name;
      }
    } catch {
      // Ignore fallback failure
    }
  }

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const data = await parseFormData(req);
    const result = await processPayUCallback(data, 'return');
    const config = getPayUConfig();
    const destination = new URL(result.redirectUrl, config.appBaseUrl);

    // HTTP 303 See Other: instructs the browser to make a GET request to the destination URL
    return NextResponse.redirect(destination, { status: 303 });
  } catch (err: unknown) {
    console.error('[PayU Success Route Error]:', (err as Error).message);
    const config = getPayUConfig();
    return NextResponse.redirect(new URL('/order/failed?error=server_error', config.appBaseUrl), { status: 303 });
  }
}
