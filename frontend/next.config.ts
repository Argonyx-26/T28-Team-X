import type { NextConfig } from "next";

// The API the /backend/* proxy points at. Set API_URL for local work (see .env.local.example).
const API_URL = process.env.API_URL ?? "https://gurugraph-api-215071922486.asia-south1.run.app";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // "Plan tomorrow's lesson" can run the Coach and Analyst for up to ~90 s in the worst case; the default proxy cut-off is 30 s
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
