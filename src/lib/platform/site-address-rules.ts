const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const TUNNEL_HOST_SUFFIXES = [
  '.trycloudflare.com',
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.io',
  '.ngrok.app',
  '.loca.lt',
  '.localtunnel.me',
  '.ts.net',
] as const;

export function isLocalhostHostname(hostname: string): boolean {
  const normalised = hostname.trim().toLowerCase();
  return LOCAL_HOSTNAMES.has(normalised) || normalised.endsWith('.localhost');
}

export function isTunnelHostname(hostname: string): boolean {
  const normalised = hostname.trim().toLowerCase().replace(/\.+$/, '');
  if (!normalised) return false;
  return TUNNEL_HOST_SUFFIXES.some(
    (suffix) => normalised === suffix.slice(1) || normalised.endsWith(suffix),
  );
}

