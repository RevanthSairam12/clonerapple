import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `postgres` keeps per-module connection state. Bundling it into several
  // server chunks gives one process multiple copies, which can stall a pooled
  // connection mid-query; load it from node_modules as a single instance.
  serverExternalPackages: ['postgres'],
  // Dev tooling fetches HMR and asset requests from the tunnel host; Next 16
  // otherwise rejects them as cross-origin. The scheme-less patterns match
  // any quick tunnel of either provider.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app'],
  redirects() {
    return [
      { source: '/admin', destination: '/store-admin/website', permanent: true },
      { source: '/admin/login', destination: '/store-admin/login?next=/store-admin/website', permanent: true },
      { source: '/admin/content/:key', destination: '/store-admin/website/content/:key', permanent: true },
      { source: '/admin/theme', destination: '/store-admin/website/theme', permanent: true },
      { source: '/admin/security', destination: '/store-admin/profile#security', permanent: true },
      // Keep this last so known bookmarks reach their matching editor.
      { source: '/admin/:rest*', destination: '/store-admin/website', permanent: true },
    ];
  },
};

export default nextConfig;
