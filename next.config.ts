import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker/production deployment
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "10mb" }
  }
};

export default nextConfig;
