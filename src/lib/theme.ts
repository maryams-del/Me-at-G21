export const THEME_COOKIE = "g21-theme";
export type ThemeChoice = "dark" | "light";

/** Browser/status-bar colour for each mode (matches the page background). */
export const THEME_COLORS = { light: "#F2F0EA", dark: "#20271F" } as const;

/** Browser-tab icons (SVG for most browsers, PNG/ICO for Safari and others): follow the Dark/Light choice. */
export const FAVICONS = {
  light: { svg: "/favicon-v7-light.svg", png: "/favicon-v7-light.png", ico: "/favicon-v7-light.ico" },
  dark: { svg: "/favicon-v7-dark.svg", png: "/favicon-v7-dark.png", ico: "/favicon-v7-dark.ico" },
  /** no saved choice: follows the device setting */
  autoSvg: "/favicon-v7.svg",
} as const;
