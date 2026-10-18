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
    try {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = typeof value === 'string' ? value : value.name;
      }
    } catch {
      // Ignore
    }
  }

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const data = await parseFormData(req);
    data.status = 'failure';
    data.unmappedstatus = 'userCancelled';
    const result = await processPayUCallback(data, 'return');
    const config = getPayUConfig();
    const destination = new URL(result.redirectUrl, config.appBaseUrl);

    return NextResponse.redirect(destination, { status: 303 });
  } catch (err: unknown) {
    console.error('[PayU Cancel Route Error]:', (err as Error).message);
    const config = getPayUConfig();
    return NextResponse.redirect(new URL('/order/cancelled', config.appBaseUrl), { status: 303 });
  }
}
