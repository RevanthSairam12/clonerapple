import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { isDateOnly } from '@/lib/store-admin/delivery';
import { isOrderSort, isSaleState, listOrders } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? url.searchParams.get('search') ?? '';
  const rawState = url.searchParams.get('state') ?? url.searchParams.get('saleState');
  const rawChannel = url.searchParams.get('channel');
  const rawSort = url.searchParams.get('sort');
  const dateFrom = url.searchParams.get('dateFrom') || null;
  const dateTo = url.searchParams.get('dateTo') || null;
  const parsedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);

  if (rawState && rawState !== 'ALL' && !isSaleState(rawState)) {
    return NextResponse.json({ error: 'Invalid order state.' }, { status: 400 });
  }
  if (rawChannel && !['all', 'web', 'pos'].includes(rawChannel)) {
    return NextResponse.json({ error: 'Invalid order channel.' }, { status: 400 });
  }
  if (rawSort && !isOrderSort(rawSort)) {
    return NextResponse.json({ error: 'Invalid order sort.' }, { status: 400 });
  }
  if ((dateFrom && !isDateOnly(dateFrom)) || (dateTo && !isDateOnly(dateTo))) {
    return NextResponse.json({ error: 'Order dates must use YYYY-MM-DD.' }, { status: 400 });
  }

  const state = rawState && rawState !== 'ALL' && isSaleState(rawState) ? rawState : null;
  const channel = rawChannel === 'web' || rawChannel === 'pos' ? rawChannel : null;
  const sort = rawSort && isOrderSort(rawSort) ? rawSort : null;

  const result = await listOrders({
    query,
    state,
    channel,
    dateFrom,
    dateTo,
    sort,
    page: Number.isFinite(parsedPage) ? parsedPage : 1,
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'Order records are not available.' }, { status: 503 });
  }

  return NextResponse.json(result.data);
}
