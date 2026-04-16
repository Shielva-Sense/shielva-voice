import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/identity/:path*", destination: "https://localhost:8009/:path*" },
    ];
  },
};

export default nextConfig;
