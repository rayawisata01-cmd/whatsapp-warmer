import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  
  // CRITICAL: Disable trailing slash redirect to prevent HTTP 308
  // This was causing Socket.io polling requests to fail
  trailingSlash: false,
  
  // Disable all automatic redirects that could interfere with API routes
  async redirects() {
    return [];
  },
  
  // Ensure API routes are not rewritten or redirected
  async rewrites() {
    return [];
  },
  
  // Headers for Socket.io compatibility
  async headers() {
    return [
      {
        source: "/api/socket.io/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Connection", value: "keep-alive" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
