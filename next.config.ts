import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const config: NextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "web-push"],
  // Old icon file names held the first (Bauhaus) design and are cached by browsers and iOS.
  // Icons now have versioned names; anything still asking for an old name gets the current mark.
  async redirects() {
    return [
      { source: "/favicon.svg", destination: "/favicon-v3.svg", permanent: true },
      { source: "/favicon.png", destination: "/favicon-v3.png", permanent: true },
      { source: "/apple-touch-icon.png", destination: "/icons/apple-touch-icon-v3.png", permanent: true },
      { source: "/apple-touch-icon-precomposed.png", destination: "/icons/apple-touch-icon-v3.png", permanent: true },
      { source: "/icons/:name(apple-touch-icon|icon-192|icon-512|maskable-512).png", destination: "/icons/:name-v3.png", permanent: true },
      { source: "/favicon-v2.:ext(svg|png)", destination: "/favicon-v3.:ext", permanent: true },
      { source: "/icons/:name(apple-touch-icon|icon-192|icon-512|maskable-512)-v2.png", destination: "/icons/:name-v3.png", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};
export default config;
