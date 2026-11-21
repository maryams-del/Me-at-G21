import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { THEME_COOKIE, THEME_COLORS, FAVICONS } from "@/lib/theme";
import "./globals.css";

/** Tab icon follows the saved Dark/Light choice (or the device setting when there isn't one). */
export async function generateMetadata(): Promise<Metadata> {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  const svg = theme === "dark" || theme === "light" ? FAVICONS[theme] : FAVICONS.auto;
  return {
    title: "Me @ G21",
    description: "Private personal dashboard",
    manifest: "/manifest.webmanifest?v=6",
    icons: { shortcut: "/favicon-v6.ico", icon: [{ url: svg, type: "image/svg+xml" }, { url: "/favicon-v6.png", sizes: "32x32", type: "image/png" }], apple: "/icons/apple-touch-icon-v6.png" },
    appleWebApp: { capable: true, title: "Me @ G21", statusBarStyle: "default" },
    robots: { index: false, follow: false },
  };
}
/** Status-bar colour: follows the Dark/Light choice when one is saved, otherwise the device setting. */
export async function generateViewport(): Promise<Viewport> {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return {
    width: "device-width", initialScale: 1, viewportFit: "cover",
    themeColor: theme === "dark" || theme === "light"
      ? THEME_COLORS[theme]
      : [{ media: "(prefers-color-scheme: light)", color: THEME_COLORS.light }, { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark }],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The owner's chosen mode (Dark or Light). Without a choice the device setting decides.
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="en" data-theme={theme === "dark" || theme === "light" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
