import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev tooling fetches HMR and asset requests from the tunnel host; Next 16
  // otherwise rejects them as cross-origin. The scheme-less patterns match
  // any quick tunnel of either provider.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app'],
};

export default nextConfig;
