"use client";
import { useEffect, useState } from "react";
import { THEME_COOKIE, THEME_COLORS, FAVICONS, type ThemeChoice } from "@/lib/theme";

function current(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Dark / Light switch with the mascot sitting on top of it. The choice is kept in a cookie for a year. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  useEffect(() => setTheme(current()), []);

  function choose(t: ThemeChoice) {
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    setTheme(t);
    // Keep the browser / iPhone status bar in step with the chosen mode, not the device setting.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = THEME_COLORS[t];
    document.head.appendChild(meta);
    // And the browser-tab icon, so it matches the logo in the chosen mode.
    // Every tab-icon link (SVG, PNG and ICO) is replaced, so each browser picks up the new one straight away.
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((l) => l.remove());
    const add = (rel: string, href: string, type?: string, sizes?: string) => {
      const l = document.createElement("link"); l.rel = rel; l.href = href;
      if (type) l.type = type; if (sizes) l.setAttribute("sizes", sizes);
      document.head.appendChild(l);
    };
    add("icon", FAVICONS[t].svg, "image/svg+xml");
    add("icon", FAVICONS[t].png, "image/png", "32x32");
    add("shortcut icon", FAVICONS[t].ico);
  }

  return (
    <div className="flex flex-col items-center shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mascot.png" alt="" width={48} height={64} data-splash="mascot" className="relative z-[2] -mb-[11px] object-contain w-[48px] h-[64px]" style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,.25))" }} />
      <div className="seg quiet" role="group" aria-label="Appearance">
        <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>Dark</button>
        <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>Light</button>
      </div>
    </div>
  );
}
