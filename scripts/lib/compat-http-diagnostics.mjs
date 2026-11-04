/** Pure, redacted diagnostics. Never return error messages, IDs or redirect locations. */
export function loopbackBase(raw) {
  if (!raw) throw new Error('COMPAT_BASE_URL must explicitly name a loopback HTTP origin');
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('COMPAT_BASE_URL must explicitly name a loopback HTTP origin');
  }
  return url;
}

export function transportCategory(error) {
  const pending = [error];
  const codes = new Set();
  const names = new Set();
  // Node fetch may nest AggregateError -> errors -> socket error. Bound traversal.
  for (let i = 0; i < 16 && pending.length; i++) {
    const item = pending.shift();
    if (!item || typeof item !== 'object') continue;
    codes.add(item.code);
    names.add(item.name);
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 4));
  }
  if (names.has('TimeoutError') || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].some(code => codes.has(code))) return 'timeout';
  if (codes.has('ECONNREFUSED')) return 'connection_refused';
  if (codes.has('ECONNRESET') || codes.has('UND_ERR_SOCKET')) return 'connection_interrupted';
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) return 'dns_failure';
  if (names.has('AbortError')) return 'aborted';
  return 'other_transport';
}

export async function checkMediaRoutes(base, paths, fetcher = fetch) {
  const result = {
    attempted: 0, resolved: 0, httpFailures: {}, transportFailures: {}, cancellationFailures: 0,
  };
  for (const pathname of paths) {
    result.attempted++;
    let response;
    try {
      response = await fetcher(new URL(pathname, base), {
        redirect: 'manual', signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const category = transportCategory(error);
      result.transportFailures[category] = (result.transportFailures[category] ?? 0) + 1;
      continue;
    }
    if ([200, 302].includes(response.status)) result.resolved++;
    else {
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? String(response.status) : 'invalid_status';
      result.httpFailures[status] = (result.httpFailures[status] ?? 0) + 1;
    }
    try { await response.body?.cancel(); }
    catch { result.cancellationFailures++; }
  }
  result.ok = result.resolved === result.attempted && result.cancellationFailures === 0;
  return result;
}
