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
      { source: "/favicon.svg", destination: "/favicon-v5.svg", permanent: false },
      { source: "/favicon.png", destination: "/favicon-v5.png", permanent: false },
      { source: "/apple-touch-icon.png", destination: "/icons/apple-touch-icon-v5.png", permanent: false },
      { source: "/apple-touch-icon-precomposed.png", destination: "/icons/apple-touch-icon-v5.png", permanent: false },
      { source: "/icons/:name(apple-touch-icon|icon-192|icon-512|maskable-512).png", destination: "/icons/:name-v5.png", permanent: false },
      { source: "/favicon-:v(v2|v3|v4).:ext(svg|png|ico)", destination: "/favicon-v5.:ext", permanent: false },
      { source: "/icons/:name(apple-touch-icon|icon-192|icon-512|maskable-512)-:v(v2|v3|v4).png", destination: "/icons/:name-v5.png", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // A document's own file may be shown inside its edit page (same site only), for the preview.
      { source: "/api/documents/file/:id", headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'self'" },
      ] },
      // Browsers ask for /favicon.ico on their own (e.g. a bare PDF tab): make them re-check it, so the new logo shows.
      { source: "/favicon.ico", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};
export default config;
