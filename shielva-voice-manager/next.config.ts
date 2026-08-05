import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only convenience rewrite so relative /identity/* calls reach the local
  // identity service. In production the app always builds absolute URLs from
  // NEXT_PUBLIC_IDENTITY_URL (the gateway origin), so this is never exercised —
  // but shipping it would bake a localhost:8009 destination into a production
  // image, a trap for the first relative-path call anyone adds later.
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      { source: "/identity/:path*", destination: "https://localhost:8009/:path*" },
    ];
  },
};

export default nextConfig;
