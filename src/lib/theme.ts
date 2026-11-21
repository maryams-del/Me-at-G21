export const THEME_COOKIE = "g21-theme";
export type ThemeChoice = "dark" | "light";

/** Browser/status-bar colour for each mode (matches the page background). */
export const THEME_COLORS = { light: "#F2F0EA", dark: "#20271F" } as const;

/** Browser-tab icon: follows the Dark/Light choice when one is saved, otherwise the device setting. */
export const FAVICONS = { light: "/favicon-v6-light.svg", dark: "/favicon-v6-dark.svg", auto: "/favicon-v6.svg" } as const;
