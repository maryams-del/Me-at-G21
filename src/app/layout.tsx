import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life Dashboard",
  description: "Private personal dashboard",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Life", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F2F1EE" }, { media: "(prefers-color-scheme: dark)", color: "#171C26" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
