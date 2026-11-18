import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Me @ G21",
  description: "Private personal dashboard",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Me @ G21", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FBF6E9" }, { media: "(prefers-color-scheme: dark)", color: "#12180F" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The owner's chosen mode (Dark or Light). Without a choice the device setting decides.
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="en" data-theme={theme === "dark" || theme === "light" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
