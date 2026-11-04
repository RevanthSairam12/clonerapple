/** Fixed route labels only: never log request URLs, query strings, IPs or agents. */
export function legacyAdminGone(route: string) {
  // One event per hit; aggregate by route/status in the server log collector.
  console.info(JSON.stringify({ route, status: 410 }));
  return new Response('This admin panel has moved to Store Admin', {
    status: 410,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
