import type { NextConfig } from "next";

const launchpadFastBuild =
  process.env.LAUNCHPAD_FAST_BUILD === "1" ||
  process.env.npm_lifecycle_event === "build:launchpad";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // GitHub CI runs `npm run typecheck` before deployment. Launchpad's legacy
  // runner has a 60-second ceiling, so its dedicated build skips that duplicate
  // check while keeping normal/local production builds strict.
  typescript: {
    ignoreBuildErrors: launchpadFastBuild,
  },
  experimental: {
    authInterrupts: false,
    // The Launchpad container has 1 GB of memory. Load route modules on demand
    // instead of preloading the whole application before the health check.
    preloadEntriesOnStart: launchpadFastBuild ? false : undefined,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
      {
        source: "/resources/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/me/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/auth/discovery",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
