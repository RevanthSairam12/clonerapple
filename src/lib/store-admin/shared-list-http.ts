import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { SharedListError, SHARED_IMPORT_MAX_BYTES } from '@/lib/catalog/shared-list-rules';

// JSON can encode one ASCII byte as six bytes (\uXXXX). Allow that worst case,
// plus bounded room for the preview token and 2,000 row acknowledgments. The
// decoded import text still has its independent, strict 1 MB limit.
export const SHARED_BODY_LIMIT = 6 * SHARED_IMPORT_MAX_BYTES + 65_536;
export const sharedPrivateHeaders = { 'Cache-Control': 'private, no-store' };
const bodyLimitMessage = 'The import request is too large. Input may contain at most 1 MB (1,000,000 UTF-8 bytes).';

/** Bound actual streamed bytes without charging JSON escaping against file size. */
export async function readSharedBody(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > SHARED_BODY_LIMIT)) throw new SharedListError(bodyLimitMessage, 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SharedListError('Send a request body.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > SHARED_BODY_LIMIT) { await reader.cancel(); throw new SharedListError(bodyLimitMessage, 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof SharedListError) throw error;
    throw new SharedListError('Use a valid UTF-8 file or paste.');
  } finally { reader.releaseLock(); }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SharedListError('Send valid JSON.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SharedListError('Send a reference or import object.');
  return raw as Record<string, unknown>;
}

/** Per-process throttle, not a distributed quota. No IP or uploaded text is retained. */
export function sharedRateLimit(actorId: string, action: string) {
  const result = checkRateLimit(`shared-list:${action}:${actorId}`, { limit: action === 'apply' ? 10 : 30, windowMs: 60_000 });
  return result.allowed ? null : NextResponse.json({ error: 'Please wait before trying this catalogue action again.' }, { status: 429, headers: { ...sharedPrivateHeaders, 'Retry-After': String(result.retryAfterSec) } });
}
export function sharedFailure(error: unknown) {
  const status = error instanceof SharedListError ? error.status : 503;
  return NextResponse.json({ error: error instanceof SharedListError ? error.message : 'The shared catalogue is not ready. Check its migrations and retry.', ...(error instanceof SharedListError && error.message.startsWith('Did you mean ') ? { code: 'SHARED_NEAR_MATCH' } : {}) }, { status, headers: sharedPrivateHeaders });
}
